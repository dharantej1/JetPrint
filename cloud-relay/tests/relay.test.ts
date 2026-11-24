import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, type RelayServerInstance } from '../src/app.js';
import {
  buildPrintReadyPdf,
  checkPdfNeedsNormalization,
  exifOrientationToDegrees,
  getJpegExifOrientation,
  normalizeFileSettings,
} from '../src/pdf.js';
import { verifyRazorpayPaymentSignature } from '../src/razorpay.js';

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage<T = Record<string, unknown>>(ws: WebSocket): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      ws.off('error', onError);
      resolve(JSON.parse(data.toString('utf8')) as T);
    };
    const onError = (err: Error) => {
      ws.off('message', onMessage);
      reject(err);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

function createMessageQueue(ws: WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<(msg: unknown) => void> = [];

  ws.on('message', (data: WebSocket.RawData) => {
    const parsed = JSON.parse(data.toString('utf8'));
    if (waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter(parsed);
    } else {
      queue.push(parsed);
    }
  });

  return {
    next: <T = Record<string, unknown>>(): Promise<T> => {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift() as T);
      }
      return new Promise<T>((resolve) => {
        waiters.push((val) => resolve(val as T));
      });
    },
  };
}

async function makeTestPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('JetPrint Cloud Relay', () => {
  let server: RelayServerInstance;
  let baseUrl: string;
  let wsUrl: string;
  let uploadDir: string;
  const webhookSecret = 'test_webhook_secret_123';

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jetprint-relay-test-'));
    server = createRelayServer({
      port: 0,
      uploadDir,
      razorpayWebhookSecret: webhookSecret,
      devMode: true,
    });
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  it('registers a kiosk over WebSocket, syncs pricing, and authenticates on reconnect', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        pricing: { bwPerPagePaise: 300, colorPerPagePaise: 1500, shopName: 'Campus Print' },
      })
    );
    const reg = await nextMessage<{
      type: string;
      machine_id: string;
      auth_token: string;
      pricing: { bwPerPagePaise: number; colorPerPagePaise: number; shopName?: string };
    }>(ws);

    expect(reg.type).toBe('registered');
    expect(reg.machine_id).toMatch(/^kiosk_/);
    expect(reg.auth_token).toMatch(/^tok_/);
    expect(reg.pricing.bwPerPagePaise).toBe(300);
    expect(reg.pricing.colorPerPagePaise).toBe(1500);
    expect(reg.pricing.shopName).toBe('Campus Print');

    ws.send(
      JSON.stringify({
        type: 'pricing_update',
        bwPerPagePaise: 250,
        colorPerPagePaise: 1200,
      })
    );
    const ack = await nextMessage<{
      type: string;
      pricing: { bwPerPagePaise: number; colorPerPagePaise: number };
    }>(ws);
    expect(ack.type).toBe('pricing_ack');
    expect(ack.pricing.bwPerPagePaise).toBe(250);
    expect(ack.pricing.colorPerPagePaise).toBe(1200);

    ws.close();

    // Reconnect and authenticate with saved credentials
    const ws2 = await connectWs(wsUrl);
    ws2.send(
      JSON.stringify({
        type: 'auth',
        machine_id: reg.machine_id,
        auth_token: reg.auth_token,
      })
    );
    const authOk = await nextMessage<{ type: string; machine_id: string }>(ws2);
    expect(authOk.type).toBe('auth_ok');
    expect(authOk.machine_id).toBe(reg.machine_id);
    ws2.close();
  });

  it('serves the mobile UI at GET /upload', async () => {
    const res = await fetch(`${baseUrl}/upload?machine_id=test_kiosk`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('JetPrint');
    expect(html).toContain('fileInput');
  });

  it('uploads PDF, detects page count, calculates cost, verifies webhook, pushes OTP over WS, and serves authenticated file download', async () => {
    // 1. Connect kiosk via WS
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'shop-kiosk-01',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{
      type: string;
      machine_id: string;
      auth_token: string;
    }>(ws);
    expect(reg.machine_id).toBe('shop-kiosk-01');

    // 2. Upload a 3-page PDF with copies=2, color=false -> 3 * 2 * 200 = 1200 paise
    const pdfBuffer = await makeTestPdf(3);
    const form = new FormData();
    form.append('machine_id', 'shop-kiosk-01');
    form.append('copies', '2');
    form.append('color', 'false');
    form.append(
      'files',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      'notes.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const job = (await uploadRes.json()) as {
      job_id: string;
      order_id: string;
      amount_paise: number;
      total_pages: number;
      files: Array<{ file_id: string; page_count: number }>;
    };
    expect(job.total_pages).toBe(6);
    expect(job.amount_paise).toBe(1200);
    expect(job.files[0].page_count).toBe(3);

    // 3. Reject invalid webhook signature
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_999',
            order_id: job.order_id,
          },
        },
      },
    });

    const badWebhookRes = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'invalid_sig',
      },
      body: webhookPayload,
    });
    expect(badWebhookRes.status).toBe(401);

    // 4. Send valid webhook signature & expect WS job_dispatch with 6-digit OTP
    const validSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(webhookPayload)
      .digest('hex');

    const dispatchPromise = nextMessage<{
      type: string;
      job_id: string;
      otp: string;
      amount_paise: number;
      print_settings: { copies: number; color: boolean };
      files: Array<{ file_id: string; filename: string; download_url: string }>;
    }>(ws);

    const goodWebhookRes = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSig,
      },
      body: webhookPayload,
    });
    expect(goodWebhookRes.status).toBe(200);

    const dispatch = await dispatchPromise;
    expect(dispatch.type).toBe('job_dispatch');
    expect(dispatch.job_id).toBe(job.job_id);
    expect(dispatch.otp).toMatch(/^\d{6}$/);
    expect(dispatch.amount_paise).toBe(1200);
    expect(dispatch.print_settings).toEqual({ copies: 2, color: false });
    expect(dispatch.files).toHaveLength(1);

    // 5. Verify status endpoint exposes OTP after payment
    const statusRes = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as { otp: string; status: string };
    expect(statusBody.otp).toBe(dispatch.otp);
    expect(statusBody.status).toBe('dispatched');

    // 6. Verify file download requires valid kiosk auth_token
    const downloadUrl = dispatch.files[0].download_url;
    const unauthDownload = await fetch(downloadUrl);
    expect(unauthDownload.status).toBe(401);

    const wrongTokenDownload = await fetch(downloadUrl, {
      headers: { Authorization: 'Bearer tok_wrong' },
    });
    expect(wrongTokenDownload.status).toBe(403);

    const authDownload = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(authDownload.status).toBe(200);
    const downloadedBuf = Buffer.from(await authDownload.arrayBuffer());
    expect(downloadedBuf.equals(pdfBuffer)).toBe(true);

    ws.close();
  });

  it('supports dev-mode payment simulation fallback when Razorpay keys are absent', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(JSON.stringify({ type: 'register', machine_id: 'dev-kiosk' }));
    await nextMessage(ws);

    const pdfBuffer = await makeTestPdf(1);
    const form = new FormData();
    form.append('machine_id', 'dev-kiosk');
    form.append('copies', '1');
    form.append('color', 'true');
    form.append(
      'files',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      'color.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    const job = (await uploadRes.json()) as { job_id: string; dev_mode: boolean; amount_paise: number };
    expect(job.dev_mode).toBe(true);
    expect(job.amount_paise).toBe(1000);

    const dispatchPromise = nextMessage<{ type: string; otp: string }>(ws);
    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
    });
    expect(payRes.status).toBe(200);
    const payBody = (await payRes.json()) as { otp: string; dispatched: boolean };
    expect(payBody.otp).toMatch(/^\d{6}$/);
    expect(payBody.dispatched).toBe(true);

    const dispatch = await dispatchPromise;
    expect(dispatch.type).toBe('job_dispatch');
    expect(dispatch.otp).toBe(payBody.otp);

    ws.close();
  });

  it('calculates per-file settings pricing, dispatches per-file settings, and handles job_status_update', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'qwik-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    await nextMessage(ws);

    const pdf5 = await makeTestPdf(5);
    const pngDummy = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const perFileSettings = [
      {
        copies: 2,
        color: false,
        duplex: '2-sided',
        orientation: 'landscape',
        pagesPerSheet: 2,
        pageRange: '1-3,5', // 4 selected pages -> ceil(4/2)*2 = 4 sheets * 200 = 800 paise
      },
      {
        copies: 1,
        color: true,
        duplex: '1-sided',
        orientation: 'portrait',
        pagesPerSheet: 1,
        pageRange: 'all', // 1 page * 1000 = 1000 paise
      },
    ];

    const form = new FormData();
    form.append('machine_id', 'qwik-kiosk');
    form.append('per_file_settings', JSON.stringify(perFileSettings));
    form.append(
      'files',
      new Blob([new Uint8Array(pdf5)], { type: 'application/pdf' }),
      'slides.pdf'
    );
    form.append(
      'files',
      new Blob([new Uint8Array(pngDummy)], { type: 'image/png' }),
      'cover.png'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const job = (await uploadRes.json()) as {
      job_id: string;
      total_pages: number;
      amount_paise: number;
      files: Array<{
        selected_pages: number;
        billable_sheets: number;
        amount_paise: number;
        settings: { duplex: string; orientation: string; pagesPerSheet: number; pageRange: string };
      }>;
    };

    expect(job.total_pages).toBe(5);
    expect(job.amount_paise).toBe(1800);
    expect(job.files[0].selected_pages).toBe(4);
    expect(job.files[0].billable_sheets).toBe(4);
    expect(job.files[0].amount_paise).toBe(800);
    expect(job.files[0].settings.duplex).toBe('2-sided');
    expect(job.files[0].settings.pagesPerSheet).toBe(2);

    const dispatchPromise = nextMessage<{
      type: string;
      files: Array<{ settings: { duplex: string; orientation: string; pagesPerSheet: number; pageRange: string } }>;
    }>(ws);

    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
    });
    expect(payRes.status).toBe(200);

    const dispatch = await dispatchPromise;
    expect(dispatch.type).toBe('job_dispatch');
    expect(dispatch.files[0].settings.orientation).toBe('landscape');
    expect(dispatch.files[0].settings.pageRange).toBe('1-3,5');
    expect(dispatch.files[1].settings.duplex).toBe('1-sided');

    // Send job_status_update -> printing, then printed
    ws.send(
      JSON.stringify({
        type: 'job_status_update',
        job_id: job.job_id,
        status: 'printing',
      })
    );
    await new Promise((r) => setTimeout(r, 30));
    let statusRes = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    let statusBody = (await statusRes.json()) as { status: string };
    expect(statusBody.status).toBe('printing');

    ws.send(
      JSON.stringify({
        type: 'job_status_update',
        job_id: job.job_id,
        status: 'printed',
      })
    );
    await new Promise((r) => setTimeout(r, 30));
    statusRes = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    statusBody = (await statusRes.json()) as { status: string };
    expect(statusBody.status).toBe('printed');

    ws.close();
  });

  it('verifies Razorpay payment signatures with timing-safe comparison', () => {
    const orderId = 'order_test_123';
    const paymentId = 'pay_test_456';
    const keySecret = 'rzp_test_secret_abc';
    const validSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    expect(
      verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature: validSig,
        keySecret,
      })
    ).toBe(true);

    expect(
      verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature: '0'.repeat(validSig.length),
        keySecret,
      })
    ).toBe(false);

    expect(
      verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature: 'short_invalid_sig',
        keySecret,
      })
    ).toBe(false);

    expect(
      verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature: validSig,
        keySecret: undefined,
      })
    ).toBe(false);
  });

  it('handles POST /api/jobs/:jobId/verify (404, 400 order mismatch, 401 bad signature, 200 valid + idempotent)', async () => {
    const keySecret = 'rzp_verify_secret_789';
    const customUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jetprint-verify-test-'));
    const verifyServer = createRelayServer({
      port: 0,
      uploadDir: customUploadDir,
      razorpayKeySecret: keySecret,
      devMode: true,
    });
    const port = await verifyServer.start();
    const vBaseUrl = `http://127.0.0.1:${port}`;
    const vWsUrl = `ws://127.0.0.1:${port}/ws`;

    try {
      const ws = await connectWs(vWsUrl);
      ws.send(JSON.stringify({ type: 'register', machine_id: 'verify-kiosk' }));
      await nextMessage(ws);

      // 404 for unknown job
      const notFoundRes = await fetch(`${vBaseUrl}/api/jobs/job_missing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: 'order_123',
          razorpay_payment_id: 'pay_123',
          razorpay_signature: 'abc',
        }),
      });
      expect(notFoundRes.status).toBe(404);

      // Create job
      const pdfBuffer = await makeTestPdf(1);
      const form = new FormData();
      form.append('machine_id', 'verify-kiosk');
      form.append(
        'files',
        new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
        'doc.pdf'
      );
      const uploadRes = await fetch(`${vBaseUrl}/api/jobs`, {
        method: 'POST',
        body: form,
      });
      expect(uploadRes.status).toBe(201);
      const job = (await uploadRes.json()) as { job_id: string; order_id: string };

      // 400 for mismatched order_id
      const mismatchRes = await fetch(`${vBaseUrl}/api/jobs/${job.job_id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: 'order_wrong',
          razorpay_payment_id: 'pay_valid_1',
          razorpay_signature: 'sig',
        }),
      });
      expect(mismatchRes.status).toBe(400);

      // 401 for invalid signature
      const badSigRes = await fetch(`${vBaseUrl}/api/jobs/${job.job_id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: job.order_id,
          razorpay_payment_id: 'pay_valid_1',
          razorpay_signature: 'invalid_signature',
        }),
      });
      expect(badSigRes.status).toBe(401);

      // 200 for valid signature -> generates OTP and dispatches to WS
      const paymentId = 'pay_valid_1';
      const validSig = crypto
        .createHmac('sha256', keySecret)
        .update(`${job.order_id}|${paymentId}`)
        .digest('hex');

      const dispatchPromise = nextMessage<{ type: string; job_id: string; otp: string }>(ws);
      const okRes = await fetch(`${vBaseUrl}/api/jobs/${job.job_id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: job.order_id,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig,
        }),
      });
      expect(okRes.status).toBe(200);
      const okBody = (await okRes.json()) as {
        ok: boolean;
        job_id: string;
        status: string;
        otp: string;
        dispatched: boolean;
      };
      expect(okBody.ok).toBe(true);
      expect(okBody.job_id).toBe(job.job_id);
      expect(okBody.status).toBe('dispatched');
      expect(okBody.otp).toMatch(/^\d{6}$/);
      expect(okBody.dispatched).toBe(true);

      const dispatch = await dispatchPromise;
      expect(dispatch.type).toBe('job_dispatch');
      expect(dispatch.otp).toBe(okBody.otp);

      // 200 idempotent repeat call
      const repeatRes = await fetch(`${vBaseUrl}/api/jobs/${job.job_id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: job.order_id,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig,
        }),
      });
      expect(repeatRes.status).toBe(200);
      const repeatBody = (await repeatRes.json()) as {
        ok: boolean;
        job_id: string;
        status: string;
        otp: string;
      };
      expect(repeatBody.ok).toBe(true);
      expect(repeatBody.otp).toBe(okBody.otp);
      expect(repeatBody.status).toBe('dispatched');

      ws.close();
    } finally {
      await verifyServer.close();
      await fs.rm(customUploadDir, { recursive: true, force: true });
    }
  });

  it('pre-renders print-ready PDF with exact orientation and 2-on-1 layout', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'nup-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{ type: string; auth_token: string }>(ws);

    // Create a 2-page test PDF (landscape pages like Aadhaar card)
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([500, 320]).drawText('Front of Card');
    srcDoc.addPage([500, 320]).drawText('Back of Card');
    const aadhaarPdf = Buffer.from(await srcDoc.save());

    const form = new FormData();
    form.append('machine_id', 'nup-kiosk');
    form.append(
      'per_file_settings',
      JSON.stringify([
        {
          copies: 1,
          color: false,
          duplex: '1-sided',
          orientation: 'portrait',
          pagesPerSheet: 2,
          pageRange: 'all',
        },
      ])
    );
    form.append(
      'files',
      new Blob([new Uint8Array(aadhaarPdf)], { type: 'application/pdf' }),
      'Aadhaar.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const job = (await uploadRes.json()) as {
      job_id: string;
      total_pages: number;
      files: Array<{ file_id: string; page_count: number; billable_sheets: number }>;
    };

    expect(job.total_pages).toBe(1);
    expect(job.files[0].page_count).toBe(2);
    expect(job.files[0].billable_sheets).toBe(1);

    const dispatchPromise = nextMessage<{
      type: string;
      files: Array<{ file_id: string; settings: { orientation: string; pagesPerSheet: number; printReady: boolean } }>;
    }>(ws);

    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
    });
    expect(payRes.status).toBe(200);

    const dispatch = await dispatchPromise;
    expect(dispatch.type).toBe('job_dispatch');
    expect(dispatch.files[0].settings.orientation).toBe('portrait');
    expect(dispatch.files[0].settings.pagesPerSheet).toBe(2);
    expect(dispatch.files[0].settings.printReady).toBe(true);

    // Kiosk downloads the file
    const downloadRes = await fetch(
      `${baseUrl}/api/jobs/${job.job_id}/files/${job.files[0].file_id}`,
      {
        headers: {
          authorization: `Bearer ${reg.auth_token}`,
        },
      }
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toContain('application/pdf');

    const downloadedPdfBytes = await downloadRes.arrayBuffer();
    const downloadedDoc = await PDFDocument.load(downloadedPdfBytes);

    // Crucial assertions: exactly 1 physical sheet, A4 portrait dimensions!
    expect(downloadedDoc.getPageCount()).toBe(1);
    const size = downloadedDoc.getPage(0).getSize();
    expect(Math.round(size.width)).toBe(595); // A4 portrait width
    expect(Math.round(size.height)).toBe(842); // A4 portrait height

    ws.close();
  });

  it('registers kiosk with configurable supported paper sizes and serves them via kiosk info', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'paper-kiosk-1',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
        supportedPaperSizes: ['A4', 'A3', 'Legal', 'Letter'],
      })
    );
    const reg = await nextMessage<{
      type: string;
      machine_id: string;
      supportedPaperSizes?: string[];
    }>(ws);

    expect(reg.type).toBe('registered');
    expect(reg.machine_id).toBe('paper-kiosk-1');
    expect(reg.supportedPaperSizes).toEqual(['A4', 'A3', 'Legal', 'Letter']);

    // Check kiosk info endpoint GET /api/machines/:machineId
    const res = await fetch(`${baseUrl}/api/machines/paper-kiosk-1`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { supportedPaperSizes: string[]; dev_mode: boolean };
    expect(data.supportedPaperSizes).toEqual(['A4', 'A3', 'Legal', 'Letter']);

    // Check kiosk info endpoint GET /api/upload?machine_id=paper-kiosk-1
    const uploadInfoRes = await fetch(`${baseUrl}/api/upload?machine_id=paper-kiosk-1`);
    expect(uploadInfoRes.status).toBe(200);
    const uploadInfoData = (await uploadInfoRes.json()) as { supportedPaperSizes: string[] };
    expect(uploadInfoData.supportedPaperSizes).toEqual(['A4', 'A3', 'Legal', 'Letter']);

    // Check default when kiosk does not specify paper sizes
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'default-paper-kiosk',
      })
    );
    const reg2 = await nextMessage<{
      type: string;
      machine_id: string;
      supportedPaperSizes?: string[];
    }>(ws);
    expect(reg2.supportedPaperSizes).toEqual(['A4']);

    const defaultRes = await fetch(`${baseUrl}/api/machines/default-paper-kiosk`);
    const defaultData = (await defaultRes.json()) as { supportedPaperSizes: string[] };
    expect(defaultData.supportedPaperSizes).toEqual(['A4']);

    ws.close();
  });

  it('normalizes and validates paperSize in normalizeFileSettings', () => {
    const fallback = { copies: 1, color: false, paperSize: 'A4' };

    // Standard cases
    expect(normalizeFileSettings({ paperSize: 'A4' }, fallback).paperSize).toBe('A4');
    expect(normalizeFileSettings({ paperSize: 'a4' }, fallback).paperSize).toBe('A4');
    expect(normalizeFileSettings({ paperSize: 'A3' }, fallback).paperSize).toBe('A3');
    expect(normalizeFileSettings({ paperSize: 'Letter' }, fallback).paperSize).toBe('Letter');
    expect(normalizeFileSettings({ paperSize: 'letter' }, fallback).paperSize).toBe('Letter');
    expect(normalizeFileSettings({ paperSize: 'Legal' }, fallback).paperSize).toBe('Legal');
    expect(normalizeFileSettings({ paperSize: 'legal' }, fallback).paperSize).toBe('Legal');

    // Snake case fallback
    expect(normalizeFileSettings({ paper_size: 'letter' } as any, fallback).paperSize).toBe('Letter');

    // Missing / empty defaults to fallback or 'A4'
    expect(normalizeFileSettings({}, fallback).paperSize).toBe('A4');
    expect(normalizeFileSettings({ paperSize: '' }, fallback).paperSize).toBe('A4');
    expect(normalizeFileSettings({}, { copies: 1, color: false, paperSize: 'Letter' }).paperSize).toBe('Letter');
  });

  it('builds print-ready PDF with Letter, Legal, and A3 paper dimensions', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'multi-paper-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
        supported_paper_sizes: ['A4', 'Letter', 'Legal', 'A3'],
      })
    );
    const reg = await nextMessage<{ type: string; auth_token: string }>(ws);

    const testPdf = await makeTestPdf(1);

    // Test Letter paper size (612 x 792)
    const formLetter = new FormData();
    formLetter.append('machine_id', 'multi-paper-kiosk');
    formLetter.append(
      'per_file_settings',
      JSON.stringify([
        {
          copies: 1,
          color: false,
          duplex: '1-sided',
          orientation: 'portrait',
          pagesPerSheet: 1,
          pageRange: 'all',
          paperSize: 'Letter',
        },
      ])
    );
    formLetter.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'letter-doc.pdf'
    );

    const letterUpload = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formLetter,
    });
    expect(letterUpload.status).toBe(201);
    const letterJob = (await letterUpload.json()) as {
      job_id: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    };
    expect(letterJob.files[0].settings.paperSize).toBe('Letter');

    const dispatchLetterPromise = nextMessage<{
      type: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    }>(ws);

    await fetch(`${baseUrl}/api/dev/jobs/${letterJob.job_id}/pay`, { method: 'POST' });
    const dispatchLetter = await dispatchLetterPromise;
    expect(dispatchLetter.files[0].settings.paperSize).toBe('Letter');

    const dlLetterRes = await fetch(
      `${baseUrl}/api/jobs/${letterJob.job_id}/files/${letterJob.files[0].file_id}`,
      { headers: { authorization: `Bearer ${reg.auth_token}` } }
    );
    const dlLetterDoc = await PDFDocument.load(await dlLetterRes.arrayBuffer());
    const letterSize = dlLetterDoc.getPage(0).getSize();
    expect(Math.round(letterSize.width)).toBe(612);
    expect(Math.round(letterSize.height)).toBe(792);

    // Test Legal landscape (swapping width and height: 1008 x 612)
    const formLegal = new FormData();
    formLegal.append('machine_id', 'multi-paper-kiosk');
    formLegal.append(
      'per_file_settings',
      JSON.stringify([
        {
          copies: 1,
          color: false,
          duplex: '1-sided',
          orientation: 'landscape',
          pagesPerSheet: 1,
          pageRange: 'all',
          paperSize: 'Legal',
        },
      ])
    );
    formLegal.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'legal-landscape.pdf'
    );

    const legalUpload = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formLegal,
    });
    expect(legalUpload.status).toBe(201);
    const legalJob = (await legalUpload.json()) as {
      job_id: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    };

    const dispatchLegalPromise = nextMessage<{
      type: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    }>(ws);

    await fetch(`${baseUrl}/api/dev/jobs/${legalJob.job_id}/pay`, { method: 'POST' });
    const dispatchLegal = await dispatchLegalPromise;
    expect(dispatchLegal.files[0].settings.paperSize).toBe('Legal');

    const dlLegalRes = await fetch(
      `${baseUrl}/api/jobs/${legalJob.job_id}/files/${legalJob.files[0].file_id}`,
      { headers: { authorization: `Bearer ${reg.auth_token}` } }
    );
    const dlLegalDoc = await PDFDocument.load(await dlLegalRes.arrayBuffer());
    const legalSize = dlLegalDoc.getPage(0).getSize();
    expect(Math.round(legalSize.width)).toBe(1008); // Legal landscape width
    expect(Math.round(legalSize.height)).toBe(612); // Legal landscape height

    // Test A3 portrait (842 x 1191)
    const formA3 = new FormData();
    formA3.append('machine_id', 'multi-paper-kiosk');
    formA3.append(
      'per_file_settings',
      JSON.stringify([
        {
          copies: 1,
          color: false,
          duplex: '1-sided',
          orientation: 'portrait',
          pagesPerSheet: 1,
          pageRange: 'all',
          paperSize: 'A3',
        },
      ])
    );
    formA3.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'a3-doc.pdf'
    );

    const a3Upload = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formA3,
    });
    expect(a3Upload.status).toBe(201);
    const a3Job = (await a3Upload.json()) as {
      job_id: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    };

    const dispatchA3Promise = nextMessage<{
      type: string;
      files: Array<{ file_id: string; settings: { paperSize?: string } }>;
    }>(ws);

    await fetch(`${baseUrl}/api/dev/jobs/${a3Job.job_id}/pay`, { method: 'POST' });
    const dispatchA3 = await dispatchA3Promise;
    expect(dispatchA3.files[0].settings.paperSize).toBe('A3');

    const dlA3Res = await fetch(
      `${baseUrl}/api/jobs/${a3Job.job_id}/files/${a3Job.files[0].file_id}`,
      { headers: { authorization: `Bearer ${reg.auth_token}` } }
    );
    const dlA3Doc = await PDFDocument.load(await dlA3Res.arrayBuffer());
    const a3Size = dlA3Doc.getPage(0).getSize();
    expect(Math.round(a3Size.width)).toBe(842); // A3 portrait width
    expect(Math.round(a3Size.height)).toBe(1191); // A3 portrait height

    ws.close();
  });

  it('serves mobile UI with paper size selector and available sizes', async () => {
    const res = await fetch(`${baseUrl}/upload`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('paperSizeContainer');
    expect(html).toContain('paperSizeGroup');
    expect(html).toContain('paperSizesEmpty');
  });

  it('correctly extracts and parses JPEG EXIF orientation metadata', () => {
    const headerExif6 = Buffer.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x06, 0x00, 0x00, 0x00,
    ]);
    expect(getJpegExifOrientation(headerExif6)).toBe(6);
    expect(exifOrientationToDegrees(6)).toBe(270);
    expect(exifOrientationToDegrees(8)).toBe(90);
    expect(exifOrientationToDegrees(3)).toBe(180);
    expect(exifOrientationToDegrees(1)).toBe(0);

    const nonJpeg = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(getJpegExifOrientation(nonJpeg)).toBe(1);
  });

  it('detects orientation mismatches in PDFs that require print-ready normalization', async () => {
    // Landscape PDF (300 x 200)
    const landscapeDoc = await PDFDocument.create();
    landscapeDoc.addPage([300, 200]);
    const landscapeBuf = Buffer.from(await landscapeDoc.save());

    // When requested orientation is portrait, landscape PDF has mismatch
    const portraitSettings = normalizeFileSettings(
      { orientation: 'portrait', pagesPerSheet: 1, paperSize: 'A4', pageRange: 'all' },
      { copies: 1, color: false }
    );
    const needsNorm = await checkPdfNeedsNormalization(landscapeBuf, 'application/pdf', 'slides.pdf', portraitSettings);
    expect(needsNorm).toBe(true);

    // After pre-rendering with buildPrintReadyPdf into A4 portrait, sheet becomes A4 portrait
    const printReady = await buildPrintReadyPdf(landscapeBuf, 'application/pdf', 'slides.pdf', portraitSettings);
    const resultDoc = await PDFDocument.load(printReady);
    const page0 = resultDoc.getPage(0).getSize();
    expect(Math.round(page0.width)).toBe(595); // A4 portrait width
    expect(Math.round(page0.height)).toBe(842); // A4 portrait height
  });

  it('builds print-ready PDF with landscape orientation dimensions', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const portraitBuf = Buffer.from(await doc.save());

    const landscapeSettings = normalizeFileSettings(
      { orientation: 'landscape', pagesPerSheet: 1, paperSize: 'A4', pageRange: 'all' },
      { copies: 1, color: false }
    );
    const printReady = await buildPrintReadyPdf(portraitBuf, 'application/pdf', 'doc.pdf', landscapeSettings);
    const resultDoc = await PDFDocument.load(printReady);
    const page0 = resultDoc.getPage(0).getSize();
    expect(Math.round(page0.width)).toBe(842); // A4 landscape width
    expect(Math.round(page0.height)).toBe(595); // A4 landscape height
  });

  it('recovers and flushes unacknowledged jobs when kiosk connects/reconnects, and tracks job_ack', async () => {
    // 1. Register kiosk
    const ws1 = await connectWs(wsUrl);
    ws1.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'offline-test-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{ machine_id: string; auth_token: string }>(ws1);
    expect(reg.machine_id).toBe('offline-test-kiosk');
    // Close websocket to simulate kiosk going offline or closed
    ws1.close();

    // 2. Customer uploads a job while kiosk is offline
    const pdfBuffer = await makeTestPdf(1);
    const form = new FormData();
    form.append('machine_id', 'offline-test-kiosk');
    form.append('copies', '1');
    form.append('color', 'false');
    form.append(
      'files',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      'offline_doc.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const job = (await uploadRes.json()) as { job_id: string };

    // 3. Customer pays for job while kiosk is still offline
    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
    });
    expect(payRes.status).toBe(200);
    const payData = (await payRes.json()) as { otp: string; status: string; dispatched: boolean };
    expect(payData.status).toBe('paid');
    expect(payData.otp).toMatch(/^\d{6}$/);
    expect(payData.dispatched).toBe(false); // Kiosk was offline, so not dispatched yet

    // 4. Kiosk opens / reconnects and sends 'auth'
    const ws2 = await connectWs(wsUrl);
    const mq2 = createMessageQueue(ws2);
    ws2.send(
      JSON.stringify({
        type: 'auth',
        machine_id: reg.machine_id,
        auth_token: reg.auth_token,
      })
    );
    const authOk = await mq2.next<{ type: string }>();
    expect(authOk.type).toBe('auth_ok');

    // flushPendingJobs should automatically dispatch the offline paid job
    const dispatch = await mq2.next<{
      type: string;
      job_id: string;
      otp: string;
    }>();
    expect(dispatch.type).toBe('job_dispatch');
    expect(dispatch.job_id).toBe(job.job_id);
    expect(dispatch.otp).toBe(payData.otp);

    // 5. Send job_ack
    ws2.send(
      JSON.stringify({
        type: 'job_ack',
        job_id: job.job_id,
      })
    );

    // Give a brief tick for ack processing
    await new Promise((r) => setTimeout(r, 20));
    ws2.close();

    // 6. Reconnecting again should NOT re-dispatch already acknowledged job
    const ws3 = await connectWs(wsUrl);
    let extraDispatched = false;
    ws3.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed.type === 'job_dispatch') {
        extraDispatched = true;
      }
    });
    ws3.send(
      JSON.stringify({
        type: 'auth',
        machine_id: reg.machine_id,
        auth_token: reg.auth_token,
      })
    );
    const authOk3 = await nextMessage<{ type: string }>(ws3);
    expect(authOk3.type).toBe('auth_ok');

    // Wait 50ms to ensure no unexpected job_dispatch arrives
    await new Promise((r) => setTimeout(r, 50));
    expect(extraDispatched).toBe(false);
    ws3.close();
  });

  it('allows kiosk to fetch job details and files by OTP via GET /api/jobs/by-otp/:otp', async () => {
    // 1. Register kiosk
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'otp-kiosk-01',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{ machine_id: string; auth_token: string }>(ws);
    ws.close();

    // 2. Upload and pay job
    const pdfBuffer = await makeTestPdf(2);
    const form = new FormData();
    form.append('machine_id', 'otp-kiosk-01');
    form.append('copies', '1');
    form.append('color', 'false');
    form.append(
      'files',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      'invoice.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    const job = (await uploadRes.json()) as { job_id: string };

    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
    });
    const payData = (await payRes.json()) as { otp: string };
    const otp = payData.otp;

    // 3. Test GET /api/jobs/by-otp/:otp auth requirements
    const unauthRes = await fetch(`${baseUrl}/api/jobs/by-otp/${otp}`);
    expect(unauthRes.status).toBe(401);

    const wrongTokenRes = await fetch(`${baseUrl}/api/jobs/by-otp/${otp}`, {
      headers: { Authorization: 'Bearer tok_wrong_123' },
    });
    expect(wrongTokenRes.status).toBe(403);

    const notFoundOtpRes = await fetch(`${baseUrl}/api/jobs/by-otp/999999`, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(notFoundOtpRes.status).toBe(404);

    // 4. Successful fetch with valid token
    const successRes = await fetch(`${baseUrl}/api/jobs/by-otp/${otp}`, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(successRes.status).toBe(200);
    const body = (await successRes.json()) as {
      job_id: string;
      otp: string;
      print_settings: { copies: number; color: boolean };
      files: Array<{ file_id: string; filename: string; download_url: string }>;
    };
    expect(body.job_id).toBe(job.job_id);
    expect(body.otp).toBe(otp);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe('invoice.pdf');
    expect(body.files[0].download_url).toContain(`/api/jobs/${job.job_id}/files/`);

    // 5. Test downloading file with the provided download_url
    const downloadRes = await fetch(body.files[0].download_url, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(downloadRes.status).toBe(200);
    const downloadedBuf = await downloadRes.arrayBuffer();
    expect(downloadedBuf.byteLength).toBeGreaterThan(0);
  });

  it('lists unprinted paid jobs via GET /api/machines/:machineId/active-jobs', async () => {
    // 1. Register kiosk
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'active-jobs-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{ machine_id: string; auth_token: string }>(ws);

    // 2. Upload two jobs, pay only one
    const pdfBuffer = await makeTestPdf(1);
    const createJob = async (name: string) => {
      const form = new FormData();
      form.append('machine_id', 'active-jobs-kiosk');
      form.append('copies', '1');
      form.append('color', 'false');
      form.append(
        'files',
        new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
        name
      );
      const res = await fetch(`${baseUrl}/api/jobs`, { method: 'POST', body: form });
      return (await res.json()) as { job_id: string };
    };

    const job1 = await createJob('job1.pdf');
    const job2 = await createJob('job2.pdf');

    // Pay only job1
    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job1.job_id}/pay`, { method: 'POST' });
    const payData = (await payRes.json()) as { otp: string };

    // 3. Test active-jobs endpoint authentication
    const unauthRes = await fetch(`${baseUrl}/api/machines/active-jobs-kiosk/active-jobs`);
    expect(unauthRes.status).toBe(401);

    const wrongTokenRes = await fetch(`${baseUrl}/api/machines/active-jobs-kiosk/active-jobs`, {
      headers: { Authorization: 'Bearer tok_invalid' },
    });
    expect(wrongTokenRes.status).toBe(403);

    // 4. Test active-jobs lists only paid unprinted job1
    const activeRes = await fetch(`${baseUrl}/api/machines/active-jobs-kiosk/active-jobs`, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(activeRes.status).toBe(200);
    const activeData = (await activeRes.json()) as {
      machine_id: string;
      jobs: Array<{ job_id: string; otp: string }>;
    };
    expect(activeData.machine_id).toBe('active-jobs-kiosk');
    expect(activeData.jobs).toHaveLength(1);
    expect(activeData.jobs[0].job_id).toBe(job1.job_id);
    expect(activeData.jobs[0].otp).toBe(payData.otp);

    // 5. Update job1 status to 'printed' and verify active-jobs becomes empty
    ws.send(
      JSON.stringify({
        type: 'job_status_update',
        job_id: job1.job_id,
        status: 'printed',
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    const activeRes2 = await fetch(`${baseUrl}/api/machines/active-jobs-kiosk/active-jobs`, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    const activeData2 = (await activeRes2.json()) as { jobs: Array<{ job_id: string }> };
    expect(activeData2.jobs).toHaveLength(0);

    ws.close();
  });

  it('covers exact scenario: kiosk closed -> customer pays and gets OTP 199247 -> kiosk opens -> job appears and prints', async () => {
    // 1. Initial kiosk registration with cloud relay
    const wsInit = await connectWs(wsUrl);
    wsInit.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'downtown-kiosk-99',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const reg = await nextMessage<{ machine_id: string; auth_token: string }>(wsInit);
    expect(reg.machine_id).toBe('downtown-kiosk-99');

    // Kiosk is closed! (WebSocket disconnects)
    wsInit.close();
    await new Promise((r) => setTimeout(r, 20));

    // 2. Customer visits mobile web UI, uploads a 2-page document while kiosk is closed
    const pdfBuf = await makeTestPdf(2);
    const form = new FormData();
    form.append('machine_id', 'downtown-kiosk-99');
    form.append('copies', '1');
    form.append('color', 'false');
    form.append(
      'files',
      new Blob([new Uint8Array(pdfBuf)], { type: 'application/pdf' }),
      'term_paper.pdf'
    );

    const uploadRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const job = (await uploadRes.json()) as { job_id: string; amount_paise: number };
    expect(job.amount_paise).toBe(400);

    // 3. Customer completes payment and receives OTP 199247
    const payRes = await fetch(`${baseUrl}/api/dev/jobs/${job.job_id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: '199247' }),
    });
    expect(payRes.status).toBe(200);
    const payData = (await payRes.json()) as {
      job_id: string;
      otp: string;
      status: string;
      dispatched: boolean;
    };
    expect(payData.job_id).toBe(job.job_id);
    expect(payData.otp).toBe('199247');
    expect(payData.status).toBe('paid');
    expect(payData.dispatched).toBe(false); // Kiosk is offline/closed, not dispatched yet

    // Customer status check shows paid with OTP 199247
    const statusRes = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    const statusData = (await statusRes.json()) as { status: string; otp: string };
    expect(statusData.status).toBe('paid');
    expect(statusData.otp).toBe('199247');

    // Kiosk on-demand pull by OTP (GET /api/jobs/by-otp/199247) is available
    const byOtpRes = await fetch(`${baseUrl}/api/jobs/by-otp/199247`, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(byOtpRes.status).toBe(200);
    const byOtpData = (await byOtpRes.json()) as {
      job_id: string;
      otp: string;
      files: Array<{ download_url: string }>;
    };
    expect(byOtpData.job_id).toBe(job.job_id);
    expect(byOtpData.otp).toBe('199247');
    expect(byOtpData.files).toHaveLength(1);

    // 4. Next morning: Kiosk opens! (WebSocket reconnects and authenticates)
    const kioskWs = await connectWs(wsUrl);
    const messageQueue = createMessageQueue(kioskWs);

    kioskWs.send(
      JSON.stringify({
        type: 'auth',
        machine_id: reg.machine_id,
        auth_token: reg.auth_token,
      })
    );
    const authMsg = await messageQueue.next<{ type: string }>();
    expect(authMsg.type).toBe('auth_ok');

    // flushPendingJobs automatically pushes the paid offline job
    const dispatchedJob = await messageQueue.next<{
      type: string;
      job_id: string;
      otp: string;
      print_settings: { copies: number; color: boolean };
      files: Array<{ file_id: string; filename: string; download_url: string }>;
    }>();
    expect(dispatchedJob.type).toBe('job_dispatch');
    expect(dispatchedJob.job_id).toBe(job.job_id);
    expect(dispatchedJob.otp).toBe('199247');
    expect(dispatchedJob.print_settings.copies).toBe(1);
    expect(dispatchedJob.files[0].filename).toBe('term_paper.pdf');

    // 5. Kiosk sends job_ack to acknowledge receipt of the job
    kioskWs.send(
      JSON.stringify({
        type: 'job_ack',
        job_id: dispatchedJob.job_id,
      })
    );

    // 6. Kiosk downloads print files using authenticated download_url (resolving relative url with baseUrl if needed)
    const fileDownloadUrl = dispatchedJob.files[0].download_url.startsWith('http')
      ? dispatchedJob.files[0].download_url
      : `${baseUrl}${dispatchedJob.files[0].download_url}`;
    const fileRes = await fetch(fileDownloadUrl, {
      headers: { Authorization: `Bearer ${reg.auth_token}` },
    });
    expect(fileRes.status).toBe(200);
    const downloadedBuf = Buffer.from(await fileRes.arrayBuffer());
    expect(downloadedBuf.byteLength).toBeGreaterThan(0);

    // 7. Kiosk prints the job: updates status to 'printing', then 'printed'
    kioskWs.send(
      JSON.stringify({
        type: 'job_status_update',
        job_id: dispatchedJob.job_id,
        status: 'printing',
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    let currentStatus = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    expect(((await currentStatus.json()) as { status: string }).status).toBe('printing');

    kioskWs.send(
      JSON.stringify({
        type: 'job_status_update',
        job_id: dispatchedJob.job_id,
        status: 'printed',
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    currentStatus = await fetch(`${baseUrl}/api/jobs/${job.job_id}/status`);
    expect(((await currentStatus.json()) as { status: string }).status).toBe('printed');

    // 8. Active jobs list is now empty for this kiosk
    const activeJobsRes = await fetch(
      `${baseUrl}/api/machines/downtown-kiosk-99/active-jobs`,
      {
        headers: { Authorization: `Bearer ${reg.auth_token}` },
      }
    );
    const activeJobsData = (await activeJobsRes.json()) as {
      jobs: Array<{ job_id: string }>;
    };
    expect(activeJobsData.jobs).toHaveLength(0);

    kioskWs.close();
  });

  it('supports conditional color printing availability: registers kiosk with supportsColor: false, returns in info and upload, and enforces B&W pricing', async () => {
    const ws = await connectWs(wsUrl);
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'bw-only-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
        supportsColor: false,
      })
    );
    const reg = await nextMessage<{
      type: string;
      machine_id: string;
      auth_token: string;
      supportsColor?: boolean;
      supports_color?: boolean;
    }>(ws);

    expect(reg.type).toBe('registered');
    expect(reg.machine_id).toBe('bw-only-kiosk');
    expect(reg.supportsColor).toBe(false);
    expect(reg.supports_color).toBe(false);

    // 1. Verify GET /api/machines/:machineId kiosk info endpoint
    const machineRes = await fetch(`${baseUrl}/api/machines/bw-only-kiosk`);
    expect(machineRes.status).toBe(200);
    const machineData = (await machineRes.json()) as {
      supportsColor: boolean;
      supports_color: boolean;
      pricing: { bwPerPagePaise: number; colorPerPagePaise: number };
    };
    expect(machineData.supportsColor).toBe(false);
    expect(machineData.supports_color).toBe(false);

    // 2. Verify GET /upload (Accept: application/json)
    const uploadRes = await fetch(`${baseUrl}/upload?machine_id=bw-only-kiosk`, {
      headers: { Accept: 'application/json' },
    });
    expect(uploadRes.status).toBe(200);
    const uploadData = (await uploadRes.json()) as {
      supportsColor: boolean;
      supports_color: boolean;
    };
    expect(uploadData.supportsColor).toBe(false);
    expect(uploadData.supports_color).toBe(false);

    // 3. Verify GET /api/upload?machine_id=bw-only-kiosk
    const apiUploadRes = await fetch(`${baseUrl}/api/upload?machine_id=bw-only-kiosk`);
    expect(apiUploadRes.status).toBe(200);
    const apiUploadData = (await apiUploadRes.json()) as {
      supportsColor: boolean;
      supports_color: boolean;
    };
    expect(apiUploadData.supportsColor).toBe(false);
    expect(apiUploadData.supports_color).toBe(false);

    // 4. Upload file requesting color: true -> must enforce color: false and B&W pricing
    const testPdf = await makeTestPdf(2);
    const form = new FormData();
    form.append('machine_id', 'bw-only-kiosk');
    form.append('color', 'true'); // Customer requested color
    form.append(
      'per_file_settings',
      JSON.stringify([
        {
          copies: 1,
          color: true,
          pageRange: 'all',
        },
      ])
    );
    form.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'color-attempt.pdf'
    );

    const postJobRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: form,
    });
    expect(postJobRes.status).toBe(201);
    const jobData = (await postJobRes.json()) as {
      job_id: string;
      amount_paise: number;
      print_settings: { color: boolean };
      files: Array<{ settings: { color: boolean }; amount_paise: number }>;
      supportsColor: boolean;
      supports_color: boolean;
    };

    // Color enforced to false
    expect(jobData.print_settings.color).toBe(false);
    expect(jobData.files[0].settings.color).toBe(false);
    expect(jobData.supportsColor).toBe(false);
    expect(jobData.supports_color).toBe(false);
    // Calculated at B&W rate: 2 pages * 200 = 400 paise (NOT 2 * 1000 = 2000)
    expect(jobData.amount_paise).toBe(400);
    expect(jobData.files[0].amount_paise).toBe(400);

    // 5. Test POST /api/upload alias also works and enforces B&W
    const formUploadAlias = new FormData();
    formUploadAlias.append('machine_id', 'bw-only-kiosk');
    formUploadAlias.append('color', 'true');
    formUploadAlias.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'color-alias.pdf'
    );
    const postUploadAliasRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: formUploadAlias,
    });
    expect(postUploadAliasRes.status).toBe(201);
    const aliasJobData = (await postUploadAliasRes.json()) as {
      amount_paise: number;
      print_settings: { color: boolean };
      files: Array<{ settings: { color: boolean } }>;
    };
    expect(aliasJobData.print_settings.color).toBe(false);
    expect(aliasJobData.files[0].settings.color).toBe(false);
    expect(aliasJobData.amount_paise).toBe(400);

    // 6. Test default kiosk supportsColor defaults to true
    ws.send(
      JSON.stringify({
        type: 'register',
        machine_id: 'default-color-kiosk',
        pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000 },
      })
    );
    const defaultReg = await nextMessage<{
      type: string;
      machine_id: string;
      supportsColor?: boolean;
    }>(ws);
    expect(defaultReg.supportsColor).toBe(true);

    const defaultInfoRes = await fetch(`${baseUrl}/api/machines/default-color-kiosk`);
    const defaultInfo = (await defaultInfoRes.json()) as { supportsColor: boolean };
    expect(defaultInfo.supportsColor).toBe(true);

    // When supportsColor: true, color request is honored and priced at colorPerPagePaise
    const formColorAllowed = new FormData();
    formColorAllowed.append('machine_id', 'default-color-kiosk');
    formColorAllowed.append('color', 'true');
    formColorAllowed.append(
      'files',
      new Blob([new Uint8Array(testPdf)], { type: 'application/pdf' }),
      'color-allowed.pdf'
    );
    const colorAllowedRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formColorAllowed,
    });
    expect(colorAllowedRes.status).toBe(201);
    const colorAllowedJob = (await colorAllowedRes.json()) as {
      amount_paise: number;
      print_settings: { color: boolean };
    };
    expect(colorAllowedJob.print_settings.color).toBe(true);
    // 2 pages * 1000 = 2000 paise
    expect(colorAllowedJob.amount_paise).toBe(2000);

    ws.close();
  });
});
