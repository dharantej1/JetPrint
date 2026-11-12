use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KioskMode {
    SelfService,
    Owner,
}

impl KioskMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            KioskMode::SelfService => "self_service",
            KioskMode::Owner => "owner",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "owner" => KioskMode::Owner,
            _ => KioskMode::SelfService,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Printing,
    Printed,
    Failed,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Printing => "printing",
            JobStatus::Printed => "printed",
            JobStatus::Failed => "failed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "printing" => JobStatus::Printing,
            "printed" => JobStatus::Printed,
            "failed" => JobStatus::Failed,
            _ => JobStatus::Pending,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub machine_id: String,
    pub relay_url: String,
    pub auth_token: Option<String>,
    pub password_hash: Option<String>,
    pub recovery_phrase_hash: Option<String>,
    pub bw_price_paise: i64,
    pub color_price_paise: i64,
    pub default_printer: Option<String>,
    pub kiosk_mode: KioskMode,
    pub setup_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskState {
    pub machine_id: String,
    pub relay_url: String,
    pub bw_price_paise: i64,
    pub color_price_paise: i64,
    pub default_printer: Option<String>,
    pub kiosk_mode: KioskMode,
    pub setup_complete: bool,
    pub relay_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteFirstRunResult {
    pub recovery_phrase: String,
    pub state: KioskState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsInput {
    pub relay_url: Option<String>,
    pub bw_price_paise: Option<i64>,
    pub color_price_paise: Option<i64>,
    pub default_printer: Option<String>,
    pub kiosk_mode: Option<KioskMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub system_name: String,
    pub driver_name: String,
    pub is_default: bool,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobFile {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    pub local_path: String,
    pub pages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: String,
    pub otp: String,
    pub files: Vec<JobFile>,
    pub copies: u32,
    pub color: bool,
    pub status: JobStatus,
    pub created_at: String,
    pub printed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintResult {
    pub job: PrintJob,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatusEvent {
    pub connected: bool,
    pub machine_id: String,
    pub message: Option<String>,
}

