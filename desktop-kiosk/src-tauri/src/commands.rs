use std::sync::Arc;

use tauri::State;

use crate::db::Database;
use crate::models::{
    AppConfig, CompleteFirstRunResult, JobStatus, KioskState, PrintJob, PrintResult, PrinterInfo,
    UpdateSettingsInput,
};
use crate::printer::{list_system_printers, print_job_files};
use crate::security::{
    generate_recovery_phrase, hash_secret, normalize_phrase, validate_phrase, verify_secret,
};
use crate::ws_client::RelayHandle;

pub struct AppState {
    pub db: Arc<Database>,
    pub relay: RelayHandle,
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

fn to_kiosk_state(cfg: AppConfig, relay_connected: bool) -> KioskState {
    let qr_relay_url = resolve_qr_relay_url(&cfg.relay_url);
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
    }
}

#[tauri::command]
pub fn get_kiosk_state(state: State<'_, AppState>) -> Result<KioskState, String> {
    let cfg = state.db.get_config()?;
    Ok(to_kiosk_state(cfg, state.relay.is_connected()))
}

#[tauri::command]
pub fn complete_first_run(
    state: State<'_, AppState>,
    password: String,
) -> Result<CompleteFirstRunResult, String> {
    if password.trim().len() < 4 {
        return Err("Password must be at least 4 characters".to_string());
    }
    let current = state.db.get_config()?;
    if current.setup_complete {
        return Err("First-run setup is already complete".to_string());
    }

    let phrase = generate_recovery_phrase()?;
    let password_hash = hash_secret(&password)?;
    let phrase_hash = hash_secret(&normalize_phrase(&phrase))?;
    let updated = state.db.save_first_run(&password_hash, &phrase_hash)?;

    Ok(CompleteFirstRunResult {
        recovery_phrase: phrase,
        state: to_kiosk_state(updated, state.relay.is_connected()),
    })
}

#[tauri::command]
pub fn verify_owner_password(
    state: State<'_, AppState>,
    password: String,
) -> Result<bool, String> {
    let cfg = state.db.get_config()?;
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
    let cfg = state.db.get_config()?;
    let Some(stored_phrase_hash) = cfg.recovery_phrase_hash else {
        return Err("Recovery phrase is not configured".to_string());
    };

    let normalized = validate_phrase(&phrase)?;
    if !verify_secret(&normalized, &stored_phrase_hash) {
        return Err("Recovery phrase does not match".to_string());
    }

    let new_hash = hash_secret(&new_password)?;
    state.db.update_password_hash(&new_hash)
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: UpdateSettingsInput,
) -> Result<KioskState, String> {
    let prev = state.db.get_config()?;
    let updated = state.db.update_settings(&settings)?;

    if updated.relay_url != prev.relay_url
        || updated.bw_price_paise != prev.bw_price_paise
        || updated.color_price_paise != prev.color_price_paise
    {
        state.relay.trigger_reconnect();
    }

    Ok(to_kiosk_state(updated, state.relay.is_connected()))
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

    let job = state
        .db
        .get_job_by_otp(trimmed)?
        .ok_or_else(|| "No print job found for this OTP".to_string())?;

    if job.status == JobStatus::Printed {
        return Err("This OTP has already been printed".to_string());
    }
    if job.status == JobStatus::Printing {
        return Err("This print job is already printing".to_string());
    }

    let cfg = state.db.get_config()?;
    state.db.update_job_status(&job.id, JobStatus::Printing)?;
    state.relay.send_job_status(&job.id, "printing", None);

    if let Err(err) = print_job_files(
        cfg.default_printer.as_deref(),
        &job.files,
        job.copies,
        job.color,
    ) {
        let _ = state.db.update_job_status(&job.id, JobStatus::Failed);
        state.relay.send_job_status(&job.id, "failed", Some(&err));
        return Err(err);
    }

    state.db.update_job_status(&job.id, JobStatus::Printed)?;
    state.relay.send_job_status(&job.id, "printed", None);
    let updated_job = state
        .db
        .get_job_by_id(&job.id)?
        .unwrap_or(job);

    Ok(PrintResult {
        job: updated_job,
        message: "Print job sent to printer successfully".to_string(),
    })
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<PrintJob>, String> {
    state.db.list_jobs(limit.unwrap_or(50))
}

#[tauri::command]
pub fn connect_relay(
    state: State<'_, AppState>,
    relay_url: Option<String>,
) -> Result<KioskState, String> {
    let cfg = if let Some(url) = relay_url {
        state.db.update_settings(&UpdateSettingsInput {
            relay_url: Some(url),
            bw_price_paise: None,
            color_price_paise: None,
            default_printer: None,
            kiosk_mode: None,
        })?
    } else {
        state.db.get_config()?
    };

    state.relay.trigger_reconnect();
    Ok(to_kiosk_state(cfg, state.relay.is_connected()))
}

