use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::logger::AppLogger;
use crate::models::{JobStatus, PrintJob};
use crate::ws_client::RelayHandle;

const STORAGE_CONFIG_FILE: &str = "storage_config.json";
const EXPIRY_HOURS: i64 = 48;
pub const STORAGE_SUBFOLDER_NAME: &str = "JetPrint KIOSK";

pub fn normalize_storage_dir(path: &Path) -> PathBuf {
    let is_already_kiosk_dir = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == STORAGE_SUBFOLDER_NAME)
        .unwrap_or(false);
    if is_already_kiosk_dir {
        path.to_path_buf()
    } else {
        path.join(STORAGE_SUBFOLDER_NAME)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    data_dir: String,
}

fn move_file_if_missing(src: &Path, dst: &Path) {
    if !src.exists() || dst.exists() {
        return;
    }
    if fs::rename(src, dst).is_err() {
        if fs::copy(src, dst).is_ok() {
            let _ = fs::remove_file(src);
        }
    }
}

fn copy_dir_missing(src: &Path, dst: &Path) {
    if !src.is_dir() {
        return;
    }
    let _ = fs::create_dir_all(dst);
    let Ok(entries) = fs::read_dir(src) else {
        return;
    };
    for entry in entries.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_missing(&src_path, &dst_path);
        } else if !dst_path.exists() {
            let _ = fs::copy(&src_path, &dst_path);
        }
    }
}

fn move_dir_contents(src: &Path, dst: &Path) {
    if !src.is_dir() {
        return;
    }
    if !dst.exists() && fs::rename(src, dst).is_ok() {
        return;
    }
    copy_dir_missing(src, dst);
    let _ = fs::remove_dir_all(src);
}

pub fn load_configured_data_dir(app_data_dir: &Path) -> PathBuf {
    let config_path = app_data_dir.join(STORAGE_CONFIG_FILE);
    if let Ok(raw) = fs::read_to_string(&config_path) {
        if let Ok(cfg) = serde_json::from_str::<StorageConfig>(&raw) {
            let trimmed = cfg.data_dir.trim();
            if !trimmed.is_empty() {
                let raw_dir = PathBuf::from(trimmed);
                let normalized = normalize_storage_dir(&raw_dir);
                if normalized != raw_dir {
                    let _ = fs::create_dir_all(&normalized);
                    for name in ["jetprint.db", "jetprint.db-wal", "jetprint.db-shm"] {
                        move_file_if_missing(&raw_dir.join(name), &normalized.join(name));
                    }
                    move_dir_contents(&raw_dir.join("jobs"), &normalized.join("jobs"));
                    move_dir_contents(&raw_dir.join("logs"), &normalized.join("logs"));
                    let _ = save_configured_data_dir(app_data_dir, &normalized);
                }
                return normalized;
            }
        }
    }
    app_data_dir.to_path_buf()
}

pub fn save_configured_data_dir(app_data_dir: &Path, data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let cfg = StorageConfig {
        data_dir: data_dir.to_string_lossy().to_string(),
    };
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Failed to serialize storage config: {e}"))?;
    fs::write(app_data_dir.join(STORAGE_CONFIG_FILE), json)
        .map_err(|e| format!("Failed to write storage_config.json: {e}"))
}

#[derive(Clone)]
pub struct SharedStorage {
    inner: Arc<RwLock<StorageInner>>,
}

struct StorageInner {
    data_dir: PathBuf,
    db: Arc<Database>,
}

impl SharedStorage {
    pub fn new(data_dir: PathBuf, db: Arc<Database>) -> Self {
        let _ = fs::create_dir_all(data_dir.join("jobs"));
        let _ = fs::create_dir_all(data_dir.join("logs"));
        Self {
            inner: Arc::new(RwLock::new(StorageInner { data_dir, db })),
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.inner
            .read()
            .map(|g| g.data_dir.clone())
            .unwrap_or_else(|_| std::env::temp_dir().join("jetprint-kiosk"))
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.data_dir().join("jobs")
    }

    pub fn db(&self) -> Arc<Database> {
        self.inner
            .read()
            .expect("storage lock poisoned")
            .db
            .clone()
    }

    pub fn switch_storage_dir(&self, app_data_dir: &Path, new_dir: PathBuf) -> Result<(), String> {
        let new_dir = normalize_storage_dir(&new_dir);
        fs::create_dir_all(&new_dir)
            .map_err(|e| format!("Failed to create storage directory: {e}"))?;
        fs::create_dir_all(new_dir.join("jobs"))
            .map_err(|e| format!("Failed to create jobs directory: {e}"))?;
        fs::create_dir_all(new_dir.join("logs"))
            .map_err(|e| format!("Failed to create logs directory: {e}"))?;

        let probe = new_dir.join(".jetprint_write_test");
        fs::write(&probe, b"ok")
            .map_err(|e| format!("Storage directory is not writable: {e}"))?;
        let _ = fs::remove_file(&probe);

        let (old_dir, old_db) = {
            let guard = self
                .inner
                .read()
                .map_err(|e| format!("Storage lock poisoned: {e}"))?;
            (guard.data_dir.clone(), guard.db.clone())
        };

        if new_dir == old_dir {
            save_configured_data_dir(app_data_dir, &new_dir)?;
            return Ok(());
        }

        let old_db_path = old_dir.join("jetprint.db");
        let new_db_path = new_dir.join("jetprint.db");
        if !new_db_path.exists() && old_db_path.exists() {
            let _ = old_db.checkpoint_wal();
            fs::copy(&old_db_path, &new_db_path)
                .map_err(|e| format!("Failed to copy jetprint.db to new storage folder: {e}"))?;
        }
        copy_dir_missing(&old_dir.join("jobs"), &new_dir.join("jobs"));
        copy_dir_missing(&old_dir.join("logs"), &new_dir.join("logs"));

        let new_db = Arc::new(Database::open(&new_db_path)?);
        save_configured_data_dir(app_data_dir, &new_dir)?;

        let mut guard = self
            .inner
            .write()
            .map_err(|e| format!("Storage lock poisoned: {e}"))?;
        guard.data_dir = new_dir;
        guard.db = new_db;
        Ok(())
    }
}

/// Deletes a job's local downloaded files and its job directory from disk.
pub fn delete_job_files(job: &PrintJob, jobs_dir: &Path) {
    for f in &job.files {
        let p = Path::new(&f.local_path);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }

    let job_subdir = jobs_dir.join(&job.id);
    if job_subdir.exists() {
        let _ = fs::remove_dir_all(&job_subdir);
    }

    let legacy_temp_subdir = std::env::temp_dir().join("jetprint-jobs").join(&job.id);
    if legacy_temp_subdir.exists() {
        let _ = fs::remove_dir_all(&legacy_temp_subdir);
    }
}

/// Finds unprinted jobs older than 48 hours, deletes their files, and marks them `Cancelled`.
pub fn cleanup_expired_job_files(
    db: &Database,
    jobs_dir: &Path,
    logger: Option<&AppLogger>,
    relay: Option<&RelayHandle>,
) -> Result<usize, String> {
    let cutoff = Utc::now() - chrono::Duration::hours(EXPIRY_HOURS);
    let expired_jobs = db.find_expired_jobs(cutoff)?;
    let mut cleaned = 0;

    for job in expired_jobs {
        delete_job_files(&job, jobs_dir);
        db.update_job_status(&job.id, JobStatus::Cancelled)?;
        if let Some(r) = relay {
            r.send_job_status(
                &job.id,
                "cancelled",
                Some("Auto-cancelled after 48 hours without printing"),
            );
        }
        if let Some(log) = logger {
            log.log(
                "INFO",
                &format!(
                    "Auto-cancelled unused job {} after 48 hours and deleted its files",
                    job.id
                ),
            );
        }
        cleaned += 1;
    }

    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_storage_dir_with_jetprint_kiosk_subfolder() {
        assert_eq!(
            normalize_storage_dir(Path::new("/Users/alice/Documents")),
            PathBuf::from("/Users/alice/Documents/JetPrint KIOSK")
        );
        assert_eq!(
            normalize_storage_dir(Path::new("/Users/alice/Documents/")),
            PathBuf::from("/Users/alice/Documents/JetPrint KIOSK")
        );
        assert_eq!(
            normalize_storage_dir(Path::new("/Users/alice/Documents/JetPrint KIOSK")),
            PathBuf::from("/Users/alice/Documents/JetPrint KIOSK")
        );
        assert_eq!(
            normalize_storage_dir(Path::new("/Users/alice/Documents/JetPrint KIOSK/")),
            PathBuf::from("/Users/alice/Documents/JetPrint KIOSK/")
        );
    }

    #[test]
    fn migrates_legacy_unnormalized_storage_config_and_files() {
        let temp_app = tempfile::tempdir().expect("app_data_dir");
        let temp_docs = tempfile::tempdir().expect("legacy docs dir");
        let legacy_dir = temp_docs.path();

        fs::write(legacy_dir.join("jetprint.db"), b"sqlite-bytes").expect("db");
        fs::create_dir_all(legacy_dir.join("jobs/job-1")).expect("jobs dir");
        fs::write(legacy_dir.join("jobs/job-1/doc.pdf"), b"pdf").expect("job file");
        fs::create_dir_all(legacy_dir.join("logs")).expect("logs dir");
        fs::write(legacy_dir.join("logs/jetprint.log"), b"log line\n").expect("log file");

        save_configured_data_dir(temp_app.path(), legacy_dir).expect("save legacy config");

        let resolved = load_configured_data_dir(temp_app.path());
        let expected = legacy_dir.join(STORAGE_SUBFOLDER_NAME);
        assert_eq!(resolved, expected);

        assert!(!legacy_dir.join("jetprint.db").exists());
        assert!(!legacy_dir.join("jobs").exists());
        assert!(!legacy_dir.join("logs").exists());

        assert_eq!(
            fs::read(expected.join("jetprint.db")).expect("migrated db"),
            b"sqlite-bytes"
        );
        assert_eq!(
            fs::read(expected.join("jobs/job-1/doc.pdf")).expect("migrated job"),
            b"pdf"
        );
        assert_eq!(
            fs::read(expected.join("logs/jetprint.log")).expect("migrated log"),
            b"log line\n"
        );

        let updated_cfg = fs::read_to_string(temp_app.path().join(STORAGE_CONFIG_FILE))
            .expect("read updated storage_config.json");
        assert!(updated_cfg.contains(STORAGE_SUBFOLDER_NAME));
    }
}
