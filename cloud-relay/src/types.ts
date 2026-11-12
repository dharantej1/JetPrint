export interface PricingConfig {
  /** Price per B&W page in paise (1 INR = 100 paise) */
  bwPerPagePaise: number;
  /** Price per Color page in paise (1 INR = 100 paise) */
  colorPerPagePaise: number;
  /** Optional shop display name */
  shopName?: string;
}

export interface KioskRecord {
  machineId: string;
  authToken: string;
  pricing: PricingConfig;
  online: boolean;
  lastSeenAt: number;
  createdAt: number;
}

export interface PrintSettings {
  copies: number;
  color: boolean;
}

export type DuplexMode = '1-sided' | '2-sided';
export type OrientationMode = 'portrait' | 'landscape';
export type PagesPerSheet = 1 | 2 | 4 | 6;

export interface FilePrintSettings {
  copies: number;
  color: boolean;
  duplex: DuplexMode;
  orientation: OrientationMode;
  pagesPerSheet: PagesPerSheet;
  pageRange: string;
}

export interface JobFileRecord {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  selectedPages: number;
  billableSheets: number;
  amountPaise: number;
  settings: FilePrintSettings;
  storagePath: string;
  downloadPath: string;
}

export type JobStatus =
  | 'pending_payment'
  | 'paid'
  | 'dispatched'
  | 'printing'
  | 'printed'
  | 'failed'
  | 'expired';

export interface PrintJobRecord {
  jobId: string;
  machineId: string;
  orderId: string;
  paymentId?: string;
  status: JobStatus;
  statusError?: string;
  otp?: string;
  printSettings: PrintSettings;
  totalPages: number;
  amountPaise: number;
  pricingSnapshot: PricingConfig;
  files: JobFileRecord[];
  createdAt: number;
  paidAt?: number;
  dispatchedAt?: number;
}

// ============================================================================
// WebSocket Protocol Messages (Kiosk <-> Cloud Relay)
// ============================================================================

/** Kiosk -> Relay: Register a new kiosk (or authenticate an existing one) */
export type KioskToRelayMessage =
  | {
      type: 'register';
      machine_id?: string;
      pricing?: Partial<PricingConfig>;
    }
  | {
      type: 'auth';
      machine_id: string;
      auth_token?: string;
      pricing?: Partial<PricingConfig>;
    }
  | {
      type: 'pricing_update';
      bwPerPagePaise: number;
      colorPerPagePaise: number;
      shopName?: string;
    }
  | {
      type: 'job_ack';
      job_id: string;
    }
  | {
      type: 'job_status_update';
      job_id: string;
      status: 'printing' | 'printed' | 'failed';
      error?: string;
    }
  | {
      type: 'ping';
    };

/** Relay -> Kiosk: Responses and dispatched print jobs */
export type RelayToKioskMessage =
  | {
      type: 'registered';
      machine_id: string;
      auth_token: string;
      pricing: PricingConfig;
    }
  | {
      type: 'auth_ok';
      machine_id: string;
      auth_token: string;
      pricing: PricingConfig;
    }
  | {
      type: 'pricing_ack';
      pricing: PricingConfig;
    }
  | {
      type: 'job_dispatch';
      job_id: string;
      otp: string;
      amount_paise: number;
      print_settings: PrintSettings;
      files: Array<{
        file_id: string;
        filename: string;
        mime_type: string;
        size_bytes: number;
        page_count: number;
        settings: FilePrintSettings;
        download_url: string;
      }>;
      created_at: string;
    }
  | {
      type: 'pong';
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
