import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import multer from 'multer';
import type { RelayConfig } from '../config.js';
import { detectPageCount, isSupportedFile } from '../pdf.js';
import {
  createPaymentOrder,
  verifyRazorpayWebhookSignature,
} from '../razorpay.js';
import type { RelayStore } from '../store.js';
import type { JobFileRecord, PrintJobRecord } from '../types.js';
import type { KioskWsHub } from '../ws.js';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function getBaseUrl(req: Request, config: RelayConfig): string {
  if (config.publicUrl) return config.publicUrl;
  const host = req.get('host');
  if (!host) return '';
  return `${req.protocol}://${host}`;
}

function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return undefined;
}

export function createApiRouter(
  config: RelayConfig,
  store: RelayStore,
  wsHub: KioskWsHub
): Router {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 10,
      fileSize: 25 * 1024 * 1024, // 25 MB per file
    },
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      devMode: config.devMode,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  router.get('/machines/:machineId', (req: Request, res: Response) => {
    const machineId = String(req.params.machineId || '');
    const kiosk = store.getKiosk(machineId);
    if (!kiosk) {
      res.status(404).json({ error: 'Machine not found' });
      return;
    }
    res.json({
      machine_id: kiosk.machineId,
      online: kiosk.online,
      pricing: kiosk.pricing,
      dev_mode: config.devMode,
    });
  });

  router.post(
    '/jobs',
    upload.array('files', 10),
    async (req: Request, res: Response) => {
      try {
        const machineId = String(req.body?.machine_id || '').trim();
        if (!machineId) {
          res.status(400).json({ error: 'machine_id is required' });
          return;
        }

        const kiosk = store.getKiosk(machineId);
        if (!kiosk) {
          res.status(404).json({ error: 'Target kiosk machine_id not found' });
          return;
        }

        const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (uploadedFiles.length === 0) {
          res.status(400).json({ error: 'At least one PDF or image file is required' });
          return;
        }

        for (const f of uploadedFiles) {
          if (!isSupportedFile(f.mimetype, f.originalname)) {
            res.status(400).json({
              error: `Unsupported file type: ${f.originalname} (${f.mimetype}). Allowed: PDF, PNG, JPG, WEBP`,
            });
            return;
          }
        }

        const rawCopies = Number(req.body?.copies ?? 1);
        const copies =
          Number.isFinite(rawCopies) && rawCopies >= 1
            ? Math.min(100, Math.floor(rawCopies))
            : 1;
        const color =
          req.body?.color === true ||
          req.body?.color === 'true' ||
          req.body?.color === '1';

        const jobId = `job_${crypto.randomBytes(6).toString('hex')}`;
        const jobDir = path.join(config.uploadDir, jobId);
        await fs.mkdir(jobDir, { recursive: true });

        const fileRecords: JobFileRecord[] = [];
        let pagesPerCopy = 0;

        for (const f of uploadedFiles) {
          const fileId = `file_${crypto.randomBytes(4).toString('hex')}`;
          const safeName = path.basename(f.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
          const storagePath = path.join(jobDir, `${fileId}_${safeName}`);
          await fs.writeFile(storagePath, f.buffer);

          const pageCount = await detectPageCount(f.buffer, f.mimetype, f.originalname);
          pagesPerCopy += pageCount;

          fileRecords.push({
            fileId,
            originalName: f.originalname,
            mimeType: f.mimetype || 'application/octet-stream',
            sizeBytes: f.size,
            pageCount,
            storagePath,
            downloadPath: `/api/jobs/${jobId}/files/${fileId}`,
          });
        }

        const totalPages = pagesPerCopy * copies;
        const pricePerPage = color
          ? kiosk.pricing.colorPerPagePaise
          : kiosk.pricing.bwPerPagePaise;
        const amountPaise = totalPages * pricePerPage;

        const order = await createPaymentOrder(config, {
          amountPaise,
          receipt: jobId,
          notes: {
            job_id: jobId,
            machine_id: machineId,
          },
        });

        const job: PrintJobRecord = {
          jobId,
          machineId,
          orderId: order.orderId,
          status: 'pending_payment',
          printSettings: { copies, color },
          totalPages,
          amountPaise,
          pricingSnapshot: { ...kiosk.pricing },
          files: fileRecords,
          createdAt: Date.now(),
        };
        store.createJob(job);

        res.status(201).json({
          job_id: job.jobId,
          machine_id: job.machineId,
          order_id: job.orderId,
          amount_paise: job.amountPaise,
          currency: 'INR',
          pages_per_copy: pagesPerCopy,
          total_pages: totalPages,
          print_settings: job.printSettings,
          pricing: job.pricingSnapshot,
          files: job.files.map((f) => ({
            file_id: f.fileId,
            filename: f.originalName,
            mime_type: f.mimeType,
            size_bytes: f.sizeBytes,
            page_count: f.pageCount,
          })),
          dev_mode: order.devMode,
          razorpay_key_id: order.keyId ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create print job';
        res.status(500).json({ error: message });
      }
    }
  );

  router.get('/jobs/:jobId/status', (req: Request, res: Response) => {
    const job = store.getJob(String(req.params.jobId || ''));
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({
      job_id: job.jobId,
      machine_id: job.machineId,
      status: job.status,
      amount_paise: job.amountPaise,
      otp: job.status === 'paid' || job.status === 'dispatched' ? job.otp : undefined,
    });
  });

  router.get('/jobs/:jobId/files/:fileId', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing kiosk auth token' });
      return;
    }

    const job = store.getJob(String(req.params.jobId || ''));
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const kiosk = store.getKiosk(job.machineId);
    if (!kiosk || kiosk.authToken !== token) {
      res.status(403).json({ error: 'Invalid auth token for this machine' });
      return;
    }

    const file = job.files.find((f) => f.fileId === req.params.fileId);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    try {
      await fs.access(file.storagePath);
    } catch {
      res.status(410).json({ error: 'File expired or no longer available' });
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`
    );
    res.sendFile(file.storagePath);
  });

  router.post('/webhooks/razorpay', (req: RawBodyRequest, res: Response) => {
    const signature = req.get('x-razorpay-signature');
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (
      !verifyRazorpayWebhookSignature(
        rawBody,
        signature,
        config.razorpayWebhookSecret
      )
    ) {
      res.status(401).json({ error: 'Invalid Razorpay webhook signature' });
      return;
    }

    const event = req.body as {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string } };
        order?: { entity?: { id?: string } };
      };
    };

    const eventType = event?.event;
    if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
      res.status(200).json({ ok: true, ignored: true, event: eventType });
      return;
    }

    const orderId =
      event.payload?.payment?.entity?.order_id ??
      event.payload?.order?.entity?.id;
    const paymentId = event.payload?.payment?.entity?.id;

    if (!orderId) {
      res.status(400).json({ error: 'Missing order_id in webhook payload' });
      return;
    }

    const result = store.markJobPaidAndGenerateOtp(orderId, paymentId);
    if (!result) {
      res.status(404).json({ error: 'No print job found for order_id' });
      return;
    }

    const dispatched = result.newlyPaid
      ? wsHub.dispatchJob(result.job, getBaseUrl(req, config))
      : result.job.status === 'dispatched';

    res.status(200).json({
      ok: true,
      job_id: result.job.jobId,
      status: result.job.status,
      dispatched,
    });
  });

  router.post('/dev/jobs/:jobId/pay', (req: Request, res: Response) => {
    if (!config.devMode) {
      res.status(403).json({ error: 'Dev payment simulation is disabled when Razorpay keys are configured' });
      return;
    }

    const jobId = String(req.params.jobId || '');
    const result = store.markJobPaidAndGenerateOtp(
      jobId,
      `pay_dev_${crypto.randomBytes(6).toString('hex')}`
    );
    if (!result) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const dispatched = result.newlyPaid
      ? wsHub.dispatchJob(result.job, getBaseUrl(req, config))
      : result.job.status === 'dispatched';

    res.status(200).json({
      ok: true,
      job_id: result.job.jobId,
      otp: result.job.otp,
      status: result.job.status,
      dispatched,
    });
  });

  return router;
}
