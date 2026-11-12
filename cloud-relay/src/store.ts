import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RelayConfig } from './config.js';
import type {
  KioskRecord,
  PricingConfig,
  PrintJobRecord,
} from './types.js';

export class RelayStore {
  private kiosks = new Map<string, KioskRecord>();
  private jobs = new Map<string, PrintJobRecord>();
  private orderToJob = new Map<string, string>();
  private pendingDispatch = new Map<string, string[]>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly config: RelayConfig) {}

  startCleanupLoop(): void {
    if (this.cleanupTimer) return;
    const intervalMs = Math.min(this.config.fileTtlMs, 5 * 60 * 1000);
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredJobs();
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  stopCleanupLoop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private mergePricing(
    base: PricingConfig,
    patch?: Partial<PricingConfig>
  ): PricingConfig {
    return {
      bwPerPagePaise:
        typeof patch?.bwPerPagePaise === 'number' && patch.bwPerPagePaise > 0
          ? Math.round(patch.bwPerPagePaise)
          : base.bwPerPagePaise,
      colorPerPagePaise:
        typeof patch?.colorPerPagePaise === 'number' && patch.colorPerPagePaise > 0
          ? Math.round(patch.colorPerPagePaise)
          : base.colorPerPagePaise,
      shopName: patch?.shopName !== undefined ? patch.shopName : base.shopName,
    };
  }

  defaultPricing(): PricingConfig {
    return {
      bwPerPagePaise: this.config.defaultBwPricePaise,
      colorPerPagePaise: this.config.defaultColorPricePaise,
    };
  }

  registerKiosk(
    preferredMachineId?: string,
    pricingPatch?: Partial<PricingConfig>
  ): KioskRecord {
    const cleanPreferred = preferredMachineId?.trim();
    let machineId =
      cleanPreferred && !this.kiosks.has(cleanPreferred)
        ? cleanPreferred
        : `kiosk_${crypto.randomBytes(4).toString('hex')}`;

    while (this.kiosks.has(machineId)) {
      machineId = `kiosk_${crypto.randomBytes(4).toString('hex')}`;
    }

    const now = Date.now();
    const record: KioskRecord = {
      machineId,
      authToken: `tok_${crypto.randomBytes(24).toString('hex')}`,
      pricing: this.mergePricing(this.defaultPricing(), pricingPatch),
      online: true,
      lastSeenAt: now,
      createdAt: now,
    };
    this.kiosks.set(machineId, record);
    return record;
  }

  authenticateKiosk(
    machineId: string,
    authToken?: string,
    pricingPatch?: Partial<PricingConfig>
  ):
    | { ok: true; kiosk: KioskRecord; newlyRegistered: boolean }
    | { ok: false; reason: string } {
    const cleanId = machineId.trim();
    if (!cleanId) {
      return { ok: false, reason: 'machine_id is required' };
    }

    const existing = this.kiosks.get(cleanId);
    if (!existing) {
      const now = Date.now();
      const record: KioskRecord = {
        machineId: cleanId,
        authToken:
          authToken && authToken.trim().length > 0
            ? authToken.trim()
            : `tok_${crypto.randomBytes(24).toString('hex')}`,
        pricing: this.mergePricing(this.defaultPricing(), pricingPatch),
        online: true,
        lastSeenAt: now,
        createdAt: now,
      };
      this.kiosks.set(cleanId, record);
      return { ok: true, kiosk: record, newlyRegistered: true };
    }

    if (!authToken || existing.authToken !== authToken) {
      return { ok: false, reason: 'Invalid auth_token for machine_id' };
    }

    existing.online = true;
    existing.lastSeenAt = Date.now();
    if (pricingPatch) {
      existing.pricing = this.mergePricing(existing.pricing, pricingPatch);
    }
    return { ok: true, kiosk: existing, newlyRegistered: false };
  }

  updatePricing(
    machineId: string,
    pricingPatch: Partial<PricingConfig>
  ): KioskRecord | undefined {
    const kiosk = this.kiosks.get(machineId);
    if (!kiosk) return undefined;
    kiosk.pricing = this.mergePricing(kiosk.pricing, pricingPatch);
    kiosk.lastSeenAt = Date.now();
    return kiosk;
  }

  setKioskOffline(machineId: string): void {
    const kiosk = this.kiosks.get(machineId);
    if (kiosk) {
      kiosk.online = false;
      kiosk.lastSeenAt = Date.now();
    }
  }

  touchKiosk(machineId: string): void {
    const kiosk = this.kiosks.get(machineId);
    if (kiosk) {
      kiosk.lastSeenAt = Date.now();
    }
  }

  getKiosk(machineId: string): KioskRecord | undefined {
    return this.kiosks.get(machineId);
  }

  verifyToken(token: string): KioskRecord | undefined {
    for (const kiosk of this.kiosks.values()) {
      if (kiosk.authToken === token) {
        return kiosk;
      }
    }
    return undefined;
  }

  createJob(job: PrintJobRecord): void {
    this.jobs.set(job.jobId, job);
    this.orderToJob.set(job.orderId, job.jobId);
  }

  getJob(jobId: string): PrintJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  getJobByOrderId(orderId: string): PrintJobRecord | undefined {
    const jobId = this.orderToJob.get(orderId);
    return jobId ? this.jobs.get(jobId) : undefined;
  }

  markJobPaidAndGenerateOtp(
    jobIdOrOrderId: string,
    paymentId?: string
  ): { job: PrintJobRecord; newlyPaid: boolean } | undefined {
    const job =
      this.jobs.get(jobIdOrOrderId) ?? this.getJobByOrderId(jobIdOrOrderId);
    if (!job) return undefined;

    if (job.status === 'paid' || job.status === 'dispatched') {
      return { job, newlyPaid: false };
    }

    job.otp = crypto.randomInt(100000, 1000000).toString();
    job.status = 'paid';
    job.paidAt = Date.now();
    if (paymentId) {
      job.paymentId = paymentId;
    }
    return { job, newlyPaid: true };
  }

  markJobDispatched(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'dispatched';
      job.dispatchedAt = Date.now();
    }
  }

  updateJobStatus(
    jobId: string,
    status: 'printing' | 'printed' | 'failed' | 'cancelled',
    error?: string
  ): PrintJobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.status = status;
    job.statusError = error;
    return job;
  }

  queuePendingJob(machineId: string, jobId: string): void {
    const list = this.pendingDispatch.get(machineId) ?? [];
    if (!list.includes(jobId)) {
      list.push(jobId);
      this.pendingDispatch.set(machineId, list);
    }
  }

  popPendingJobs(machineId: string): PrintJobRecord[] {
    const ids = this.pendingDispatch.get(machineId) ?? [];
    this.pendingDispatch.delete(machineId);
    return ids
      .map((id) => this.jobs.get(id))
      .filter((j): j is PrintJobRecord => Boolean(j));
  }

  async cleanupExpiredJobs(now = Date.now()): Promise<number> {
    let cleaned = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (now - job.createdAt > this.config.fileTtlMs) {
        this.jobs.delete(jobId);
        this.orderToJob.delete(job.orderId);
        const jobDir = path.join(this.config.uploadDir, jobId);
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
        cleaned++;
      }
    }
    return cleaned;
  }
}
