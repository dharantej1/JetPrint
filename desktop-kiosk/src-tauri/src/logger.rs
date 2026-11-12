use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use chrono::Local;

#[derive(Clone)]
pub struct AppLogger {
    log_dir: Arc<RwLock<PathBuf>>,
    write_lock: Arc<Mutex<()>>,
}

impl AppLogger {
    pub fn new(data_dir: &Path) -> Self {
        let log_dir = data_dir.join("logs");
        let _ = fs::create_dir_all(&log_dir);
        Self {
            log_dir: Arc::new(RwLock::new(log_dir)),
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn set_data_dir(&self, data_dir: &Path) {
        let new_dir = data_dir.join("logs");
        let _ = fs::create_dir_all(&new_dir);
        if let Ok(mut guard) = self.log_dir.write() {
            *guard = new_dir;
        }
    }

    fn log_file_path(&self) -> PathBuf {
        let dir = self
            .log_dir
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| std::env::temp_dir().join("jetprint-logs"));
        dir.join("jetprint.log")
    }

    pub fn log(&self, level: &str, message: &str) {
        let _guard = self.write_lock.lock();
        let path = self.log_file_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        let sanitized = message.replace('\n', " ");
        let line = format!("[{timestamp}] [{level}] {sanitized}\n");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = file.write_all(line.as_bytes());
        }
    }

    pub fn read_logs(&self, limit: usize) -> Result<Vec<String>, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|e| format!("Logger lock poisoned: {e}"))?;
        let path = self.log_file_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let contents =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read log file: {e}"))?;
        let mut lines: Vec<String> = contents.lines().map(str::to_string).collect();
        if lines.len() > limit {
            lines = lines.split_off(lines.len() - limit);
        }
        Ok(lines)
    }

    pub fn clear_logs(&self) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|e| format!("Logger lock poisoned: {e}"))?;
        let path = self.log_file_path();
        if path.exists() {
            fs::write(&path, "").map_err(|e| format!("Failed to clear log file: {e}"))?;
        }
        Ok(())
    }
}

