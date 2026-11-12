import { PDFDocument } from 'pdf-lib';

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export function isSupportedFile(mimeType: string, originalName: string): boolean {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = originalName.toLowerCase();
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return true;
  }
  if (IMAGE_MIME_TYPES.has(lowerMime)) {
    return true;
  }
  return /\.(png|jpe?g|webp)$/i.test(lowerName);
}

export async function detectPageCount(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<number> {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = originalName.toLowerCase();

  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    try {
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      return Math.max(1, pdfDoc.getPageCount());
    } catch {
      return 1;
    }
  }

  return 1;
}
