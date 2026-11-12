pub mod commands;
pub mod db;
pub mod models;
pub mod printer;
pub mod security;
pub mod ws_client;

use std::sync::Arc;

use tauri::Manager;

use commands::{
    complete_first_run, connect_relay, get_kiosk_state, list_jobs, list_printers,
    reset_password_with_phrase, update_settings, verify_otp_and_print, verify_owner_password,
    AppState,
};
use db::Database;
use ws_client::{spawn_relay_loop, RelayHandle};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| {
                    dirs::data_local_dir()
                        .unwrap_or_else(std::env::temp_dir)
                        .join("com.jetprint.kiosk")
                });
            let db_path = data_dir.join("jetprint.db");
            let db = Arc::new(
                Database::open(&db_path).expect("failed to initialize JetPrint SQLite database"),
            );
            let relay = RelayHandle::new();

            app.manage(AppState {
                db: Arc::clone(&db),
                relay: relay.clone(),
            });

            spawn_relay_loop(app.handle().clone(), db, relay);
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
            connect_relay,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JetPrint Kiosk");
}

