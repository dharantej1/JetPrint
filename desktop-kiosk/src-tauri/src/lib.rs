pub mod commands;
pub mod db;
pub mod logger;
pub mod models;
pub mod printer;
pub mod security;
pub mod storage;
pub mod ws_client;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use commands::{
    cancel_job, check_for_updates, clear_logs, complete_first_run, connect_relay, get_kiosk_state,
    get_logs, install_update, is_fullscreen, keep_existing_data, list_jobs, list_printers,
    open_logs_window, pick_storage_folder, reset_installation_data, reset_machine_identity,
    reset_password_with_phrase, set_fullscreen, set_storage_path, toggle_fullscreen,
    update_settings, verify_otp_and_print, verify_owner_password, AppState,
};
use db::{current_exe_fingerprint, Database};
use logger::AppLogger;
use storage::{cleanup_expired_job_files, load_configured_data_dir, SharedStorage};
use ws_client::{spawn_relay_loop, RelayHandle};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| {
                    dirs::data_local_dir()
                        .unwrap_or_else(std::env::temp_dir)
                        .join("com.jetprint.kiosk")
                });
            let active_data_dir = load_configured_data_dir(&app_data_dir);
            let db_path = active_data_dir.join("jetprint.db");
            let db_existed = db_path.exists();
            let db = Arc::new(
                Database::open(&db_path).expect("failed to initialize JetPrint SQLite database"),
            );
            let exe_fingerprint = current_exe_fingerprint();
            let cfg = db.get_config().expect("failed to load initial app_config");
            let job_count = db.count_jobs().unwrap_or(0);
            let has_existing_data = db_existed && (cfg.setup_complete || job_count > 0);
            let should_prompt = has_existing_data
                && cfg.exe_fingerprint.as_deref() != Some(exe_fingerprint.as_str());
            if !should_prompt && cfg.exe_fingerprint.as_deref() != Some(exe_fingerprint.as_str()) {
                let _ = db.update_exe_fingerprint(&exe_fingerprint);
            }

            let storage = SharedStorage::new(active_data_dir.clone(), Arc::clone(&db));
            let logger = AppLogger::new(&active_data_dir);
            logger.log(
                "INFO",
                &format!(
                    "JetPrint Kiosk started (storage: {})",
                    active_data_dir.display()
                ),
            );

            let relay = RelayHandle::new();

            let _ = cleanup_expired_job_files(
                &db,
                &storage.jobs_dir(),
                Some(&logger),
                Some(&relay),
            );

            let cleanup_storage = storage.clone();
            let cleanup_logger = logger.clone();
            let cleanup_relay = relay.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    let current_db = cleanup_storage.db();
                    let jobs_dir = cleanup_storage.jobs_dir();
                    let _ = cleanup_expired_job_files(
                        &current_db,
                        &jobs_dir,
                        Some(&cleanup_logger),
                        Some(&cleanup_relay),
                    );
                }
            });

            app.manage(AppState {
                app_data_dir,
                storage: storage.clone(),
                logger: logger.clone(),
                relay: relay.clone(),
                existing_data_prompt: AtomicBool::new(should_prompt),
                exe_fingerprint,
                pending_update: Arc::new(std::sync::Mutex::new(None)),
            });

            spawn_relay_loop(app.handle().clone(), storage, relay, logger);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_kiosk_state,
            complete_first_run,
            verify_owner_password,
            reset_password_with_phrase,
            update_settings,
            list_printers,
            verify_otp_and_print,
            list_jobs,
            cancel_job,
            connect_relay,
            reset_machine_identity,
            keep_existing_data,
            reset_installation_data,
            pick_storage_folder,
            set_storage_path,
            get_logs,
            clear_logs,
            open_logs_window,
            is_fullscreen,
            toggle_fullscreen,
            set_fullscreen,
            check_for_updates,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JetPrint Kiosk");
}

