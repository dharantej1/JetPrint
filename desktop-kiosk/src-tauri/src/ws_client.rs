use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex, Notify};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::db::Database;
use crate::logger::AppLogger;
use crate::models::{
    FilePrintSettings, JobFile, JobStatus, PrintJob, RelayConnectionStatus, RelayStatusEvent,
};
use crate::storage::SharedStorage;

pub const EVENT_JOB_RECEIVED: &str = "job-received";
pub const EVENT_RELAY_STATUS: &str = "relay-status";

#[derive(Clone)]
pub struct RelayHandle {
    pub connected: Arc<AtomicBool>,
    pub reconnect_notify: Arc<Notify>,
    status: Arc<std::sync::Mutex<(RelayConnectionStatus, Option<String>, Option<String>)>>,
    outgoing_tx: mpsc::UnboundedSender<String>,
    outgoing_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<String>>>>,
}

impl RelayHandle {
    pub fn new() -> Self {
        let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
        Self {
            connected: Arc::new(AtomicBool::new(false)),
            reconnect_notify: Arc::new(Notify::new()),
            status: Arc::new(std::sync::Mutex::new((
                RelayConnectionStatus::Connecting,
                None,
                None,
            ))),
            outgoing_tx,
            outgoing_rx: Arc::new(Mutex::new(Some(outgoing_rx))),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn status_snapshot(&self) -> (bool, RelayConnectionStatus, Option<String>, Option<String>) {
        let connected = self.is_connected();
        match self.status.lock() {
            Ok(guard) => (connected, guard.0.clone(), guard.1.clone(), guard.2.clone()),
            Err(_) => (
                connected,
                if connected {
                    RelayConnectionStatus::Connected
                } else {
                    RelayConnectionStatus::Disconnected
                },
                None,
                None,
            ),
        }
    }

    pub fn clear_auth_error(&self) {
        if let Ok(mut guard) = self.status.lock() {
            guard.2 = None;
        }
    }

    pub fn trigger_reconnect(&self) {
        self.reconnect_notify.notify_one();
    }

    /// Queues a `job_status_update` WebSocket message to the Cloud Relay.
    pub fn send_job_status(&self, job_id: &str, status: &str, error: Option<&str>) {
        let msg = OutgoingWsMessage::JobStatusUpdate {
            job_id: job_id.to_string(),
            status: status.to_string(),
            error: error.map(str::to_string),
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.outgoing_tx.send(json);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PricingPayload {
    bw_per_page_paise: i64,
    color_per_page_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutgoingWsMessage {
    Auth {
        machine_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        auth_token: Option<String>,
        pricing: PricingPayload,
    },
    PricingUpdate {
        #[serde(rename = "bwPerPagePaise")]
        bw_per_page_paise: i64,
        #[serde(rename = "colorPerPagePaise")]
        color_per_page_paise: i64,
    },
    JobAck {
        job_id: String,
    },
    JobStatusUpdate {
        job_id: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Ping,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum IncomingWsMessage {
    Registered {
        #[allow(dead_code)]
        machine_id: String,
        auth_token: String,
    },
    AuthOk {
        #[allow(dead_code)]
        machine_id: String,
        auth_token: String,
    },
    PricingAck {},
    JobDispatch {
        job_id: String,
        otp: String,
        print_settings: IncomingPrintSettings,
        files: Vec<IncomingJobFile>,
        created_at: Option<String>,
    },
    Pong,
    Error {
        #[allow(dead_code)]
        code: Option<String>,
        message: String,
    },
}

#[derive(Debug, Deserialize)]
struct IncomingPrintSettings {
    copies: u32,
    color: bool,
}

#[derive(Debug, Deserialize)]
struct IncomingJobFile {
    file_id: String,
    filename: String,
    mime_type: String,
    download_url: String,
    #[serde(default = "default_pages")]
    page_count: u32,
    #[serde(default)]
    settings: Option<FilePrintSettings>,
}

fn default_pages() -> u32 {
    1
}

/// Converts an HTTP(S) relay base URL into a WebSocket URL (`/ws`).
pub fn build_ws_url(relay_url: &str) -> String {
    let trimmed = relay_url.trim().trim_end_matches('/');
    let ws_base = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        trimmed.to_string()
    } else {
        format!("ws://{trimmed}")
    };
    format!("{ws_base}/ws")
}

/// Spawns the background WebSocket relay loop that stays connected and reconnects on demand.
pub fn spawn_relay_loop(app: AppHandle, storage: SharedStorage, relay: RelayHandle, logger: AppLogger) {
    tauri::async_runtime::spawn(async move {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let mut outgoing_rx = {
            let mut guard = relay.outgoing_rx.lock().await;
            guard.take()
        };

        loop {
            let db = storage.db();
            let config = match db.get_config() {
                Ok(c) => c,
                Err(_) => {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            };

            let ws_url = build_ws_url(&config.relay_url);
            let mut active_token = config.auth_token.clone();

            set_status(
                &app,
                &relay,
                &config.machine_id,
                false,
                RelayConnectionStatus::Connecting,
                Some("Connecting to relay..."),
                None,
            );

            match connect_async(&ws_url).await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();

                    let auth_msg = OutgoingWsMessage::Auth {
                        machine_id: config.machine_id.clone(),
                        auth_token: active_token.clone(),
                        pricing: PricingPayload {
                            bw_per_page_paise: config.bw_price_paise,
                            color_per_page_paise: config.color_price_paise,
                        },
                    };
                    if let Ok(json) = serde_json::to_string(&auth_msg) {
                        if write.send(Message::Text(json.into())).await.is_err() {
                            set_status(
                                &app,
                                &relay,
                                &config.machine_id,
                                false,
                                RelayConnectionStatus::Error,
                                Some("Auth send failed"),
                                Some(None),
                            );
                            tokio::time::sleep(Duration::from_secs(3)).await;
                            continue;
                        }
                    }

                    let pricing_msg = OutgoingWsMessage::PricingUpdate {
                        bw_per_page_paise: config.bw_price_paise,
                        color_per_page_paise: config.color_price_paise,
                    };
                    if let Ok(json) = serde_json::to_string(&pricing_msg) {
                        let _ = write.send(Message::Text(json.into())).await;
                    }

                    let mut had_error = false;
                    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
                    loop {
                        tokio::select! {
                            _ = relay.reconnect_notify.notified() => {
                                let _ = write.close().await;
                                break;
                            }
                            outgoing = async {
                                match outgoing_rx.as_mut() {
                                    Some(rx) => rx.recv().await,
                                    None => std::future::pending().await,
                                }
                            } => {
                                if let Some(json) = outgoing {
                                    if write.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            _ = heartbeat.tick() => {
                                if let Ok(json) = serde_json::to_string(&OutgoingWsMessage::Ping) {
                                    if write.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            incoming = read.next() => {
                                match incoming {
                                    Some(Ok(Message::Text(text))) => {
                                        let current_db = storage.db();
                                        let jobs_dir = storage.jobs_dir();
                                        match handle_ws_text(
                                            &app,
                                            &current_db,
                                            &jobs_dir,
                                            &http,
                                            &config.relay_url,
                                            &mut active_token,
                                            &logger,
                                            &text,
                                        ).await {
                                            WsTextAction::Authenticated => {
                                                logger.log("INFO", &format!("Connected to Cloud Relay ({})", config.relay_url));
                                                set_status(
                                                    &app,
                                                    &relay,
                                                    &config.machine_id,
                                                    true,
                                                    RelayConnectionStatus::Connected,
                                                    None,
                                                    Some(None),
                                                );
                                            }
                                            WsTextAction::AckJob(ack_job_id) => {
                                                if let Ok(ack_json) = serde_json::to_string(&OutgoingWsMessage::JobAck { job_id: ack_job_id }) {
                                                    let _ = write.send(Message::Text(ack_json.into())).await;
                                                }
                                            }
                                            WsTextAction::RelayError(err_msg) => {
                                                had_error = true;
                                                logger.log("ERROR", &format!("Relay auth error: {err_msg}"));
                                                set_status(
                                                    &app,
                                                    &relay,
                                                    &config.machine_id,
                                                    false,
                                                    RelayConnectionStatus::Error,
                                                    Some(&err_msg),
                                                    Some(Some(&err_msg)),
                                                );
                                                let _ = write.close().await;
                                                break;
                                            }
                                            WsTextAction::None => {}
                                        }
                                    }
                                    Some(Ok(Message::Close(_))) | None => break,
                                    Some(Err(_)) => break,
                                    _ => {}
                                }
                            }
                        }
                    }

                    if !had_error {
                        logger.log("WARN", "Disconnected from Cloud Relay");
                        set_status(
                            &app,
                            &relay,
                            &config.machine_id,
                            false,
                            RelayConnectionStatus::Disconnected,
                            Some("Disconnected from relay"),
                            Some(None),
                        );
                    }
                }
                Err(err) => {
                    let msg = format!("Relay connection failed: {err}");
                    logger.log("ERROR", &msg);
                    set_status(
                        &app,
                        &relay,
                        &config.machine_id,
                        false,
                        RelayConnectionStatus::Error,
                        Some(&msg),
                        Some(None),
                    );
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                _ = relay.reconnect_notify.notified() => {}
            }
        }
    });
}

enum WsTextAction {
    None,
    Authenticated,
    AckJob(String),
    RelayError(String),
}

fn set_status(
    app: &AppHandle,
    relay: &RelayHandle,
    machine_id: &str,
    connected: bool,
    status: RelayConnectionStatus,
    message: Option<&str>,
    auth_error: Option<Option<&str>>,
) {
    relay.connected.store(connected, Ordering::Relaxed);
    let next_auth_error = match relay.status.lock() {
        Ok(mut guard) => {
            let resolved_auth_error = match auth_error {
                Some(explicit) => explicit.map(str::to_string),
                None => guard.2.clone(),
            };
            *guard = (
                status.clone(),
                message.map(str::to_string),
                resolved_auth_error.clone(),
            );
            resolved_auth_error
        }
        Err(_) => auth_error.flatten().map(str::to_string),
    };
    let _ = app.emit(
        EVENT_RELAY_STATUS,
        RelayStatusEvent {
            connected,
            status,
            machine_id: machine_id.to_string(),
            message: message.map(str::to_string),
            auth_error: next_auth_error,
        },
    );
}

async fn handle_ws_text(
    app: &AppHandle,
    db: &Arc<Database>,
    jobs_dir: &std::path::Path,
    http: &reqwest::Client,
    relay_url: &str,
    active_token: &mut Option<String>,
    logger: &AppLogger,
    text: &str,
) -> WsTextAction {
    let Ok(msg) = serde_json::from_str::<IncomingWsMessage>(text) else {
        return WsTextAction::None;
    };

    match msg {
        IncomingWsMessage::Registered { auth_token, .. }
        | IncomingWsMessage::AuthOk { auth_token, .. } => {
            *active_token = Some(auth_token.clone());
            let _ = db.update_auth_token(Some(&auth_token));
            WsTextAction::Authenticated
        }
        IncomingWsMessage::JobDispatch {
            job_id,
            otp,
            print_settings,
            files,
            created_at,
        } => {
            let job_dir = jobs_dir.join(&job_id);
            if tokio::fs::create_dir_all(&job_dir).await.is_err() {
                return WsTextAction::None;
            }

            let mut downloaded_files = Vec::with_capacity(files.len());
            for f in files {
                let url = if f.download_url.starts_with("http://")
                    || f.download_url.starts_with("https://")
                {
                    f.download_url.clone()
                } else {
                    format!(
                        "{}/{}",
                        relay_url.trim_end_matches('/'),
                        f.download_url.trim_start_matches('/')
                    )
                };

                let mut req = http.get(&url);
                if let Some(tok) = active_token.as_deref() {
                    req = req.bearer_auth(tok);
                }

                let Ok(resp) = req.send().await else {
                    return WsTextAction::None;
                };
                if !resp.status().is_success() {
                    return WsTextAction::None;
                }
                let Ok(bytes) = resp.bytes().await else {
                    return WsTextAction::None;
                };

                let safe_name = sanitize_filename(&f.filename);
                let dest: PathBuf = job_dir.join(format!("{}_{}", f.file_id, safe_name));
                if tokio::fs::write(&dest, &bytes).await.is_err() {
                    return WsTextAction::None;
                }

                downloaded_files.push(JobFile {
                    file_id: f.file_id,
                    filename: f.filename,
                    mime_type: f.mime_type,
                    local_path: dest.to_string_lossy().to_string(),
                    pages: f.page_count,
                    settings: f.settings,
                });
            }

            let job = PrintJob {
                id: job_id.clone(),
                otp,
                files: downloaded_files,
                copies: print_settings.copies.max(1),
                color: print_settings.color,
                status: JobStatus::Pending,
                created_at: created_at.unwrap_or_else(|| Utc::now().to_rfc3339()),
                printed_at: None,
            };

            if db.insert_job(&job).is_ok() {
                logger.log(
                    "INFO",
                    &format!("Received job {} (OTP {}, {} file(s))", job.id, job.otp, job.files.len()),
                );
                let _ = app.emit(EVENT_JOB_RECEIVED, &job);
                return WsTextAction::AckJob(job_id);
            }
            WsTextAction::None
        }
        IncomingWsMessage::Error { code, message } => {
            eprintln!("[JetPrint WS] Relay error ({code:?}): {message}");
            if code.as_deref() == Some("AUTH_FAILED") {
                WsTextAction::RelayError(message)
            } else {
                WsTextAction::None
            }
        }
        IncomingWsMessage::PricingAck {} | IncomingWsMessage::Pong => WsTextAction::None,
    }
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "file.bin".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ws_url_from_http_and_https() {
        assert_eq!(build_ws_url("http://localhost:3001"), "ws://localhost:3001/ws");
        assert_eq!(
            build_ws_url("https://relay.jetprint.app/"),
            "wss://relay.jetprint.app/ws"
        );
    }

    #[test]
    fn parses_cloud_relay_job_dispatch_with_per_file_settings() {
        let json = r#"{
            "type": "job_dispatch",
            "job_id": "job-123",
            "otp": "654321",
            "amount_paise": 1200,
            "print_settings": { "copies": 2, "color": true },
            "files": [{
                "file_id": "f-1",
                "filename": "notes.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024,
                "page_count": 4,
                "download_url": "/api/jobs/job-123/files/f-1",
                "settings": {
                    "copies": 3,
                    "color": false,
                    "duplex": "2-sided",
                    "orientation": "landscape",
                    "pagesPerSheet": 2,
                    "pageRange": "1-3"
                }
            }],
            "created_at": "2026-11-12T07:00:00Z"
        }"#;

        let parsed: IncomingWsMessage = serde_json::from_str(json).expect("valid job_dispatch");
        match parsed {
            IncomingWsMessage::JobDispatch {
                job_id,
                otp,
                print_settings,
                files,
                ..
            } => {
                assert_eq!(job_id, "job-123");
                assert_eq!(otp, "654321");
                assert_eq!(print_settings.copies, 2);
                assert!(print_settings.color);
                assert_eq!(files.len(), 1);
                assert_eq!(files[0].page_count, 4);
                let s = files[0].settings.as_ref().expect("per-file settings");
                assert_eq!(s.copies, 3);
                assert!(!s.color);
                assert_eq!(s.duplex, "2-sided");
                assert_eq!(s.orientation, "landscape");
                assert_eq!(s.pages_per_sheet, 2);
                assert_eq!(s.page_range, "1-3");
            }
            _ => panic!("expected JobDispatch"),
        }
    }

    #[test]
    fn serializes_job_status_update_message() {
        let msg = OutgoingWsMessage::JobStatusUpdate {
            job_id: "job-123".to_string(),
            status: "failed".to_string(),
            error: Some("Printer offline".to_string()),
        };
        let val: serde_json::Value = serde_json::to_value(&msg).expect("serialize");
        assert_eq!(val["type"], "job_status_update");
        assert_eq!(val["job_id"], "job-123");
        assert_eq!(val["status"], "failed");
        assert_eq!(val["error"], "Printer offline");
    }
}
