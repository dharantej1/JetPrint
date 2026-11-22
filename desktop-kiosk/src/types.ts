export type KioskMode = "self_service" | "owner";
export type JobStatus = "pending" | "printing" | "printed" | "failed" | "expired" | "cancelled";
export type RelayStatus = "connecting" | "connected" | "error" | "disconnected";

export type PrinterPoolType = "bw" | "color" | "large_format" | "default";

export interface ConfiguredPrinter {
  id: string;
  systemName?: string;
  name: string;
  nickname?: string;
  enabled: boolean;
  capabilities: string[];
  pool: PrinterPoolType;
  isDefault?: boolean;
  state?: string;
}

export interface PrinterPoolConfig {
  id?: string;
  name?: string;
  poolType: PrinterPoolType;
  printerIds?: string[];
  printerNames?: string[];
}

export interface KioskState {
  machineId: string;
  relayUrl: string;
  qrRelayUrl: string;
  bwPricePaise: number;
  colorPricePaise: number;
  defaultPrinter: string | null;
  supportedPaperSizes: string[];
  kioskMode: KioskMode;
  setupComplete: boolean;
  relayConnected: boolean;
  relayStatus: RelayStatus;
  relayMessage: string | null;
  relayAuthError: string | null;
  existingDataPrompt: boolean;
  existingJobCount: number;
  storagePath: string;
  configuredPrinters?: ConfiguredPrinter[];
  printerPools?: PrinterPoolConfig[];
  rushMode?: boolean;
  rushHourAutoPrint?: boolean;
}

export interface CompleteFirstRunResult {
  recoveryPhrase: string;
  state: KioskState;
}

export interface UpdateSettingsInput {
  relayUrl?: string;
  bwPricePaise?: number;
  colorPricePaise?: number;
  defaultPrinter?: string;
  supportedPaperSizes?: string[];
  kioskMode?: KioskMode;
  configuredPrinters?: ConfiguredPrinter[];
  rushMode?: boolean;
  rushHourAutoPrint?: boolean;
}

export interface PrinterInfo {
  name: string;
  systemName: string;
  driverName: string;
  isDefault: boolean;
  state: string;
}

export interface FilePrintSettings {
  copies: number;
  color: boolean;
  duplex: string;
  orientation: string;
  pagesPerSheet: number;
  pageRange: string;
  printReady: boolean;
  paperSize?: string;
}

export interface JobFile {
  fileId: string;
  filename: string;
  mimeType: string;
  localPath: string;
  pages: number;
  settings?: FilePrintSettings;
  assignedPrinter?: string;
}

export interface PrintJob {
  id: string;
  otp: string;
  files: JobFile[];
  copies: number;
  color: boolean;
  status: JobStatus;
  createdAt: string;
  printedAt: string | null;
}

export interface PrintResult {
  job: PrintJob;
  message: string;
}

export interface RelayStatusEvent {
  connected: boolean;
  status: RelayStatus;
  machineId: string;
  message: string | null;
  authError: string | null;
}
