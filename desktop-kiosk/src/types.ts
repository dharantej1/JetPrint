export type KioskMode = "self_service" | "owner";
export type JobStatus = "pending" | "printing" | "printed" | "failed" | "expired" | "cancelled";
export type RelayStatus = "connecting" | "connected" | "error" | "disconnected";

export interface KioskState {
  machineId: string;
  relayUrl: string;
  qrRelayUrl: string;
  bwPricePaise: number;
  colorPricePaise: number;
  defaultPrinter: string | null;
  kioskMode: KioskMode;
  setupComplete: boolean;
  relayConnected: boolean;
  relayStatus: RelayStatus;
  relayMessage: string | null;
  relayAuthError: string | null;
  existingDataPrompt: boolean;
  existingJobCount: number;
  storagePath: string;
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
  kioskMode?: KioskMode;
}

export interface PrinterInfo {
  name: string;
  systemName: string;
  driverName: string;
  isDefault: boolean;
  state: string;
}

export interface JobFile {
  fileId: string;
  filename: string;
  mimeType: string;
  localPath: string;
  pages: number;
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
