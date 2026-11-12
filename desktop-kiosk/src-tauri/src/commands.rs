use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::logger::AppLogger;
use crate::models::{
    AppConfig, CompleteFirstRunResult, JobStatus, KioskState, PrintJob, PrintResult, PrinterInfo,
    UpdateSettingsInput,
};
use crate::printer::{list_system_printers, print_job_files};
use crate::security::{
    generate_recovery_phrase, hash_secret, normalize_phrase, validate_phrase, verify_secret,
};
use crate::storage::{delete_job_files, normalize_storage_dir, SharedStorage};
use crate::ws_client::RelayHandle;

pub struct AppState {
    pub app_data_dir: PathBuf,
    pub storage: SharedStorage,
    pub logger: AppLogger,
    pub relay: RelayHandle,
    pub existing_data_prompt: AtomicBool,
    pub exe_fingerprint: String,
}

fn detect_lan_ipv4() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // UDP connect selects the outbound interface via the OS routing table without sending packets.
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}

fn resolve_qr_relay_url(relay_url: &str) -> String {
    let trimmed = relay_url.trim().trim_end_matches('/');
    let Ok(mut parsed) = reqwest::Url::parse(trimmed) else {
        return trimmed.to_string();
    };

    if matches!(
        parsed.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    ) {
        if let Some(lan_ip) = detect_lan_ipv4() {
            let _ = parsed.set_host(Some(&lan_ip));
        }
    }

    parsed.to_string().trim_end_matches('/').to_string()
}

fn to_kiosk_state(cfg: AppConfig, state: &AppState) -> KioskState {
    let qr_relay_url = resolve_qr_relay_url(&cfg.relay_url);
    let (relay_connected, relay_status, relay_message) = state.relay.status_snapshot();
    let existing_data_prompt = state.existing_data_prompt.load(Ordering::Relaxed);
    let existing_job_count = if existing_data_prompt {
        state.storage.db().count_jobs().unwrap_or(0)
    } else {
        0
    };
    KioskState {
        machine_id: cfg.machine_id,
        relay_url: cfg.relay_url,
        qr_relay_url,
        bw_price_paise: cfg.bw_price_paise,
        color_price_paise: cfg.color_price_paise,
        default_printer: cfg.default_printer,
        kiosk_mode: cfg.kiosk_mode,
        setup_complete: cfg.setup_complete,
        relay_connected,
        relay_status,
        relay_message,
        existing_data_prompt,
        existing_job_count,
        storage_path: state.storage.data_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn get_kiosk_state(state: State<'_, AppState>) -> Result<KioskState, String> {
    let cfg = state.storage.db().get_config()?;
    Ok(to_kiosk_state(cfg, &state))
}

#[tauri::command]
pub fn complete_first_run(
    state: State<'_, AppState>,
    password: String,
) -> Result<CompleteFirstRunResult, String> {
    if password.trim().len() < 4 {
        return Err("Password must be at least 4 characters".to_string());
    }
    let db = state.storage.db();
    let current = db.get_config()?;
    if current.setup_complete {
        return Err("First-run setup is already complete".to_string());
    }

    let phrase = generate_recovery_phrase()?;
    let password_hash = hash_secret(&password)?;
    let phrase_hash = hash_secret(&normalize_phrase(&phrase))?;
    let updated = db.save_first_run(&password_hash, &phrase_hash)?;
    state.logger.log("INFO", "Completed first-run setup");

    Ok(CompleteFirstRunResult {
        recovery_phrase: phrase,
        state: to_kiosk_state(updated, &state),
    })
}

#[tauri::command]
pub fn verify_owner_password(
    state: State<'_, AppState>,
    password: String,
) -> Result<bool, String> {
    let cfg = state.storage.db().get_config()?;
    let Some(hash) = cfg.password_hash else {
        return Err("Owner password is not configured".to_string());
    };
    Ok(verify_secret(&password, &hash))
}

#[tauri::command]
pub fn reset_password_with_phrase(
    state: State<'_, AppState>,
    phrase: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.trim().len() < 4 {
        return Err("New password must be at least 4 characters".to_string());
    }
    let db = state.storage.db();
    let cfg = db.get_config()?;
    let Some(stored_phrase_hash) = cfg.recovery_phrase_hash else {
        return Err("Recovery phrase is not configured".to_string());
    };

    let normalized = validate_phrase(&phrase)?;
    if !verify_secret(&normalized, &stored_phrase_hash) {
        return Err("Recovery phrase does not match".to_string());
    }

    let new_hash = hash_secret(&new_password)?;
    db.update_password_hash(&new_hash)?;
    state.logger.log("INFO", "Owner password reset using recovery phrase");
    Ok(())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: UpdateSettingsInput,
) -> Result<KioskState, String> {
    let db = state.storage.db();
    let prev = db.get_config()?;
    let updated = db.update_settings(&settings)?;

    if updated.relay_url != prev.relay_url
        || updated.bw_price_paise != prev.bw_price_paise
        || updated.color_price_paise != prev.color_price_paise
    {
        state.relay.trigger_reconnect();
    }

    state.logger.log("INFO", "Updated kiosk settings");
    Ok(to_kiosk_state(updated, &state))
}

#[tauri::command]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    Ok(list_system_printers())
}

#[tauri::command]
pub fn verify_otp_and_print(
    state: State<'_, AppState>,
    otp: String,
) -> Result<PrintResult, String> {
    let trimmed = otp.trim();
    if trimmed.len() != 6 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Please enter a valid 6-digit OTP".to_string());
    }

    let db = state.storage.db();
    let job = db
        .get_job_by_otp(trimmed)?
        .ok_or_else(|| "No print job found for this OTP".to_string())?;

    if job.status == JobStatus::Printed {
        return Err("This OTP has already been printed".to_string());
    }
    if job.status == JobStatus::Printing {
        return Err("This print job is already printing".to_string());
    }
    if job.status == JobStatus::Expired {
        return Err("This print job has expired and its files were deleted".to_string());
    }
    if job.status == JobStatus::Cancelled {
        return Err("This print job was cancelled".to_string());
    }

    let cfg = db.get_config()?;
    db.update_job_status(&job.id, JobStatus::Printing)?;
    state.relay.send_job_status(&job.id, "printing", None);
    state
        .logger
        .log("INFO", &format!("Printing started for job {} (OTP {})", job.id, job.otp));

    if let Err(err) = print_job_files(
        cfg.default_printer.as_deref(),
        &job.files,
        job.copies,
        job.color,
    ) {
        let _ = db.update_job_status(&job.id, JobStatus::Failed);
        state.relay.send_job_status(&job.id, "failed", Some(&err));
        state.logger.log(
            "ERROR",
            &format!("Print failed for job {} (OTP {}): {}", job.id, job.otp, err),
        );
        return Err(err);
    }

    db.update_job_status(&job.id, JobStatus::Printed)?;
    state.relay.send_job_status(&job.id, "printed", None);
    state.logger.log(
        "INFO",
        &format!("Print succeeded for job {} (OTP {})", job.id, job.otp),
    );

    delete_job_files(&job, &state.storage.jobs_dir());
    state.logger.log(
        "INFO",
        &format!("Deleted completed print files for job {} (OTP {})", job.id, job.otp),
    );

    let updated_job = db.get_job_by_id(&job.id)?.unwrap_or(job);

    Ok(PrintResult {
        job: updated_job,
        message: "Print job sent to printer successfully".to_string(),
    })
}

#[tauri::command]
pub fn list_jobs(
    state: State<'_, AppState>,
    limit: Option<usize>,
    date: Option<String>,
) -> Result<Vec<PrintJob>, String> {
    state.storage.db().list_jobs(limit.unwrap_or(50), date.as_deref())
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<PrintJob, String> {
    let db = state.storage.db();
    let job = db
        .get_job_by_id(job_id.trim())?
        .ok_or_else(|| "Print job not found".to_string())?;

    if job.status == JobStatus::Printed {
        return Err("Cannot cancel an already printed job".to_string());
    }
    if job.status == JobStatus::Cancelled {
        return Err("This print job is already cancelled".to_string());
    }

    delete_job_files(&job, &state.storage.jobs_dir());
    db.update_job_status(&job.id, JobStatus::Cancelled)?;
    state
        .relay
        .send_job_status(&job.id, "cancelled", Some("Cancelled by owner"));
    state.logger.log(
        "INFO",
        &format!("Cancelled job {} (OTP {}) and deleted its files", job.id, job.otp),
    );

    db.get_job_by_id(&job.id)?
        .ok_or_else(|| "Failed to reload cancelled job".to_string())
}

#[tauri::command]
pub fn connect_relay(
    state: State<'_, AppState>,
    relay_url: Option<String>,
) -> Result<KioskState, String> {
    let db = state.storage.db();
    let cfg = if let Some(url) = relay_url {
        db.update_settings(&UpdateSettingsInput {
            relay_url: Some(url),
            bw_price_paise: None,
            color_price_paise: None,
            default_printer: None,
            kiosk_mode: None,
        })?
    } else {
        db.get_config()?
    };

    state.relay.trigger_reconnect();
    Ok(to_kiosk_state(cfg, &state))
}

#[tauri::command]
pub fn keep_existing_data(state: State<'_, AppState>) -> Result<KioskState, String> {
    let cfg = state
        .storage
        .db()
        .update_exe_fingerprint(&state.exe_fingerprint)?;
    state.existing_data_prompt.store(false, Ordering::Relaxed);
    state
        .logger
        .log("INFO", "Owner chose to keep existing installation data");
    Ok(to_kiosk_state(cfg, &state))
}

#[tauri::command]
pub fn reset_installation_data(state: State<'_, AppState>) -> Result<KioskState, String> {
    let cfg = state
        .storage
        .db()
        .reset_installation_data(&state.exe_fingerprint)?;
    for dir in [
        state.storage.jobs_dir(),
        std::env::temp_dir().join("jetprint-jobs"),
    ] {
        if let Err(err) = std::fs::remove_dir_all(&dir) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[JetPrint] Failed to clear jobs dir: {err}");
            }
        }
    }
    let _ = std::fs::create_dir_all(state.storage.jobs_dir());
    state.existing_data_prompt.store(false, Ordering::Relaxed);
    state.relay.trigger_reconnect();
    state
        .logger
        .log("INFO", "Reset installation data and cleared previous print files");
    Ok(to_kiosk_state(cfg, &state))
}

#[tauri::command]
pub async fn pick_storage_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("osascript")
                .args([
                    "-e",
                    r#"POSIX path of (choose folder with prompt "Select JetPrint Storage Folder")"#,
                ])
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path.trim_end_matches('/').to_string());
                    }
                }
            }
            None
        }
        #[cfg(target_os = "windows")]
        {
            let script = r#"Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select JetPrint Storage Folder'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"#;
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
            None
        }
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        {
            if let Ok(out) = std::process::Command::new("zenity")
                .args([
                    "--file-selection",
                    "--directory",
                    "--title=Select JetPrint Storage Folder",
                ])
                .output()
            {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
            if let Ok(out) = std::process::Command::new("kdialog")
                .args(["--getexistingdirectory", "."])
                .output()
            {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
            None
        }
    })
    .await
    .map_err(|e| format!("Folder picker task failed: {e}"))
}

#[tauri::command]
pub fn set_storage_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<KioskState, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Storage folder path cannot be empty".to_string());
    }
    let new_dir = normalize_storage_dir(std::path::Path::new(trimmed));
    state
        .storage
        .switch_storage_dir(&state.app_data_dir, new_dir.clone())?;
    state.logger.set_data_dir(&new_dir);
    state.logger.log(
        "INFO",
        &format!("Storage folder updated to {}", new_dir.display()),
    );
    let cfg = state.storage.db().get_config()?;
    Ok(to_kiosk_state(cfg, &state))
}

#[tauri::command]
pub fn get_logs(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<String>, String> {
    state.logger.read_logs(limit.unwrap_or(500))
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    state.logger.clear_logs()
}

#[tauri::command]
pub fn open_logs_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("logs") {
        let _ = win.unminimize();
        win.set_focus()
            .map_err(|e| format!("Failed to focus logs window: {e}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "logs", WebviewUrl::App("index.html?view=logs".into()))
        .title("JetPrint — Application Logs")
        .inner_size(900.0, 620.0)
        .build()
        .map_err(|e| format!("Failed to open logs window: {e}"))?;
    Ok(())
}

