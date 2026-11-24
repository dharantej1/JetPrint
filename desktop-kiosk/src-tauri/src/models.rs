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
    Expired,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Printing => "printing",
            JobStatus::Printed => "printed",
            JobStatus::Failed => "failed",
            JobStatus::Expired => "expired",
            JobStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "printing" => JobStatus::Printing,
            "printed" => JobStatus::Printed,
            "failed" => JobStatus::Failed,
            "expired" => JobStatus::Expired,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrinterPoolType {
    Bw,
    Color,
    LargeFormat,
    Default,
}

impl PrinterPoolType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PrinterPoolType::Bw => "bw",
            PrinterPoolType::Color => "color",
            PrinterPoolType::LargeFormat => "large_format",
            PrinterPoolType::Default => "default",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "bw" | "b&w" | "monochrome" => PrinterPoolType::Bw,
            "color" | "colour" => PrinterPoolType::Color,
            "large_format" | "largeformat" | "large" => PrinterPoolType::LargeFormat,
            _ => PrinterPoolType::Default,
        }
    }
}

impl std::fmt::Display for PrinterPoolType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

fn default_true() -> bool {
    true
}

fn default_pool_type() -> PrinterPoolType {
    PrinterPoolType::Default
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredPrinter {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_pool_type")]
    pub pool: PrinterPoolType,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterPoolConfig {
    pub pool_type: PrinterPoolType,
    pub printer_ids: Vec<String>,
}

pub fn default_supported_paper_sizes() -> Vec<String> {
    vec!["A4".to_string()]
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
    pub supported_paper_sizes: Vec<String>,
    pub kiosk_mode: KioskMode,
    pub setup_complete: bool,
    pub exe_fingerprint: Option<String>,
    pub rush_mode: bool,
    pub supports_color: bool,
}

pub type KioskConfig = AppConfig;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelayConnectionStatus {
    Connecting,
    Connected,
    Error,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskState {
    pub machine_id: String,
    pub relay_url: String,
    pub qr_relay_url: String,
    pub bw_price_paise: i64,
    pub color_price_paise: i64,
    pub default_printer: Option<String>,
    pub supported_paper_sizes: Vec<String>,
    pub kiosk_mode: KioskMode,
    pub setup_complete: bool,
    pub relay_connected: bool,
    pub relay_status: RelayConnectionStatus,
    pub relay_message: Option<String>,
    pub relay_auth_error: Option<String>,
    pub existing_data_prompt: bool,
    pub existing_job_count: usize,
    pub storage_path: String,
    #[serde(default)]
    pub rush_mode: bool,
    #[serde(default = "default_true")]
    pub supports_color: bool,
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
    pub supported_paper_sizes: Option<Vec<String>>,
    pub kiosk_mode: Option<KioskMode>,
    pub rush_mode: Option<bool>,
    pub supports_color: Option<bool>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilePrintSettings {
    #[serde(default = "default_copies")]
    pub copies: u32,
    #[serde(default)]
    pub color: bool,
    #[serde(default = "default_duplex")]
    pub duplex: String,
    #[serde(default = "default_orientation")]
    pub orientation: String,
    #[serde(default = "default_pages_per_sheet")]
    pub pages_per_sheet: u32,
    #[serde(default = "default_page_range")]
    pub page_range: String,
    #[serde(default)]
    pub print_ready: bool,
    #[serde(default, alias = "paper_size")]
    pub paper_size: Option<String>,
}

fn default_copies() -> u32 {
    1
}

fn default_duplex() -> String {
    "1-sided".to_string()
}

fn default_orientation() -> String {
    "portrait".to_string()
}

fn default_pages_per_sheet() -> u32 {
    1
}

fn default_page_range() -> String {
    "all".to_string()
}

impl Default for FilePrintSettings {
    fn default() -> Self {
        Self {
            copies: default_copies(),
            color: false,
            duplex: default_duplex(),
            orientation: default_orientation(),
            pages_per_sheet: default_pages_per_sheet(),
            page_range: default_page_range(),
            print_ready: false,
            paper_size: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobFile {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    pub local_path: String,
    pub pages: u32,
    #[serde(default)]
    pub settings: Option<FilePrintSettings>,
    #[serde(default)]
    pub assigned_printer: Option<String>,
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
    pub status: RelayConnectionStatus,
    pub machine_id: String,
    pub message: Option<String>,
    pub auth_error: Option<String>,
}

