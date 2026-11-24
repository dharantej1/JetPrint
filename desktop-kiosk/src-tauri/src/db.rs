use std::path::Path;
use std::sync::Mutex;

use chrono::{DateTime, Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{
    AppConfig, ConfiguredPrinter, JobFile, JobStatus, KioskMode, PrintJob, PrinterPoolType,
    UpdateSettingsInput,
};

pub fn generate_machine_id() -> String {
    crate::machine_id::get_deterministic_machine_id()
}

pub fn current_exe_fingerprint() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let exe_meta = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| {
            let size = m.len();
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{size}-{mtime}")
        })
        .unwrap_or_else(|| "unknown".to_string());
    format!("{version}:{exe_meta}")
}

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
                supported_paper_sizes TEXT NOT NULL DEFAULT '["A4"]',
                kiosk_mode TEXT NOT NULL DEFAULT 'self_service' CHECK (kiosk_mode IN ('self_service', 'owner')),
                setup_complete INTEGER NOT NULL DEFAULT 0,
                exe_fingerprint TEXT,
                rush_mode INTEGER NOT NULL DEFAULT 0,
                supports_color INTEGER NOT NULL DEFAULT 1
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

            CREATE TABLE IF NOT EXISTS configured_printers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                nickname TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                pool TEXT NOT NULL DEFAULT 'default',
                capabilities TEXT NOT NULL DEFAULT '[]',
                is_default INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_print_jobs_otp ON print_jobs(otp);
            CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at ON print_jobs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_configured_printers_pool ON configured_printers(pool);
            "#,
        )
        .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;

        let (has_exe_fingerprint, has_paper_sizes, has_rush_mode, has_supports_color): (bool, bool, bool, bool) = conn
            .prepare("PRAGMA table_info(app_config)")
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
                let mut found_exe = false;
                let mut found_paper = false;
                let mut found_rush = false;
                let mut found_supports_color = false;
                for col in rows.flatten() {
                    if col == "exe_fingerprint" {
                        found_exe = true;
                    } else if col == "supported_paper_sizes" {
                        found_paper = true;
                    } else if col == "rush_mode" {
                        found_rush = true;
                    } else if col == "supports_color" {
                        found_supports_color = true;
                    }
                }
                Ok((found_exe, found_paper, found_rush, found_supports_color))
            })
            .map_err(|e| format!("Failed to inspect app_config columns: {e}"))?;

        if !has_exe_fingerprint {
            conn.execute("ALTER TABLE app_config ADD COLUMN exe_fingerprint TEXT", [])
                .map_err(|e| format!("Failed to migrate app_config.exe_fingerprint: {e}"))?;
        }

        if !has_paper_sizes {
            conn.execute(
                "ALTER TABLE app_config ADD COLUMN supported_paper_sizes TEXT NOT NULL DEFAULT '[\"A4\"]'",
                [],
            )
            .map_err(|e| format!("Failed to migrate app_config.supported_paper_sizes: {e}"))?;
        }

        if !has_rush_mode {
            conn.execute(
                "ALTER TABLE app_config ADD COLUMN rush_mode INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Failed to migrate app_config.rush_mode: {e}"))?;
        }

        if !has_supports_color {
            conn.execute(
                "ALTER TABLE app_config ADD COLUMN supports_color INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(|e| format!("Failed to migrate app_config.supports_color: {e}"))?;
        }

        let existing: Option<String> = conn
            .query_row("SELECT machine_id FROM app_config WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| format!("Failed to query app_config: {e}"))?;

        if existing.is_none() {
            let machine_id = generate_machine_id();
            let default_relay = "http://localhost:3000";
            conn.execute(
                r#"
                INSERT INTO app_config (
                    id, machine_id, relay_url, bw_price_paise, color_price_paise, supported_paper_sizes, kiosk_mode, setup_complete, rush_mode, supports_color
                ) VALUES (1, ?1, ?2, 200, 1000, '["A4"]', 'self_service', 0, 0, 1)
                "#,
                params![machine_id, default_relay],
            )
            .map_err(|e| format!("Failed to seed app_config: {e}"))?;
        }

        // Migrate existing default_printer into configured_printers if configured_printers is empty
        let default_printer: Option<String> = conn
            .query_row(
                "SELECT default_printer FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query default_printer: {e}"))?
            .flatten();

        if let Some(def_p) = default_printer {
            let trimmed = def_p.trim();
            if !trimmed.is_empty() {
                let printer_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM configured_printers",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                if printer_count == 0 {
                    let _ = conn.execute(
                        r#"
                        INSERT INTO configured_printers (
                            id, name, nickname, enabled, pool, capabilities, is_default
                        ) VALUES (?1, ?1, NULL, 1, 'default', '["bw", "color", "a4"]', 1)
                        "#,
                        params![trimmed],
                    );
                }
            }
        }

        // Recover any jobs left in 'printing' state from an unexpected crash or restart back to 'pending'
        let _ = conn.execute(
            "UPDATE print_jobs SET status = 'pending' WHERE status = 'printing'",
            [],
        );

        Ok(())
    }

    pub fn get_config(&self) -> Result<AppConfig, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.query_row(
            r#"
            SELECT machine_id, relay_url, auth_token, password_hash, recovery_phrase_hash,
                   bw_price_paise, color_price_paise, default_printer, kiosk_mode, setup_complete,
                   exe_fingerprint, supported_paper_sizes, rush_mode, supports_color
            FROM app_config WHERE id = 1
            "#,
            [],
            |row| {
                let mode_str: String = row.get(8)?;
                let setup_int: i64 = row.get(9)?;
                let paper_sizes_raw: Option<String> = row.get(11)?;
                let supported_paper_sizes = paper_sizes_raw
                    .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
                    .filter(|list| !list.is_empty())
                    .unwrap_or_else(crate::models::default_supported_paper_sizes);
                let rush_int: i64 = row.get(12).unwrap_or(0);
                let supports_color_int: i64 = row.get(13).unwrap_or(1);
                Ok(AppConfig {
                    machine_id: row.get(0)?,
                    relay_url: row.get(1)?,
                    auth_token: row.get(2)?,
                    password_hash: row.get(3)?,
                    recovery_phrase_hash: row.get(4)?,
                    bw_price_paise: row.get(5)?,
                    color_price_paise: row.get(6)?,
                    default_printer: row.get(7)?,
                    supported_paper_sizes,
                    kiosk_mode: KioskMode::from_str(&mode_str),
                    setup_complete: setup_int != 0,
                    exe_fingerprint: row.get(10)?,
                    rush_mode: rush_int != 0,
                    supports_color: supports_color_int != 0,
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

    pub fn update_exe_fingerprint(&self, fingerprint: &str) -> Result<AppConfig, String> {
        {
            let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            conn.execute(
                "UPDATE app_config SET exe_fingerprint = ?1 WHERE id = 1",
                params![fingerprint],
            )
            .map_err(|e| format!("Failed to update exe_fingerprint: {e}"))?;
        }
        self.get_config()
    }

    pub fn count_jobs(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM print_jobs", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count print_jobs: {e}"))?;
        Ok(count.max(0) as usize)
    }

    pub fn checkpoint_wal(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Failed to checkpoint WAL: {e}"))?;
        Ok(())
    }

    pub fn find_expired_jobs(&self, cutoff_utc: DateTime<Utc>) -> Result<Vec<PrintJob>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, otp, files_json, copies, color, status, created_at, printed_at
                FROM print_jobs
                WHERE status IN ('pending', 'printing', 'failed')
                "#,
            )
            .map_err(|e| format!("Failed to prepare find_expired_jobs: {e}"))?;

        let rows = stmt
            .query_map([], Self::row_to_job)
            .map_err(|e| format!("Failed to query expired jobs: {e}"))?;

        let mut expired = Vec::new();
        for row in rows {
            let job = row.map_err(|e| format!("Failed to decode job row: {e}"))?;
            if let Ok(dt) = DateTime::parse_from_rfc3339(&job.created_at) {
                if dt.with_timezone(&Utc) <= cutoff_utc {
                    expired.push(job);
                }
            }
        }
        Ok(expired)
    }

    pub fn reset_installation_data(&self, fingerprint: &str) -> Result<AppConfig, String> {
        let new_machine_id = generate_machine_id();
        {
            let mut conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            let tx = conn
                .transaction()
                .map_err(|e| format!("Failed to start reset transaction: {e}"))?;
            tx.execute("DELETE FROM print_jobs", [])
                .map_err(|e| format!("Failed to clear print_jobs: {e}"))?;
            tx.execute("DELETE FROM configured_printers", [])
                .map_err(|e| format!("Failed to clear configured_printers: {e}"))?;
            tx.execute(
                r#"
                UPDATE app_config
                SET machine_id = ?1,
                    relay_url = 'http://localhost:3000',
                    auth_token = NULL,
                    password_hash = NULL,
                    recovery_phrase_hash = NULL,
                    bw_price_paise = 200,
                    color_price_paise = 1000,
                    default_printer = NULL,
                    supported_paper_sizes = '["A4"]',
                    kiosk_mode = 'self_service',
                    setup_complete = 0,
                    exe_fingerprint = ?2,
                    rush_mode = 0,
                    supports_color = 1
                WHERE id = 1
                "#,
                params![new_machine_id, fingerprint],
            )
            .map_err(|e| format!("Failed to reset app_config: {e}"))?;
            tx.commit()
                .map_err(|e| format!("Failed to commit reset transaction: {e}"))?;
        }
        self.get_config()
    }

    pub fn update_settings(&self, input: &UpdateSettingsInput) -> Result<AppConfig, String> {
        let current = self.get_config()?;
        let relay_url = input
            .relay_url
            .as_ref()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| current.relay_url.clone());
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
        let rush_mode = input.rush_mode.unwrap_or(current.rush_mode);
        let supports_color = input.supports_color.unwrap_or(current.supports_color);
        let supported_paper_sizes = match &input.supported_paper_sizes {
            Some(sizes) if !sizes.is_empty() => sizes.clone(),
            _ => current.supported_paper_sizes,
        };
        let supported_paper_sizes_json = serde_json::to_string(&supported_paper_sizes)
            .unwrap_or_else(|_| "[\"A4\"]".to_string());
        let auth_token = if relay_url != current.relay_url {
            None
        } else {
            current.auth_token
        };

        {
            let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            conn.execute(
                r#"
                UPDATE app_config
                SET relay_url = ?1,
                    auth_token = ?2,
                    bw_price_paise = ?3,
                    color_price_paise = ?4,
                    default_printer = ?5,
                    kiosk_mode = ?6,
                    supported_paper_sizes = ?7,
                    rush_mode = ?8,
                    supports_color = ?9
                WHERE id = 1
                "#,
                params![
                    relay_url,
                    auth_token,
                    bw_price_paise,
                    color_price_paise,
                    default_printer,
                    kiosk_mode.as_str(),
                    supported_paper_sizes_json,
                    if rush_mode { 1i64 } else { 0i64 },
                    if supports_color { 1i64 } else { 0i64 },
                ],
            )
            .map_err(|e| format!("Failed to update settings: {e}"))?;

            // If default_printer was explicitly set, synchronize it into configured_printers
            if let Some(ref def_name) = default_printer {
                let trimmed = def_name.trim();
                if !trimmed.is_empty() {
                    let _ = conn.execute(
                        "UPDATE configured_printers SET is_default = CASE WHEN name = ?1 THEN 1 ELSE 0 END",
                        params![trimmed],
                    );
                    let exists: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM configured_printers WHERE name = ?1",
                            params![trimmed],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    if exists == 0 {
                        let _ = conn.execute(
                            r#"
                            INSERT INTO configured_printers (id, name, nickname, enabled, pool, capabilities, is_default)
                            VALUES (?1, ?1, NULL, 1, 'default', '["bw","color","a4"]', 1)
                            "#,
                            params![trimmed],
                        );
                    }
                }
            }
        }
        self.get_config()
    }

    pub fn get_configured_printers(&self) -> Result<Vec<ConfiguredPrinter>, String> {
        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, name, nickname, enabled, pool, capabilities, is_default
                FROM configured_printers
                ORDER BY is_default DESC, name ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare get_configured_printers: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let pool_str: String = row.get(4)?;
                let caps_str: String = row.get(5)?;
                let caps: Vec<String> = serde_json::from_str(&caps_str).unwrap_or_default();
                let enabled_int: i64 = row.get(3)?;
                let default_int: i64 = row.get(6)?;
                Ok(ConfiguredPrinter {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    nickname: row.get(2)?,
                    enabled: enabled_int != 0,
                    pool: PrinterPoolType::from_str(&pool_str),
                    capabilities: caps,
                    is_default: default_int != 0,
                })
            })
            .map_err(|e| format!("Failed to query configured_printers: {e}"))?;

        let mut printers = Vec::new();
        for r in rows {
            printers.push(r.map_err(|e| format!("Failed to decode configured printer: {e}"))?);
        }
        Ok(printers)
    }

    pub fn save_configured_printers(
        &self,
        printers: &[ConfiguredPrinter],
    ) -> Result<Vec<ConfiguredPrinter>, String> {
        let mut conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start save_configured_printers tx: {e}"))?;

        tx.execute("DELETE FROM configured_printers", [])
            .map_err(|e| format!("Failed to clear configured_printers: {e}"))?;

        let mut default_printer_name: Option<String> = None;

        for p in printers {
            let caps_json =
                serde_json::to_string(&p.capabilities).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                r#"
                INSERT INTO configured_printers (
                    id, name, nickname, enabled, pool, capabilities, is_default
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    p.id,
                    p.name,
                    p.nickname,
                    if p.enabled { 1i64 } else { 0i64 },
                    p.pool.as_str(),
                    caps_json,
                    if p.is_default { 1i64 } else { 0i64 },
                ],
            )
            .map_err(|e| format!("Failed to insert configured printer {}: {e}", p.name))?;

            if p.is_default && default_printer_name.is_none() {
                default_printer_name = Some(p.name.clone());
            }
        }

        if let Some(ref def_name) = default_printer_name {
            tx.execute(
                "UPDATE app_config SET default_printer = ?1 WHERE id = 1",
                params![def_name],
            )
            .map_err(|e| format!("Failed to sync default_printer to app_config: {e}"))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit configured_printers: {e}"))?;

        drop(conn);
        self.get_configured_printers()
    }

    /// Sets machine_id to the host deterministic identity and clears auth_token so the kiosk re-registers with the relay.
    pub fn reset_machine_identity(&self) -> Result<AppConfig, String> {
        let new_machine_id = generate_machine_id();
        {
            let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
            conn.execute(
                "UPDATE app_config SET machine_id = ?1, auth_token = NULL WHERE id = 1",
                params![new_machine_id],
            )
            .map_err(|e| format!("Failed to reset machine identity: {e}"))?;
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

    pub fn list_jobs(&self, limit: usize, date: Option<&str>) -> Result<Vec<PrintJob>, String> {
        let target_date = match date.map(str::trim).filter(|s| !s.is_empty()) {
            Some(d) => Some((
                d.to_string(),
                NaiveDate::parse_from_str(d, "%Y-%m-%d")
                    .map_err(|_| "Invalid date format, expected YYYY-MM-DD".to_string())?,
            )),
            None => None,
        };

        let conn = self.conn.lock().map_err(|e| format!("DB lock poisoned: {e}"))?;
        let mut jobs = Vec::new();

        if let Some((date_str, parsed_date)) = target_date {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT id, otp, files_json, copies, color, status, created_at, printed_at
                    FROM print_jobs
                    ORDER BY created_at DESC
                    "#,
                )
                .map_err(|e| format!("Failed to prepare list_jobs: {e}"))?;

            let rows = stmt
                .query_map([], Self::row_to_job)
                .map_err(|e| format!("Failed to query jobs: {e}"))?;

            for row in rows {
                let job = row.map_err(|e| format!("Failed to decode job row: {e}"))?;
                let matches = match DateTime::parse_from_rfc3339(&job.created_at) {
                    Ok(dt) => dt.with_timezone(&Local).date_naive() == parsed_date,
                    Err(_) => job.created_at.starts_with(&date_str),
                };
                if matches {
                    jobs.push(job);
                    if jobs.len() >= limit {
                        break;
                    }
                }
            }
        } else {
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

            for row in rows {
                jobs.push(row.map_err(|e| format!("Failed to decode job row: {e}"))?);
            }
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
                supported_paper_sizes: None,
                kiosk_mode: Some(KioskMode::Owner),
                rush_mode: Some(true),
                supports_color: None,
            })
            .expect("update_settings");
        assert_eq!(settings.relay_url, "https://relay.example.com");
        assert_eq!(settings.bw_price_paise, 300);
        assert_eq!(settings.color_price_paise, 1500);
        assert_eq!(settings.default_printer.as_deref(), Some("HP LaserJet"));
        assert_eq!(settings.supported_paper_sizes, vec!["A4".to_string()]);
        assert_eq!(settings.kiosk_mode, KioskMode::Owner);
        assert!(settings.rush_mode);
        assert!(settings.supports_color);

        let printers = db.get_configured_printers().expect("get_configured_printers");
        assert_eq!(printers.len(), 1);
        assert_eq!(printers[0].name, "HP LaserJet");
        assert!(printers[0].is_default);
    }

    #[test]
    fn update_settings_clears_auth_token_when_relay_url_changes() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.update_auth_token(Some("tok_existing")).expect("set token");

        let updated = db
            .update_settings(&UpdateSettingsInput {
                relay_url: Some("https://jetprint.onrender.com/".to_string()),
                bw_price_paise: None,
                color_price_paise: None,
                default_printer: None,
                supported_paper_sizes: None,
                kiosk_mode: None,
                rush_mode: None,
                supports_color: None,
            })
            .expect("update_settings");

        assert_eq!(updated.relay_url, "https://jetprint.onrender.com");
        assert_eq!(updated.auth_token, None);
    }

    #[test]
    fn update_settings_preserves_auth_token_when_relay_url_unchanged() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.update_settings(&UpdateSettingsInput {
            relay_url: Some("https://jetprint.onrender.com".to_string()),
            bw_price_paise: None,
            color_price_paise: None,
            default_printer: None,
            supported_paper_sizes: None,
            kiosk_mode: None,
            rush_mode: None,
            supports_color: None,
        })
        .expect("set relay_url");
        db.update_auth_token(Some("tok_keep")).expect("set token");

        let updated = db
            .update_settings(&UpdateSettingsInput {
                relay_url: Some("https://jetprint.onrender.com/".to_string()),
                bw_price_paise: Some(250),
                color_price_paise: None,
                default_printer: None,
                supported_paper_sizes: None,
                kiosk_mode: None,
                rush_mode: None,
                supports_color: None,
            })
            .expect("update_settings same relay");

        assert_eq!(updated.bw_price_paise, 250);
        assert_eq!(updated.auth_token.as_deref(), Some("tok_keep"));
    }

    #[test]
    fn persists_and_updates_supported_paper_sizes() {
        let db = Database::open_in_memory().expect("in-memory db");
        let initial = db.get_config().expect("initial config");
        assert_eq!(initial.supported_paper_sizes, vec!["A4".to_string()]);

        let updated = db
            .update_settings(&UpdateSettingsInput {
                relay_url: None,
                bw_price_paise: None,
                color_price_paise: None,
                default_printer: None,
                supported_paper_sizes: Some(vec!["A4".to_string(), "Letter".to_string(), "Legal".to_string()]),
                kiosk_mode: None,
                rush_mode: None,
                supports_color: None,
            })
            .expect("update supported_paper_sizes");
        assert_eq!(
            updated.supported_paper_sizes,
            vec!["A4".to_string(), "Letter".to_string(), "Legal".to_string()]
        );

        let reloaded = db.get_config().expect("reloaded config");
        assert_eq!(
            reloaded.supported_paper_sizes,
            vec!["A4".to_string(), "Letter".to_string(), "Legal".to_string()]
        );
    }

    #[test]
    fn reset_machine_identity_preserves_machine_id_and_clears_auth_token() {
        let db = Database::open_in_memory().expect("in-memory db");
        let initial = db.get_config().expect("initial config");
        db.update_auth_token(Some("tok_stale")).expect("set token");

        let reset = db.reset_machine_identity().expect("reset_machine_identity");
        assert!(reset.machine_id.starts_with("jp-"));
        assert_eq!(reset.machine_id, initial.machine_id);
        assert_eq!(reset.auth_token, None);
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
                assigned_printer: None,
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
        let jobs = db.list_jobs(10, None).expect("list_jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, JobStatus::Printed);
        assert!(jobs[0].printed_at.is_some());
    }

    #[test]
    fn filters_jobs_by_local_date() {
        let db = Database::open_in_memory().expect("in-memory db");
        let today_local = Local::now();
        let today_str = today_local.format("%Y-%m-%d").to_string();
        let yesterday_local = today_local - chrono::Duration::days(1);
        let yesterday_str = yesterday_local.format("%Y-%m-%d").to_string();

        let make_job = |id: &str, otp: &str, created_at: String| PrintJob {
            id: id.to_string(),
            otp: otp.to_string(),
            files: vec![],
            copies: 1,
            color: false,
            status: JobStatus::Pending,
            created_at,
            printed_at: None,
        };

        db.insert_job(&make_job("job-today", "111111", today_local.to_rfc3339()))
            .expect("insert today");
        db.insert_job(&make_job(
            "job-yesterday",
            "222222",
            yesterday_local.to_rfc3339(),
        ))
        .expect("insert yesterday");

        let today_jobs = db
            .list_jobs(50, Some(&today_str))
            .expect("list today jobs");
        assert_eq!(today_jobs.len(), 1);
        assert_eq!(today_jobs[0].id, "job-today");

        let yesterday_jobs = db
            .list_jobs(50, Some(&yesterday_str))
            .expect("list yesterday jobs");
        assert_eq!(yesterday_jobs.len(), 1);
        assert_eq!(yesterday_jobs[0].id, "job-yesterday");

        let all_jobs = db.list_jobs(50, None).expect("list all jobs");
        assert_eq!(all_jobs.len(), 2);

        assert!(db.list_jobs(50, Some("not-a-date")).is_err());
    }

    #[test]
    fn keeps_and_resets_installation_data() {
        let db = Database::open_in_memory().expect("in-memory db");
        let original_cfg = db
            .save_first_run("pw_hash", "phrase_hash")
            .expect("save_first_run");
        db.update_auth_token(Some("tok-123"))
            .expect("update_auth_token");
        db.update_settings(&UpdateSettingsInput {
            relay_url: Some("https://relay.example.com".to_string()),
            bw_price_paise: Some(500),
            color_price_paise: Some(2000),
            default_printer: Some("Canon".to_string()),
            supported_paper_sizes: None,
            kiosk_mode: Some(KioskMode::Owner),
            rush_mode: None,
            supports_color: None,
        })
        .expect("update_settings");
        db.insert_job(&PrintJob {
            id: "job-old".to_string(),
            otp: "123456".to_string(),
            files: vec![],
            copies: 1,
            color: false,
            status: JobStatus::Printed,
            created_at: Utc::now().to_rfc3339(),
            printed_at: Some(Utc::now().to_rfc3339()),
        })
        .expect("insert_job");
        assert_eq!(db.count_jobs().expect("count_jobs"), 1);

        let kept = db
            .update_exe_fingerprint("0.1.0:100-200")
            .expect("keep_existing_data");
        assert_eq!(kept.machine_id, original_cfg.machine_id);
        assert!(kept.setup_complete);
        assert_eq!(kept.exe_fingerprint.as_deref(), Some("0.1.0:100-200"));
        assert_eq!(db.count_jobs().expect("count_jobs after keep"), 1);

        let reset = db
            .reset_installation_data("0.1.0:300-400")
            .expect("reset_installation_data");
        assert_eq!(reset.machine_id, original_cfg.machine_id);
        assert!(reset.machine_id.starts_with("jp-"));
        assert_eq!(reset.relay_url, "http://localhost:3000");
        assert_eq!(reset.auth_token, None);
        assert_eq!(reset.password_hash, None);
        assert_eq!(reset.recovery_phrase_hash, None);
        assert_eq!(reset.bw_price_paise, 200);
        assert_eq!(reset.color_price_paise, 1000);
        assert_eq!(reset.default_printer, None);
        assert_eq!(reset.kiosk_mode, KioskMode::SelfService);
        assert!(!reset.setup_complete);
        assert_eq!(reset.exe_fingerprint.as_deref(), Some("0.1.0:300-400"));
        assert_eq!(db.count_jobs().expect("count_jobs after reset"), 0);
        assert!(reset.supports_color);
    }

    #[test]
    fn persists_and_updates_supports_color() {
        let db = Database::open_in_memory().expect("in-memory db");
        let initial = db.get_config().expect("initial config");
        assert!(initial.supports_color);

        let updated = db
            .update_settings(&UpdateSettingsInput {
                relay_url: None,
                bw_price_paise: None,
                color_price_paise: None,
                default_printer: None,
                supported_paper_sizes: None,
                kiosk_mode: None,
                rush_mode: None,
                supports_color: Some(false),
            })
            .expect("update supports_color");
        assert!(!updated.supports_color);

        let reloaded = db.get_config().expect("reloaded config");
        assert!(!reloaded.supports_color);

        let re_enabled = db
            .update_settings(&UpdateSettingsInput {
                relay_url: None,
                bw_price_paise: None,
                color_price_paise: None,
                default_printer: None,
                supported_paper_sizes: None,
                kiosk_mode: None,
                rush_mode: None,
                supports_color: Some(true),
            })
            .expect("re-enable supports_color");
        assert!(re_enabled.supports_color);
    }

    #[test]
    fn deletes_completed_and_expired_job_files() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let jobs_dir = temp_dir.path().join("jobs");
        std::fs::create_dir_all(&jobs_dir).expect("create jobs dir");

        let db = Database::open_in_memory().expect("in-memory db");

        let make_file = |job_id: &str, name: &str| {
            let dir = jobs_dir.join(job_id);
            std::fs::create_dir_all(&dir).expect("create job dir");
            let path = dir.join(name);
            std::fs::write(&path, b"pdf-bytes").expect("write file");
            JobFile {
                file_id: "f1".to_string(),
                filename: name.to_string(),
                mime_type: "application/pdf".to_string(),
                local_path: path.to_string_lossy().to_string(),
                pages: 1,
                settings: None,
                assigned_printer: None,
            }
        };

        // 1. Immediate deletion helper test
        let printed_job = PrintJob {
            id: "job-printed".to_string(),
            otp: "111111".to_string(),
            files: vec![make_file("job-printed", "a.pdf")],
            copies: 1,
            color: false,
            status: JobStatus::Printed,
            created_at: Utc::now().to_rfc3339(),
            printed_at: Some(Utc::now().to_rfc3339()),
        };
        db.insert_job(&printed_job).expect("insert printed");
        crate::storage::delete_job_files(&printed_job, &jobs_dir);
        assert!(!jobs_dir.join("job-printed").exists());
        assert!(db.get_job_by_id("job-printed").expect("get").is_some());

        // 2. 48-hour expiry cleanup test
        let old_job = PrintJob {
            id: "job-old-pending".to_string(),
            otp: "222222".to_string(),
            files: vec![make_file("job-old-pending", "old.pdf")],
            copies: 1,
            color: false,
            status: JobStatus::Pending,
            created_at: (Utc::now() - chrono::Duration::hours(49)).to_rfc3339(),
            printed_at: None,
        };
        let fresh_job = PrintJob {
            id: "job-fresh-pending".to_string(),
            otp: "333333".to_string(),
            files: vec![make_file("job-fresh-pending", "fresh.pdf")],
            copies: 1,
            color: false,
            status: JobStatus::Pending,
            created_at: (Utc::now() - chrono::Duration::hours(12)).to_rfc3339(),
            printed_at: None,
        };
        db.insert_job(&old_job).expect("insert old");
        db.insert_job(&fresh_job).expect("insert fresh");

        let cleaned = crate::storage::cleanup_expired_job_files(&db, &jobs_dir, None, None)
            .expect("cleanup_expired_job_files");
        assert_eq!(cleaned, 1);
        assert!(!jobs_dir.join("job-old-pending").exists());
        assert!(jobs_dir.join("job-fresh-pending").exists());
        assert_eq!(
            db.get_job_by_id("job-old-pending")
                .expect("get old")
                .unwrap()
                .status,
            JobStatus::Cancelled
        );
        assert_eq!(
            db.get_job_by_id("job-fresh-pending")
                .expect("get fresh")
                .unwrap()
                .status,
            JobStatus::Pending
        );
    }

    #[test]
    fn saves_and_retrieves_configured_printers_and_syncs_default_printer() {
        let db = Database::open_in_memory().expect("in-memory db");
        let initial_printers = db.get_configured_printers().expect("get configured printers");
        assert!(initial_printers.is_empty());

        let printers_to_save = vec![
            ConfiguredPrinter {
                id: "p1".to_string(),
                name: "Canon-MF3010".to_string(),
                nickname: Some("Front Counter".to_string()),
                enabled: true,
                pool: PrinterPoolType::Bw,
                capabilities: vec!["bw".to_string(), "a4".to_string()],
                is_default: true,
            },
            ConfiguredPrinter {
                id: "p2".to_string(),
                name: "Epson-L3150".to_string(),
                nickname: Some("Color Station".to_string()),
                enabled: true,
                pool: PrinterPoolType::Color,
                capabilities: vec!["color".to_string(), "a4".to_string()],
                is_default: false,
            },
            ConfiguredPrinter {
                id: "p3".to_string(),
                name: "HP-DesignJet".to_string(),
                nickname: Some("Poster Plotter".to_string()),
                enabled: false,
                pool: PrinterPoolType::LargeFormat,
                capabilities: vec!["a3".to_string(), "legal".to_string()],
                is_default: false,
            },
        ];

        let saved = db
            .save_configured_printers(&printers_to_save)
            .expect("save configured printers");
        assert_eq!(saved.len(), 3);
        assert_eq!(saved[0].name, "Canon-MF3010");
        assert!(saved[0].is_default);

        let cfg = db.get_config().expect("get_config");
        assert_eq!(cfg.default_printer.as_deref(), Some("Canon-MF3010"));
    }

    #[test]
    fn recovers_printing_jobs_to_pending_on_init() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let db_path = temp_dir.path().join("test.db");

        {
            let db = Database::open(&db_path).expect("open db");
            db.insert_job(&PrintJob {
                id: "job-crash-1".to_string(),
                otp: "112233".to_string(),
                files: vec![],
                copies: 1,
                color: false,
                status: JobStatus::Pending,
                created_at: Utc::now().to_rfc3339(),
                printed_at: None,
            })
            .expect("insert_job");

            db.update_job_status("job-crash-1", JobStatus::Printing)
                .expect("update_job_status to printing");
            let job = db.get_job_by_id("job-crash-1").expect("get job").unwrap();
            assert_eq!(job.status, JobStatus::Printing);
        }

        // Re-open database (simulating app restart after unexpected crash)
        let reopened_db = Database::open(&db_path).expect("reopen db");
        let recovered_job = reopened_db
            .get_job_by_id("job-crash-1")
            .expect("get recovered job")
            .unwrap();
        assert_eq!(recovered_job.status, JobStatus::Pending);
    }
}

