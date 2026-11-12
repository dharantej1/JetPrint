export type KioskMode = "self_service" | "owner";
export type JobStatus = "pending" | "printing" | "printed" | "failed";

export interface KioskState {
  machineId: string;
  relayUrl: string;
  bwPricePaise: number;
  colorPricePaise: number;
  defaultPrinter: string | null;
  kioskMode: KioskMode;
  setupComplete: boolean;
  relayConnected: boolean;
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
  machineId: string;
  message: string | null;
}
