import { PDFDocument } from 'pdf-lib';
import type {
  DuplexMode,
  FilePrintSettings,
  OrientationMode,
  PagesPerSheet,
} from './types.js';

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

export function countSelectedPages(pageRange: string, totalPages: number): number {
  const maxPage = Math.max(1, totalPages);
  const trimmed = (pageRange || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all') {
    return maxPage;
  }

  const selected = new Set<number>();
  for (const part of trimmed.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (rangeMatch) {
      const a = Math.max(1, Math.min(maxPage, Number(rangeMatch[1])));
      const b = Math.max(1, Math.min(maxPage, Number(rangeMatch[2])));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let p = start; p <= end; p++) {
        selected.add(p);
      }
      continue;
    }

    const single = Number(token);
    if (Number.isInteger(single) && single >= 1 && single <= maxPage) {
      selected.add(single);
    }
  }

  return selected.size > 0 ? selected.size : maxPage;
}

export function normalizeFileSettings(
  raw: Partial<FilePrintSettings> | undefined,
  fallback: { copies: number; color: boolean }
): FilePrintSettings {
  const rawCopies = Number(raw?.copies ?? fallback.copies);
  const copies =
    Number.isFinite(rawCopies) && rawCopies >= 1
      ? Math.min(100, Math.floor(rawCopies))
      : fallback.copies;

  const color = typeof raw?.color === 'boolean' ? raw.color : fallback.color;
  const duplex: DuplexMode = raw?.duplex === '2-sided' ? '2-sided' : '1-sided';
  const orientation: OrientationMode =
    raw?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const rawPps = Number(raw?.pagesPerSheet ?? 1);
  const pagesPerSheet: PagesPerSheet =
    rawPps === 2 || rawPps === 4 || rawPps === 6 ? rawPps : 1;
  const pageRange =
    typeof raw?.pageRange === 'string' && raw.pageRange.trim()
      ? raw.pageRange.trim()
      : 'all';

  return {
    copies,
    color,
    duplex,
    orientation,
    pagesPerSheet,
    pageRange,
  };
}
