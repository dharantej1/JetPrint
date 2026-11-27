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
        if let Ok(mut guard) = self.status.lock() {
            guard.0 = RelayConnectionStatus::Connecting;
            guard.1 = Some("Reconnecting to relay...".to_string());
            guard.2 = None;
        }
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

    /// Queues a `job_ack` WebSocket message to the Cloud Relay.
    pub fn send_job_ack(&self, job_id: &str) {
        let msg = OutgoingWsMessage::JobAck {
            job_id: job_id.to_string(),
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
    supports_color: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutgoingWsMessage {
    Register {
        machine_id: String,
        pricing: PricingPayload,
        supported_paper_sizes: Vec<String>,
        #[serde(rename = "supportedPaperSizes")]
        supported_paper_sizes_camel: Vec<String>,
        #[serde(rename = "supportsColor")]
        supports_color: bool,
    },
    Auth {
        machine_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        auth_token: Option<String>,
        pricing: PricingPayload,
        supported_paper_sizes: Vec<String>,
        #[serde(rename = "supportedPaperSizes")]
        supported_paper_sizes_camel: Vec<String>,
        #[serde(rename = "supportsColor")]
        supports_color: bool,
    },
    PricingUpdate {
        #[serde(rename = "bwPerPagePaise")]
        bw_per_page_paise: i64,
        #[serde(rename = "colorPerPagePaise")]
        color_per_page_paise: i64,
        #[serde(rename = "supportsColor")]
        supports_color: bool,
        #[serde(rename = "supportedPaperSizes")]
        supported_paper_sizes: Vec<String>,
        #[serde(rename = "supported_paper_sizes")]
        supported_paper_sizes_snake: Vec<String>,
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

#[derive(Debug, Deserialize, Clone)]
pub struct IncomingPrintSettings {
    pub copies: u32,
    pub color: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct IncomingJobFile {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    pub download_url: String,
    #[serde(default = "default_pages")]
    pub page_count: u32,
    #[serde(default)]
    pub settings: Option<FilePrintSettings>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DispatchedJobPayload {
    pub job_id: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    pub otp: Option<String>,
    pub print_settings: Option<IncomingPrintSettings>,
    #[serde(default)]
    pub copies: Option<u32>,
    #[serde(default)]
    pub color: Option<bool>,
    #[serde(default)]
    pub files: Vec<IncomingJobFile>,
    pub created_at: Option<String>,
    #[serde(default)]
    pub job: Option<Box<DispatchedJobPayload>>,
}

impl DispatchedJobPayload {
    pub fn resolved_job_id(&self) -> Option<String> {
        self.job_id
            .clone()
            .or_else(|| self.id.clone())
            .or_else(|| self.job.as_ref().and_then(|j| j.resolved_job_id()))
    }

    pub fn resolved_otp(&self) -> Option<String> {
        self.otp
            .clone()
            .or_else(|| self.job.as_ref().and_then(|j| j.resolved_otp()))
    }

    pub fn resolved_copies(&self) -> u32 {
        self.print_settings
            .as_ref()
            .map(|s| s.copies)
            .or(self.copies)
            .or_else(|| self.job.as_ref().map(|j| j.resolved_copies()))
            .unwrap_or(1)
            .max(1)
    }

    pub fn resolved_color(&self) -> bool {
        self.print_settings
            .as_ref()
            .map(|s| s.color)
            .or(self.color)
            .or_else(|| self.job.as_ref().map(|j| j.resolved_color()))
            .unwrap_or(false)
    }

    pub fn resolved_files(&self) -> Vec<IncomingJobFile> {
        if !self.files.is_empty() {
            self.files.clone()
        } else if let Some(j) = &self.job {
            j.resolved_files()
        } else {
            Vec::new()
        }
    }

    pub fn resolved_created_at(&self) -> Option<String> {
        self.created_at
            .clone()
            .or_else(|| self.job.as_ref().and_then(|j| j.resolved_created_at()))
    }
}

#[derive(Debug, Deserialize)]
pub struct ActiveJobsResponse {
    #[serde(default)]
    pub jobs: Vec<DispatchedJobPayload>,
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
            let mut was_reconnect_requested = false;

            set_status(
                &app,
                &relay,
                &config.machine_id,
                false,
                RelayConnectionStatus::Connecting,
                Some("Connecting to relay..."),
                Some(None),
            );

            match connect_async(&ws_url).await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();

                    let initial_msg = match active_token.as_ref() {
                        Some(token) if !token.trim().is_empty() => OutgoingWsMessage::Auth {
                            machine_id: config.machine_id.clone(),
                            auth_token: Some(token.clone()),
                            pricing: PricingPayload {
                                bw_per_page_paise: config.bw_price_paise,
                                color_per_page_paise: config.color_price_paise,
                                supports_color: config.supports_color,
                            },
                            supported_paper_sizes: config.supported_paper_sizes.clone(),
                            supported_paper_sizes_camel: config.supported_paper_sizes.clone(),
                            supports_color: config.supports_color,
                        },
                        _ => OutgoingWsMessage::Register {
                            machine_id: config.machine_id.clone(),
                            pricing: PricingPayload {
                                bw_per_page_paise: config.bw_price_paise,
                                color_per_page_paise: config.color_price_paise,
                                supports_color: config.supports_color,
                            },
                            supported_paper_sizes: config.supported_paper_sizes.clone(),
                            supported_paper_sizes_camel: config.supported_paper_sizes.clone(),
                            supports_color: config.supports_color,
                        },
                    };
                    if let Ok(json) = serde_json::to_string(&initial_msg) {
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
                        supports_color: config.supports_color,
                        supported_paper_sizes: config.supported_paper_sizes.clone(),
                        supported_paper_sizes_snake: config.supported_paper_sizes.clone(),
                    };
                    if let Ok(json) = serde_json::to_string(&pricing_msg) {
                        let _ = write.send(Message::Text(json.into())).await;
                    }

                    let mut had_error = false;
                    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
                    loop {
                        tokio::select! {
                            _ = relay.reconnect_notify.notified() => {
                                was_reconnect_requested = true;
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
                                                let app_sync = app.clone();
                                                let storage_sync = storage.clone();
                                                let relay_sync = relay.clone();
                                                let logger_sync = logger.clone();
                                                tauri::async_runtime::spawn(async move {
                                                    let _ = sync_active_jobs(&app_sync, &storage_sync, &relay_sync, &logger_sync).await;
                                                });
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

                    if was_reconnect_requested {
                        set_status(
                            &app,
                            &relay,
                            &config.machine_id,
                            false,
                            RelayConnectionStatus::Connecting,
                            Some("Reconnecting to relay..."),
                            Some(None),
                        );
                    } else if !had_error {
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

            if !was_reconnect_requested {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    _ = relay.reconnect_notify.notified() => {}
                }
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
            match download_and_save_job(
                http,
                jobs_dir,
                relay_url,
                active_token.as_deref(),
                db,
                logger,
                &job_id,
                &otp,
                print_settings.copies,
                print_settings.color,
                &files,
                created_at,
            )
            .await
            {
                Ok(job) => {
                    logger.log(
                        "INFO",
                        &format!(
                            "Received job {} (OTP {}, {} file(s))",
                            job.id,
                            job.otp,
                            job.files.len()
                        ),
                    );
                    let _ = app.emit(EVENT_JOB_RECEIVED, &job);
                    WsTextAction::AckJob(job_id)
                }
                Err(err) => {
                    logger.log(
                        "ERROR",
                        &format!(
                            "Failed to process JobDispatch for job {} (OTP {}): {}",
                            job_id, otp, err
                        ),
                    );
                    WsTextAction::None
                }
            }
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

pub async fn download_and_save_job(
    http: &reqwest::Client,
    jobs_dir: &std::path::Path,
    relay_url: &str,
    auth_token: Option<&str>,
    db: &Database,
    logger: &AppLogger,
    job_id: &str,
    otp: &str,
    copies: u32,
    color: bool,
    files: &[IncomingJobFile],
    created_at: Option<String>,
) -> Result<PrintJob, String> {
    let job_dir = jobs_dir.join(job_id);
    tokio::fs::create_dir_all(&job_dir)
        .await
        .map_err(|e| format!("Failed to create job directory {}: {e}", job_dir.display()))?;

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

        let mut downloaded_bytes = None;
        let mut last_error = String::new();

        for attempt in 1..=3 {
            let mut req = http.get(&url);
            if let Some(tok) = auth_token {
                req = req.bearer_auth(tok);
            }

            match req.send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        last_error = format!("HTTP {status}: {body}");
                        logger.log(
                            "WARN",
                            &format!(
                                "Attempt {attempt}/3 failed to download file {} ({}) for job {}: {}",
                                f.file_id, f.filename, job_id, last_error
                            ),
                        );
                    } else {
                        match resp.bytes().await {
                            Ok(bytes) => {
                                downloaded_bytes = Some(bytes);
                                break;
                            }
                            Err(e) => {
                                last_error = format!("Failed reading response stream: {e}");
                                logger.log(
                                    "WARN",
                                    &format!(
                                        "Attempt {attempt}/3 failed reading bytes for file {} in job {}: {}",
                                        f.file_id, job_id, last_error
                                    ),
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    last_error = format!("Network request failed: {e}");
                    logger.log(
                        "WARN",
                        &format!(
                            "Attempt {attempt}/3 request failed for file {} in job {}: {}",
                            f.file_id, job_id, last_error
                        ),
                    );
                }
            }

            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            }
        }

        let bytes = match downloaded_bytes {
            Some(b) => b,
            None => {
                let err_msg = format!(
                    "Failed to download file {} ({}) for job {} after 3 attempts: {}",
                    f.file_id, f.filename, job_id, last_error
                );
                logger.log("ERROR", &err_msg);
                return Err(err_msg);
            }
        };

        let safe_name = sanitize_filename(&f.filename);
        let is_pdf = f.mime_type.eq_ignore_ascii_case("application/pdf")
            || f.settings.as_ref().map(|s| s.print_ready).unwrap_or(false)
            || bytes.starts_with(b"%PDF");
        let dest: PathBuf = if is_pdf && !safe_name.to_lowercase().ends_with(".pdf") {
            job_dir.join(format!("{}_{}.pdf", f.file_id, safe_name))
        } else {
            job_dir.join(format!("{}_{}", f.file_id, safe_name))
        };

        if let Err(e) = tokio::fs::write(&dest, &bytes).await {
            let err_msg = format!("Failed to write job file {}: {e}", dest.display());
            logger.log("ERROR", &err_msg);
            return Err(err_msg);
        }

        downloaded_files.push(JobFile {
            file_id: f.file_id.clone(),
            filename: f.filename.clone(),
            mime_type: if is_pdf {
                "application/pdf".to_string()
            } else {
                f.mime_type.clone()
            },
            local_path: dest.to_string_lossy().to_string(),
            pages: f.page_count,
            settings: f.settings.clone(),
            assigned_printer: None,
        });
    }

    let job = PrintJob {
        id: job_id.to_string(),
        otp: otp.to_string(),
        files: downloaded_files,
        copies: copies.max(1),
        color,
        status: JobStatus::Pending,
        created_at: created_at.unwrap_or_else(|| Utc::now().to_rfc3339()),
        printed_at: None,
    };

    db.insert_job(&job)?;
    Ok(job)
}

pub async fn sync_active_jobs(
    app: &AppHandle,
    storage: &SharedStorage,
    relay: &RelayHandle,
    logger: &AppLogger,
) -> Result<usize, String> {
    let db = storage.db();
    let config = db.get_config()?;
    let Some(ref auth_token) = config.auth_token else {
        return Ok(0);
    };
    if auth_token.trim().is_empty() {
        return Ok(0);
    }

    let relay_url = config.relay_url.trim_end_matches('/');
    let url = format!("{}/api/machines/{}/active-jobs", relay_url, config.machine_id);

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let resp = match http.get(&url).bearer_auth(auth_token).send().await {
        Ok(r) => r,
        Err(e) => {
            logger.log("WARN", &format!("Failed to query active jobs from relay: {e}"));
            return Err(format!("Network error querying active jobs: {e}"));
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        logger.log("WARN", &format!("Relay returned error {status} for active-jobs: {body}"));
        return Err(format!("Relay error {status}: {body}"));
    }

    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read active-jobs response: {e}"))?;

    let job_payloads: Vec<DispatchedJobPayload> = if let Ok(wrapper) =
        serde_json::from_str::<ActiveJobsResponse>(&body_text)
    {
        wrapper.jobs
    } else if let Ok(list) = serde_json::from_str::<Vec<DispatchedJobPayload>>(&body_text) {
        list
    } else {
        logger.log(
            "ERROR",
            &format!("Failed to parse active-jobs response JSON: {body_text}"),
        );
        return Err("Invalid active-jobs response format".to_string());
    };

    let jobs_dir = storage.jobs_dir();
    let mut synced_count = 0;

    for payload in job_payloads {
        let Some(job_id) = payload.resolved_job_id() else {
            continue;
        };
        let Some(otp) = payload.resolved_otp() else {
            continue;
        };

        // Check if job already exists locally in SQLite
        if let Ok(Some(existing)) = db.get_job_by_id(&job_id) {
            if existing.status == JobStatus::Printed
                || existing.status == JobStatus::Cancelled
                || existing.status == JobStatus::Expired
            {
                continue;
            }
            let files_exist = !existing.files.is_empty()
                && existing
                    .files
                    .iter()
                    .all(|f| std::path::Path::new(&f.local_path).exists());
            if files_exist {
                relay.send_job_ack(&job_id);
                continue;
            }
        }

        let copies = payload.resolved_copies();
        let color = payload.resolved_color();
        let files = payload.resolved_files();
        let created_at = payload.resolved_created_at();

        match download_and_save_job(
            &http,
            &jobs_dir,
            relay_url,
            Some(auth_token),
            &db,
            logger,
            &job_id,
            &otp,
            copies,
            color,
            &files,
            created_at,
        )
        .await
        {
            Ok(job) => {
                logger.log(
                    "INFO",
                    &format!("Synced active job {} (OTP {}) from relay", job.id, job.otp),
                );
                let _ = app.emit(EVENT_JOB_RECEIVED, &job);
                relay.send_job_ack(&job.id);
                synced_count += 1;
            }
            Err(e) => {
                logger.log("ERROR", &format!("Failed to sync active job {job_id}: {e}"));
            }
        }
    }

    Ok(synced_count)
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
                    "pageRange": "1-3",
                    "paperSize": "A3"
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
                assert_eq!(s.paper_size.as_deref(), Some("A3"));
            }
            _ => panic!("expected JobDispatch"),
        }
    }

    #[test]
    fn serializes_auth_and_pricing_with_supported_paper_sizes() {
        let auth_msg = OutgoingWsMessage::Auth {
            machine_id: "m-123".to_string(),
            auth_token: Some("tok-1".to_string()),
            pricing: PricingPayload {
                bw_per_page_paise: 200,
                color_per_page_paise: 1000,
                supports_color: true,
            },
            supported_paper_sizes: vec!["A4".to_string(), "Letter".to_string()],
            supported_paper_sizes_camel: vec!["A4".to_string(), "Letter".to_string()],
            supports_color: true,
        };
        let auth_val: serde_json::Value = serde_json::to_value(&auth_msg).expect("serialize auth");
        assert_eq!(auth_val["type"], "auth");
        assert_eq!(auth_val["supported_paper_sizes"], serde_json::json!(["A4", "Letter"]));
        assert_eq!(auth_val["supportedPaperSizes"], serde_json::json!(["A4", "Letter"]));
        assert_eq!(auth_val["supportsColor"], true);
        assert_eq!(auth_val["pricing"]["supportsColor"], true);

        let pricing_msg = OutgoingWsMessage::PricingUpdate {
            bw_per_page_paise: 300,
            color_per_page_paise: 1200,
            supports_color: true,
            supported_paper_sizes: vec!["A4".to_string(), "A3".to_string()],
            supported_paper_sizes_snake: vec!["A4".to_string(), "A3".to_string()],
        };
        let pricing_val: serde_json::Value = serde_json::to_value(&pricing_msg).expect("serialize pricing");
        assert_eq!(pricing_val["type"], "pricing_update");
        assert_eq!(pricing_val["supportsColor"], true);
        assert_eq!(pricing_val["supportedPaperSizes"], serde_json::json!(["A4", "A3"]));
        assert_eq!(pricing_val["supported_paper_sizes"], serde_json::json!(["A4", "A3"]));
    }

    #[test]
    fn serializes_register_message() {
        let msg = OutgoingWsMessage::Register {
            machine_id: "m-123".to_string(),
            pricing: PricingPayload {
                bw_per_page_paise: 200,
                color_per_page_paise: 1000,
                supports_color: true,
            },
            supported_paper_sizes: vec!["A4".to_string()],
            supported_paper_sizes_camel: vec!["A4".to_string()],
            supports_color: true,
        };
        let val: serde_json::Value = serde_json::to_value(&msg).expect("serialize register");
        assert_eq!(val["type"], "register");
        assert_eq!(val["machine_id"], "m-123");
        assert_eq!(val["supportedPaperSizes"], serde_json::json!(["A4"]));
        assert_eq!(val["supportsColor"], true);
        assert_eq!(val["pricing"]["supportsColor"], true);
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

    #[test]
    fn serializes_job_ack_message() {
        let msg = OutgoingWsMessage::JobAck {
            job_id: "job-ack-123".to_string(),
        };
        let val: serde_json::Value = serde_json::to_value(&msg).expect("serialize");
        assert_eq!(val["type"], "job_ack");
        assert_eq!(val["job_id"], "job-ack-123");
    }

    #[test]
    fn parses_dispatched_job_payload_flat_and_nested() {
        let json_nested = r#"{
            "job_id": "job-recovered-1",
            "otp": "199247",
            "print_settings": { "copies": 1, "color": false },
            "files": [{
                "file_id": "file-rec-1",
                "filename": "doc.pdf",
                "mime_type": "application/pdf",
                "download_url": "/api/jobs/job-recovered-1/files/file-rec-1",
                "page_count": 2
            }],
            "job": {
                "job_id": "job-recovered-1",
                "otp": "199247"
            }
        }"#;
        let payload: DispatchedJobPayload = serde_json::from_str(json_nested).expect("valid json");
        assert_eq!(payload.resolved_job_id().as_deref(), Some("job-recovered-1"));
        assert_eq!(payload.resolved_otp().as_deref(), Some("199247"));
        assert_eq!(payload.resolved_copies(), 1);
        assert!(!payload.resolved_color());
        assert_eq!(payload.resolved_files().len(), 1);
        assert_eq!(payload.resolved_files()[0].file_id, "file-rec-1");
    }

    #[test]
    fn parses_active_jobs_response() {
        let json = r#"{
            "machine_id": "m-123",
            "jobs": [{
                "job_id": "job-active-1",
                "otp": "123456",
                "print_settings": { "copies": 2, "color": true },
                "files": [{
                    "file_id": "f-act-1",
                    "filename": "flyer.png",
                    "mime_type": "image/png",
                    "download_url": "http://relay.example.com/api/jobs/job-active-1/files/f-act-1"
                }]
            }]
        }"#;
        let resp: ActiveJobsResponse = serde_json::from_str(json).expect("valid active jobs json");
        assert_eq!(resp.jobs.len(), 1);
        assert_eq!(resp.jobs[0].resolved_job_id().as_deref(), Some("job-active-1"));
        assert_eq!(resp.jobs[0].resolved_otp().as_deref(), Some("123456"));
        assert_eq!(resp.jobs[0].resolved_copies(), 2);
        assert!(resp.jobs[0].resolved_color());
    }
}
