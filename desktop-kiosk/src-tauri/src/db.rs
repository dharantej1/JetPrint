use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{AppConfig, JobFile, JobStatus, KioskMode, PrintJob, UpdateSettingsInput};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Opens or creates the SQLite database at `path` and runs schema initialization.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create DB directory: {e}"))?;
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open SQLite database: {e}"))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Creates an in-memory SQLite database for unit testing.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite database: {e}"))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                machine_id TEXT NOT NULL,
                relay_url TEXT NOT NULL,
                auth_token TEXT,
                password_hash TEXT,
                recovery_phrase_hash TEXT,
                bw_price_paise INTEGER NOT NULL DEFAULT 200,
                color_price_paise INTEGER NOT NULL DEFAULT 1000,
                default_printer TEXT,
                kiosk_mode TEXT NOT NULL DEFAULT 'self_service' CHECK (kiosk_mode IN ('self_service', 'owner')),
                setup_complete INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS print_jobs (
                id TEXT PRIMARY KEY,
                otp TEXT NOT NULL,
                files_json TEXT NOT NULL,
                copies INTEGER NOT NULL DEFAULT 1,
                color INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                printed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_print_jobs_otp ON print_jobs(otp);
            CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at ON print_jobs(created_at DESC);
            "#,
        )
        .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;

        let existing: Option<String> = conn
            .query_row("SELECT machine_id FROM app_config WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| format!("Failed to query app_config: {e}"))?;

        if existing.is_none() {
            let machine_id = format!("jp-{}", &Uuid::new_v4().simple().to_string()[..12]);
            let default_relay = "http://localhost:3001";
            conn.execute(
                r#"
                INSERT INTO app_config (
                    id, machine_id, relay_url, bw_price_paise, color_price_paise, kiosk_mode, setup_complete
                ) VALUES (1, ?1, ?2, 200, 1000, 'self_service', 0)
                "#,
                params![machine_id, default_relay],
            )
            .map_err(|e| format!("Failed to seed app_config: {e}"))?;
        }

        Ok(())
    }

    pub fn get_config(&self) -> Result<AppConfig, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.query_row(
            r#"
            SELECT machine_id, relay_url, auth_token, password_hash, recovery_phrase_hash,
                   bw_price_paise, color_price_paise, default_printer, kiosk_mode, setup_complete
            FROM app_config WHERE id = 1
            "#,
            [],
            |row| {
                let mode_str: String = row.get(8)?;
                let setup_int: i64 = row.get(9)?;
                Ok(AppConfig {
                    machine_id: row.get(0)?,
                    relay_url: row.get(1)?,
                    auth_token: row.get(2)?,
                    password_hash: row.get(3)?,
                    recovery_phrase_hash: row.get(4)?,
                    bw_price_paise: row.get(5)?,
                    color_price_paise: row.get(6)?,
                    default_printer: row.get(7)?,
                    kiosk_mode: KioskMode::from_str(&mode_str),
                    setup_complete: setup_int != 0,
                })
            },
        )
        .map_err(|e| format!("Failed to load app_config: {e}"))
    }

    pub fn save_first_run(
        &self,
        password_hash: &str,
        recovery_phrase_hash: &str,
    ) -> Result<AppConfig, String> {
        {
            let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            conn.execute(
                r#"
                UPDATE app_config
                SET password_hash = ?1,
                    recovery_phrase_hash = ?2,
                    setup_complete = 1
                WHERE id = 1
                "#,
                params![password_hash, recovery_phrase_hash],
            )
            .map_err(|e| format!("Failed to save first-run config: {e}"))?;
        }
        self.get_config()
    }

    pub fn update_password_hash(&self, password_hash: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute(
            "UPDATE app_config SET password_hash = ?1 WHERE id = 1",
            params![password_hash],
        )
        .map_err(|e| format!("Failed to update password hash: {e}"))?;
        Ok(())
    }

    pub fn update_auth_token(&self, token: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute(
            "UPDATE app_config SET auth_token = ?1 WHERE id = 1",
            params![token],
        )
        .map_err(|e| format!("Failed to update auth_token: {e}"))?;
        Ok(())
    }

    pub fn update_settings(&self, input: &UpdateSettingsInput) -> Result<AppConfig, String> {
        let current = self.get_config()?;
        let relay_url = input
            .relay_url
            .as_ref()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(current.relay_url);
        let bw_price_paise = input.bw_price_paise.unwrap_or(current.bw_price_paise).max(0);
        let color_price_paise = input
            .color_price_paise
            .unwrap_or(current.color_price_paise)
            .max(0);
        let default_printer = match &input.default_printer {
            Some(p) if p.trim().is_empty() => None,
            Some(p) => Some(p.clone()),
            None => current.default_printer,
        };
        let kiosk_mode = input.kiosk_mode.clone().unwrap_or(current.kiosk_mode);

        {
            let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            conn.execute(
                r#"
                UPDATE app_config
                SET relay_url = ?1,
                    bw_price_paise = ?2,
                    color_price_paise = ?3,
                    default_printer = ?4,
                    kiosk_mode = ?5
                WHERE id = 1
                "#,
                params![
                    relay_url,
                    bw_price_paise,
                    color_price_paise,
                    default_printer,
                    kiosk_mode.as_str(),
                ],
            )
            .map_err(|e| format!("Failed to update settings: {e}"))?;
        }
        self.get_config()
    }

    pub fn insert_job(&self, job: &PrintJob) -> Result<(), String> {
        let files_json = serde_json::to_string(&job.files)
            .map_err(|e| format!("Failed to serialize job files: {e}"))?;
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute(
            r#"
            INSERT OR REPLACE INTO print_jobs (
                id, otp, files_json, copies, color, status, created_at, printed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                job.id,
                job.otp,
                files_json,
                job.copies as i64,
                if job.color { 1i64 } else { 0i64 },
                job.status.as_str(),
                job.created_at,
                job.printed_at,
            ],
        )
        .map_err(|e| format!("Failed to insert print job: {e}"))?;
        Ok(())
    }

    pub fn get_job_by_otp(&self, otp: &str) -> Result<Option<PrintJob>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.query_row(
            r#"
            SELECT id, otp, files_json, copies, color, status, created_at, printed_at
            FROM print_jobs
            WHERE otp = ?1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            params![otp.trim()],
            Self::row_to_job,
        )
        .optional()
        .map_err(|e| format!("Failed to query job by OTP: {e}"))
    }

    pub fn get_job_by_id(&self, id: &str) -> Result<Option<PrintJob>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.query_row(
            r#"
            SELECT id, otp, files_json, copies, color, status, created_at, printed_at
            FROM print_jobs
            WHERE id = ?1
            "#,
            params![id],
            Self::row_to_job,
        )
        .optional()
        .map_err(|e| format!("Failed to query job by ID: {e}"))
    }

    pub fn update_job_status(&self, id: &str, status: JobStatus) -> Result<(), String> {
        let printed_at = if status == JobStatus::Printed {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute(
            r#"
            UPDATE print_jobs
            SET status = ?1,
                printed_at = COALESCE(?2, printed_at)
            WHERE id = ?3
            "#,
            params![status.as_str(), printed_at, id],
        )
        .map_err(|e| format!("Failed to update job status: {e}"))?;
        Ok(())
    }

    pub fn list_jobs(&self, limit: usize) -> Result<Vec<PrintJob>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, otp, files_json, copies, color, status, created_at, printed_at
                FROM print_jobs
                ORDER BY created_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare list_jobs: {e}"))?;

        let rows = stmt
            .query_map(params![limit as i64], Self::row_to_job)
            .map_err(|e| format!("Failed to query jobs: {e}"))?;

        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(row.map_err(|e| format!("Failed to decode job row: {e}"))?);
        }
        Ok(jobs)
    }

    fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<PrintJob> {
        let files_json: String = row.get(2)?;
        let files: Vec<JobFile> = serde_json::from_str(&files_json).unwrap_or_default();
        let copies: i64 = row.get(3)?;
        let color_int: i64 = row.get(4)?;
        let status_str: String = row.get(5)?;
        Ok(PrintJob {
            id: row.get(0)?,
            otp: row.get(1)?,
            files,
            copies: copies.max(1) as u32,
            color: color_int != 0,
            status: JobStatus::from_str(&status_str),
            created_at: row.get(6)?,
            printed_at: row.get(7)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_config_and_persists_first_run_and_settings() {
        let db = Database::open_in_memory().expect("in-memory db");
        let cfg = db.get_config().expect("get_config");
        assert!(!cfg.setup_complete);
        assert!(cfg.machine_id.starts_with("jp-"));
        assert_eq!(cfg.kiosk_mode, KioskMode::SelfService);

        let updated = db
            .save_first_run("pw_hash", "phrase_hash")
            .expect("save_first_run");
        assert!(updated.setup_complete);
        assert_eq!(updated.password_hash.as_deref(), Some("pw_hash"));
        assert_eq!(updated.recovery_phrase_hash.as_deref(), Some("phrase_hash"));

        let settings = db
            .update_settings(&UpdateSettingsInput {
                relay_url: Some("https://relay.example.com/".to_string()),
                bw_price_paise: Some(300),
                color_price_paise: Some(1500),
                default_printer: Some("HP LaserJet".to_string()),
                kiosk_mode: Some(KioskMode::Owner),
            })
            .expect("update_settings");
        assert_eq!(settings.relay_url, "https://relay.example.com");
        assert_eq!(settings.bw_price_paise, 300);
        assert_eq!(settings.color_price_paise, 1500);
        assert_eq!(settings.default_printer.as_deref(), Some("HP LaserJet"));
        assert_eq!(settings.kiosk_mode, KioskMode::Owner);
    }

    #[test]
    fn inserts_queries_and_updates_print_jobs() {
        let db = Database::open_in_memory().expect("in-memory db");
        let job = PrintJob {
            id: "job-1".to_string(),
            otp: "482910".to_string(),
            files: vec![JobFile {
                file_id: "file-1".to_string(),
                filename: "doc.pdf".to_string(),
                mime_type: "application/pdf".to_string(),
                local_path: "/tmp/doc.pdf".to_string(),
                pages: 3,
                settings: None,
            }],
            copies: 2,
            color: true,
            status: JobStatus::Pending,
            created_at: Utc::now().to_rfc3339(),
            printed_at: None,
        };
        db.insert_job(&job).expect("insert_job");

        let fetched = db
            .get_job_by_otp("482910")
            .expect("get_job_by_otp")
            .expect("job exists");
        assert_eq!(fetched.id, "job-1");
        assert_eq!(fetched.copies, 2);
        assert!(fetched.color);
        assert_eq!(fetched.files.len(), 1);

        db.update_job_status("job-1", JobStatus::Printed)
            .expect("update_job_status");
        let jobs = db.list_jobs(10).expect("list_jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, JobStatus::Printed);
        assert!(jobs[0].printed_at.is_some());
    }
}

