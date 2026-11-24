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
  private otpToJob = new Map<string, string>();
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

  private normalizePaperSizes(sizes?: string[]): string[] {
    if (!sizes || !Array.isArray(sizes) || sizes.length === 0) {
      return ['A4'];
    }
    const clean = sizes
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0);
    return clean.length > 0 ? clean : ['A4'];
  }

  defaultPricing(): PricingConfig {
    return {
      bwPerPagePaise: this.config.defaultBwPricePaise,
      colorPerPagePaise: this.config.defaultColorPricePaise,
    };
  }

  registerKiosk(
    preferredMachineId?: string,
    pricingPatch?: Partial<PricingConfig> & { supportsColor?: boolean; supports_color?: boolean },
    supportedPaperSizes?: string[],
    supportsColor?: boolean
  ): KioskRecord {
    const cleanPreferred = preferredMachineId?.trim();
    let machineId: string;
    if (cleanPreferred) {
      machineId = cleanPreferred;
    } else {
      machineId = `kiosk_${crypto.randomBytes(4).toString('hex')}`;
      while (this.kiosks.has(machineId)) {
        machineId = `kiosk_${crypto.randomBytes(4).toString('hex')}`;
      }
    }

    const now = Date.now();
    const existing = this.kiosks.get(machineId);
    const paperSizes = supportedPaperSizes
      ? this.normalizePaperSizes(supportedPaperSizes)
      : existing?.supportedPaperSizes ?? ['A4'];

    const patchColor = (pricingPatch as any)?.supportsColor ?? (pricingPatch as any)?.supports_color;
    const resolvedSupportsColor =
      supportsColor !== undefined
        ? supportsColor
        : patchColor !== undefined
        ? patchColor
        : existing?.supportsColor !== undefined
        ? existing.supportsColor
        : true;

    const record: KioskRecord = {
      machineId,
      authToken: `tok_${crypto.randomBytes(24).toString('hex')}`,
      pricing: this.mergePricing(existing?.pricing ?? this.defaultPricing(), pricingPatch),
      online: true,
      lastSeenAt: now,
      createdAt: existing?.createdAt ?? now,
      supportedPaperSizes: paperSizes,
      supportsColor: resolvedSupportsColor,
    };
    this.kiosks.set(machineId, record);
    return record;
  }

  authenticateKiosk(
    machineId: string,
    authToken?: string,
    pricingPatch?: Partial<PricingConfig> & { supportsColor?: boolean; supports_color?: boolean },
    supportedPaperSizes?: string[],
    supportsColor?: boolean
  ):
    | { ok: true; kiosk: KioskRecord; newlyRegistered: boolean }
    | { ok: false; reason: string } {
    const cleanId = machineId.trim();
    if (!cleanId) {
      return { ok: false, reason: 'machine_id is required' };
    }

    const patchColor = (pricingPatch as any)?.supportsColor ?? (pricingPatch as any)?.supports_color;
    const resolvedSupportsColor =
      supportsColor !== undefined
        ? supportsColor
        : patchColor !== undefined
        ? patchColor
        : undefined;

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
        supportedPaperSizes: this.normalizePaperSizes(supportedPaperSizes),
        supportsColor: resolvedSupportsColor !== undefined ? resolvedSupportsColor : true,
      };
      this.kiosks.set(cleanId, record);
      return { ok: true, kiosk: record, newlyRegistered: true };
    }

    if (!authToken || existing.authToken !== authToken) {
      if (!authToken) {
        existing.authToken = `tok_${crypto.randomBytes(24).toString('hex')}`;
        existing.online = true;
        existing.lastSeenAt = Date.now();
        if (pricingPatch) {
          existing.pricing = this.mergePricing(existing.pricing, pricingPatch);
        }
        if (supportedPaperSizes) {
          existing.supportedPaperSizes = this.normalizePaperSizes(supportedPaperSizes);
        }
        if (resolvedSupportsColor !== undefined) {
          existing.supportsColor = resolvedSupportsColor;
        }
        return { ok: true, kiosk: existing, newlyRegistered: true };
      }
      return { ok: false, reason: 'Invalid auth_token for machine_id' };
    }

    existing.online = true;
    existing.lastSeenAt = Date.now();
    if (pricingPatch) {
      existing.pricing = this.mergePricing(existing.pricing, pricingPatch);
    }
    if (supportedPaperSizes) {
      existing.supportedPaperSizes = this.normalizePaperSizes(supportedPaperSizes);
    }
    if (resolvedSupportsColor !== undefined) {
      existing.supportsColor = resolvedSupportsColor;
    }
    return { ok: true, kiosk: existing, newlyRegistered: false };
  }

  updatePricing(
    machineId: string,
    pricingPatch: Partial<PricingConfig> & { supportsColor?: boolean; supports_color?: boolean },
    supportedPaperSizes?: string[],
    supportsColor?: boolean
  ): KioskRecord | undefined {
    const kiosk = this.kiosks.get(machineId);
    if (!kiosk) return undefined;
    kiosk.pricing = this.mergePricing(kiosk.pricing, pricingPatch);
    if (supportedPaperSizes) {
      kiosk.supportedPaperSizes = this.normalizePaperSizes(supportedPaperSizes);
    }
    const patchColor = (pricingPatch as any)?.supportsColor ?? (pricingPatch as any)?.supports_color;
    if (supportsColor !== undefined) {
      kiosk.supportsColor = supportsColor;
    } else if (patchColor !== undefined) {
      kiosk.supportsColor = patchColor;
    }
    kiosk.lastSeenAt = Date.now();
    return kiosk;
  }

  updateSupportsColor(
    machineId: string,
    supportsColor: boolean
  ): KioskRecord | undefined {
    const kiosk = this.kiosks.get(machineId);
    if (!kiosk) return undefined;
    kiosk.supportsColor = supportsColor;
    kiosk.lastSeenAt = Date.now();
    return kiosk;
  }

  updateSupportedPaperSizes(
    machineId: string,
    sizes: string[]
  ): KioskRecord | undefined {
    const kiosk = this.kiosks.get(machineId);
    if (!kiosk) return undefined;
    kiosk.supportedPaperSizes = this.normalizePaperSizes(sizes);
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
    if (job.otp) {
      this.otpToJob.set(job.otp, job.jobId);
    }
  }

  getJob(jobId: string): PrintJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  getJobByOrderId(orderId: string): PrintJobRecord | undefined {
    const jobId = this.orderToJob.get(orderId);
    return jobId ? this.jobs.get(jobId) : undefined;
  }

  getJobByOtp(otp: string): PrintJobRecord | undefined {
    const clean = otp.trim();
    if (!clean) return undefined;
    const jobId = this.otpToJob.get(clean);
    if (jobId) {
      const job = this.jobs.get(jobId);
      if (job && job.otp === clean) return job;
    }
    for (const job of this.jobs.values()) {
      if (job.otp === clean) {
        this.otpToJob.set(clean, job.jobId);
        return job;
      }
    }
    return undefined;
  }

  markJobPaidAndGenerateOtp(
    jobIdOrOrderId: string,
    paymentId?: string,
    customOtp?: string
  ): { job: PrintJobRecord; newlyPaid: boolean } | undefined {
    const job =
      this.jobs.get(jobIdOrOrderId) ?? this.getJobByOrderId(jobIdOrOrderId);
    if (!job) return undefined;

    if (job.status === 'paid' || job.status === 'dispatched') {
      return { job, newlyPaid: false };
    }

    job.otp =
      customOtp && customOtp.trim()
        ? customOtp.trim()
        : crypto.randomInt(100000, 1000000).toString();
    this.otpToJob.set(job.otp, job.jobId);
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

  acknowledgeJob(jobId: string): PrintJobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.acknowledged = true;
    job.acknowledgedAt = Date.now();
    return job;
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

  getUnacknowledgedPaidJobs(machineId: string): PrintJobRecord[] {
    const ids = new Set(this.pendingDispatch.get(machineId) ?? []);
    this.pendingDispatch.delete(machineId);

    const result: PrintJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.machineId !== machineId) continue;
      if (!job.otp) continue;
      // Only jobs that are paid or dispatched (not printed, failed, or cancelled)
      if (job.status !== 'paid' && job.status !== 'dispatched') continue;
      // Do not re-dispatch jobs that have already been acknowledged
      if (job.acknowledged || job.acknowledgedAt) continue;

      result.push(job);
      ids.delete(job.jobId);
    }

    // Also include any jobs explicitly queued that are still valid and unacknowledged
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (
        job &&
        job.machineId === machineId &&
        job.otp &&
        job.status !== 'printed' &&
        job.status !== 'cancelled' &&
        !job.acknowledged &&
        !job.acknowledgedAt &&
        !result.some((r) => r.jobId === job.jobId)
      ) {
        result.push(job);
      }
    }

    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  popPendingJobs(machineId: string): PrintJobRecord[] {
    return this.getUnacknowledgedPaidJobs(machineId);
  }

  getActiveJobs(machineId: string): PrintJobRecord[] {
    const active: PrintJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.machineId !== machineId) continue;
      if (!job.otp) continue;
      if (
        job.status === 'printed' ||
        job.status === 'cancelled' ||
        job.status === 'pending_payment' ||
        job.status === 'expired'
      ) {
        continue;
      }
      active.push(job);
    }
    return active.sort((a, b) => a.createdAt - b.createdAt);
  }

  async cleanupExpiredJobs(now = Date.now()): Promise<number> {
    let cleaned = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (now - job.createdAt > this.config.fileTtlMs) {
        this.jobs.delete(jobId);
        this.orderToJob.delete(job.orderId);
        if (job.otp) {
          this.otpToJob.delete(job.otp);
        }
        const jobDir = path.join(this.config.uploadDir, jobId);
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
        cleaned++;
      }
    }
    return cleaned;
  }
}
