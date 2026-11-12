import crypto from 'node:crypto';
import type { RelayConfig } from './config.js';

export interface RazorpayOrderResult {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  devMode: boolean;
  keyId?: string;
}

export async function createPaymentOrder(
  config: RelayConfig,
  params: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }
): Promise<RazorpayOrderResult> {
  if (config.devMode || !config.razorpayKeyId || !config.razorpayKeySecret) {
    return {
      orderId: `order_dev_${crypto.randomBytes(8).toString('hex')}`,
      amountPaise: params.amountPaise,
      currency: 'INR',
      devMode: true,
    };
  }

  const credentials = Buffer.from(
    `${config.razorpayKeyId}:${config.razorpayKeySecret}`
  ).toString('base64');

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: 'INR',
      receipt: params.receipt,
      notes: params.notes ?? {},
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Razorpay order creation failed (${response.status}): ${errBody}`);
  }

  const data = (await response.json()) as { id: string; amount: number };
  return {
    orderId: data.id,
    amountPaise: data.amount,
    currency: 'INR',
    devMode: false,
    keyId: config.razorpayKeyId,
  };
}

export function verifyRazorpayWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  webhookSecret: string | undefined
): boolean {
  if (!signatureHeader || !webhookSecret) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signatureHeader, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
