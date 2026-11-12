import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, type RelayServerInstance } from '../src/app.js';
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
});
