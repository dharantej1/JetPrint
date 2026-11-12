import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export interface RelayConfig {
  port: number;
  publicUrl: string;
  uploadDir: string;
  fileTtlMs: number;
  defaultBwPricePaise: number;
  defaultColorPricePaise: number;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  devMode: boolean;
}

export function loadConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  const razorpayKeyId = overrides.razorpayKeyId ?? (process.env.RAZORPAY_KEY_ID || undefined);
  const razorpayKeySecret =
    overrides.razorpayKeySecret ?? (process.env.RAZORPAY_KEY_SECRET || undefined);
  const razorpayWebhookSecret =
    overrides.razorpayWebhookSecret ?? (process.env.RAZORPAY_WEBHOOK_SECRET || undefined);

  const devMode =
    overrides.devMode ??
    (!razorpayKeyId || !razorpayKeySecret);

  return {
    port: overrides.port ?? Number(process.env.PORT || 3000),
    publicUrl: (overrides.publicUrl ?? (process.env.PUBLIC_URL || '')).replace(/\/+$/, ''),
    uploadDir:
      overrides.uploadDir ??
      path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
    fileTtlMs: overrides.fileTtlMs ?? Number(process.env.FILE_TTL_MS || 60 * 60 * 1000), // 1 hour
    defaultBwPricePaise:
      overrides.defaultBwPricePaise ?? Number(process.env.DEFAULT_BW_PRICE_PAISE || 200), // ₹2.00
    defaultColorPricePaise:
      overrides.defaultColorPricePaise ?? Number(process.env.DEFAULT_COLOR_PRICE_PAISE || 1000), // ₹10.00
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    devMode,
  };
}
