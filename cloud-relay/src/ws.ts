import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { RelayConfig } from './config.js';
import type { RelayStore } from './store.js';
import type {
  KioskToRelayMessage,
  PrintJobRecord,
  RelayToKioskMessage,
} from './types.js';

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  machineId?: string;
}

export class KioskWsHub {
  private wss: WebSocketServer;
  private sockets = new Map<string, ExtendedWebSocket>();
  private heartbeatTimer: NodeJS.Timeout;

  constructor(
    httpServer: HttpServer,
    private readonly store: RelayStore,
    private readonly config: RelayConfig
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;

      extWs.on('pong', () => {
        extWs.isAlive = true;
        if (extWs.machineId) {
          this.store.touchKiosk(extWs.machineId);
        }
      });

      extWs.on('message', (raw) => {
        this.handleMessage(extWs, raw.toString('utf8'));
      });

      extWs.on('close', () => {
        if (extWs.machineId && this.sockets.get(extWs.machineId) === extWs) {
          this.sockets.delete(extWs.machineId);
          this.store.setKioskOffline(extWs.machineId);
        }
      });
    });

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.wss.clients) {
        const ext = client as ExtendedWebSocket;
        if (!ext.isAlive) {
          ext.terminate();
          continue;
        }
        ext.isAlive = false;
        ext.ping();
      }
    }, 30_000);
    this.heartbeatTimer.unref();
  }

  private send(ws: WebSocket, msg: RelayToKioskMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private attachSocket(machineId: string, ws: ExtendedWebSocket): void {
    const prev = this.sockets.get(machineId);
    if (prev && prev !== ws && prev.readyState === WebSocket.OPEN) {
      prev.close(4000, 'Replaced by new connection');
    }
    ws.machineId = machineId;
    this.sockets.set(machineId, ws);
  }

  private flushPendingJobs(machineId: string): void {
    const pending = this.store.popPendingJobs(machineId);
    for (const job of pending) {
      this.dispatchJob(job);
    }
  }

  private handleMessage(ws: ExtendedWebSocket, rawText: string): void {
    let msg: KioskToRelayMessage;
    try {
      msg = JSON.parse(rawText) as KioskToRelayMessage;
    } catch {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Message must be valid JSON',
      });
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Missing message type',
      });
      return;
    }

    switch (msg.type) {
      case 'register': {
        const supported = (msg as any).supportedPaperSizes ?? (msg as any).supported_paper_sizes;
        const supportsColor = (msg as any).supportsColor ?? (msg as any).supports_color;
        const kiosk = this.store.registerKiosk(msg.machine_id, msg.pricing, supported, supportsColor);
        this.attachSocket(kiosk.machineId, ws);
        this.send(ws, {
          type: 'registered',
          machine_id: kiosk.machineId,
          auth_token: kiosk.authToken,
          pricing: kiosk.pricing,
          supportedPaperSizes: kiosk.supportedPaperSizes,
          supported_paper_sizes: kiosk.supportedPaperSizes,
          supportsColor: kiosk.supportsColor ?? true,
          supports_color: kiosk.supportsColor ?? true,
        });
        this.flushPendingJobs(kiosk.machineId);
        break;
      }

      case 'auth': {
        const supported = (msg as any).supportedPaperSizes ?? (msg as any).supported_paper_sizes;
        const supportsColor = (msg as any).supportsColor ?? (msg as any).supports_color;
        const result = this.store.authenticateKiosk(
          msg.machine_id,
          msg.auth_token,
          msg.pricing,
          supported,
          supportsColor
        );
        if (!result.ok) {
          this.send(ws, {
            type: 'error',
            code: 'AUTH_FAILED',
            message: result.reason,
          });
          return;
        }
        this.attachSocket(result.kiosk.machineId, ws);
        this.send(ws, {
          type: 'auth_ok',
          machine_id: result.kiosk.machineId,
          auth_token: result.kiosk.authToken,
          pricing: result.kiosk.pricing,
          supportedPaperSizes: result.kiosk.supportedPaperSizes,
          supported_paper_sizes: result.kiosk.supportedPaperSizes,
          supportsColor: result.kiosk.supportsColor ?? true,
          supports_color: result.kiosk.supportsColor ?? true,
        });
        this.flushPendingJobs(result.kiosk.machineId);
        break;
      }

      case 'pricing_update': {
        if (!ws.machineId) {
          this.send(ws, {
            type: 'error',
            code: 'UNAUTHENTICATED',
            message: 'Authenticate or register before updating pricing',
          });
          return;
        }
        const supported = (msg as any).supportedPaperSizes ?? (msg as any).supported_paper_sizes;
        const supportsColor = (msg as any).supportsColor ?? (msg as any).supports_color;
        const updated = this.store.updatePricing(
          ws.machineId,
          {
            bwPerPagePaise: msg.bwPerPagePaise,
            colorPerPagePaise: msg.colorPerPagePaise,
            shopName: msg.shopName,
          },
          supported,
          supportsColor
        );
        if (updated) {
          this.send(ws, {
            type: 'pricing_ack',
            pricing: updated.pricing,
            supportedPaperSizes: updated.supportedPaperSizes,
            supported_paper_sizes: updated.supportedPaperSizes,
            supportsColor: updated.supportsColor ?? true,
            supports_color: updated.supportsColor ?? true,
          });
        }
        break;
      }

      case 'paper_sizes_update':
      case 'config_update': {
        if (!ws.machineId) {
          this.send(ws, {
            type: 'error',
            code: 'UNAUTHENTICATED',
            message: 'Authenticate or register before updating config',
          });
          return;
        }
        const supported = (msg as any).supportedPaperSizes ?? (msg as any).supported_paper_sizes;
        if (Array.isArray(supported)) {
          this.store.updateSupportedPaperSizes(ws.machineId, supported);
        }
        const supportsColor = (msg as any).supportsColor ?? (msg as any).supports_color;
        if (typeof supportsColor === 'boolean') {
          this.store.updateSupportsColor(ws.machineId, supportsColor);
        }
        break;
      }

      case 'job_ack': {
        if (ws.machineId) {
          this.store.touchKiosk(ws.machineId);
        }
        if (msg.job_id) {
          this.store.acknowledgeJob(msg.job_id);
        }
        break;
      }

      case 'job_status_update': {
        if (!ws.machineId) {
          this.send(ws, {
            type: 'error',
            code: 'UNAUTHENTICATED',
            message: 'Authenticate or register before updating job status',
          });
          return;
        }
        this.store.touchKiosk(ws.machineId);
        const job = this.store.getJob(msg.job_id);
        if (!job || job.machineId !== ws.machineId) {
          this.send(ws, {
            type: 'error',
            code: 'JOB_NOT_FOUND',
            message: 'Job not found for this machine',
          });
          return;
        }
        if (
          msg.status === 'printing' ||
          msg.status === 'printed' ||
          msg.status === 'failed' ||
          msg.status === 'cancelled'
        ) {
          this.store.acknowledgeJob(msg.job_id);
          this.store.updateJobStatus(msg.job_id, msg.status, msg.error);
        }
        break;
      }

      case 'ping': {
        if (ws.machineId) {
          this.store.touchKiosk(ws.machineId);
        }
        this.send(ws, { type: 'pong' });
        break;
      }

      default: {
        this.send(ws, {
          type: 'error',
          code: 'UNKNOWN_TYPE',
          message: 'Unsupported message type',
        });
      }
    }
  }

  dispatchJob(job: PrintJobRecord, baseUrlOverride?: string): boolean {
    const ws = this.sockets.get(job.machineId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.store.queuePendingJob(job.machineId, job.jobId);
      return false;
    }

    if (!job.otp) {
      return false;
    }

    const base = (baseUrlOverride || this.config.publicUrl || '').replace(/\/+$/, '');
    const payload: RelayToKioskMessage = {
      type: 'job_dispatch',
      job_id: job.jobId,
      otp: job.otp,
      amount_paise: job.amountPaise,
      print_settings: job.printSettings,
      files: job.files.map((f) => ({
        file_id: f.fileId,
        filename: f.originalName,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        page_count: f.pageCount,
        settings: f.settings,
        download_url: base ? `${base}${f.downloadPath}` : f.downloadPath,
      })),
      created_at: new Date(job.createdAt).toISOString(),
    };

    this.send(ws, payload);
    this.store.markJobDispatched(job.jobId);
    return true;
  }

  close(): void {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
  }
}
