import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, type RelayServerInstance } from '../src/app.js';

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
});
