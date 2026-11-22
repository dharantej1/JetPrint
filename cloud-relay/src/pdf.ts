import { PDFDocument, degrees } from 'pdf-lib';
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

export function getJpegExifOrientation(buffer: Buffer): number {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return 1;
  }
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1) {
      if (
        offset + 4 + 6 <= buffer.length &&
        buffer.toString('ascii', offset + 4, offset + 8) === 'Exif' &&
        buffer[offset + 8] === 0x00 &&
        buffer[offset + 9] === 0x00
      ) {
        const tiffHeader = offset + 10;
        const isLittle = buffer.readUInt16BE(tiffHeader) === 0x4949;
        const isBig = buffer.readUInt16BE(tiffHeader) === 0x4d4d;
        if (!isLittle && !isBig) return 1;
        const get16 = (o: number) =>
          isLittle ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
        const get32 = (o: number) =>
          isLittle ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);
        if (get16(tiffHeader + 2) !== 0x002a) return 1;
        const firstIfdOffset = get32(tiffHeader + 4);
        let ifdOffset = tiffHeader + firstIfdOffset;
        if (ifdOffset + 2 > buffer.length) return 1;
        const numEntries = get16(ifdOffset);
        ifdOffset += 2;
        for (let i = 0; i < numEntries && ifdOffset + 12 <= buffer.length; i++, ifdOffset += 12) {
          const tag = get16(ifdOffset);
          if (tag === 0x0112) {
            return get16(ifdOffset + 8);
          }
        }
      }
      break;
    }
    offset += 2 + length;
  }
  return 1;
}

export function exifOrientationToDegrees(orientation: number): number {
  switch (orientation) {
    case 3:
      return 180;
    case 6:
      // 90 deg clockwise in screen coords corresponds to 270 deg in PDF coords
      return 270;
    case 8:
      // 270 deg clockwise in screen coords corresponds to 90 deg in PDF coords
      return 90;
    default:
      return 0;
  }
}

export async function checkPdfNeedsNormalization(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  settings: FilePrintSettings
): Promise<boolean> {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (originalName || '').toLowerCase();
  const isPdf = lowerMime === 'application/pdf' || lowerName.endsWith('.pdf');
  if (!isPdf) return true;
  try {
    const pdfDoc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const targetIsLandscape = settings.orientation === 'landscape';

    for (const page of pdfDoc.getPages()) {
      const { width, height } = page.getSize();
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      if (rot !== 0) return true;
      const pageIsLandscape = width > height;
      if (pageIsLandscape !== targetIsLandscape) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parsePageRange(pageRange: string, totalPages: number): number[] {
  const maxPage = Math.max(1, totalPages);
  const trimmed = (pageRange || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all') {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }

  const selected: number[] = [];
  const seen = new Set<number>();
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
        if (!seen.has(p)) {
          seen.add(p);
          selected.push(p);
        }
      }
      continue;
    }

    const single = Number(token);
    if (Number.isInteger(single) && single >= 1 && single <= maxPage && !seen.has(single)) {
      seen.add(single);
      selected.push(single);
    }
  }

  return selected.length > 0
    ? selected
    : Array.from({ length: maxPage }, (_, i) => i + 1);
}

export function countSelectedPages(pageRange: string, totalPages: number): number {
  return parsePageRange(pageRange, totalPages).length;
}

export const PAPER_DIMENSIONS: Record<string, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

export function getPaperDimensions(paperSize?: string): { width: number; height: number } {
  if (!paperSize || typeof paperSize !== 'string') {
    return PAPER_DIMENSIONS.A4;
  }
  const upper = paperSize.trim().toUpperCase();
  if (upper === 'A4') return PAPER_DIMENSIONS.A4;
  if (upper === 'A3') return PAPER_DIMENSIONS.A3;
  if (upper === 'LETTER') return PAPER_DIMENSIONS.Letter;
  if (upper === 'LEGAL') return PAPER_DIMENSIONS.Legal;
  return PAPER_DIMENSIONS[paperSize] || PAPER_DIMENSIONS.A4;
}

export function normalizePaperSize(raw?: unknown): string {
  if (typeof raw !== 'string') return 'A4';
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'A4') return 'A4';
  if (upper === 'A3') return 'A3';
  if (upper === 'LETTER') return 'Letter';
  if (upper === 'LEGAL') return 'Legal';
  return trimmed || 'A4';
}

export function normalizeFileSettings(
  raw: Partial<FilePrintSettings> | undefined,
  fallback: { copies: number; color: boolean; paperSize?: string }
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
  const rawPaper = (raw as any)?.paperSize ?? (raw as any)?.paper_size ?? fallback.paperSize;
  const paperSize = normalizePaperSize(rawPaper);

  return {
    copies,
    color,
    duplex,
    orientation,
    pagesPerSheet,
    pageRange,
    paperSize,
    printReady: Boolean(raw?.printReady),
  };
}

export function needsPrintReadyProcessing(
  settings: FilePrintSettings,
  mimeType: string,
  filename: string
): boolean {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (filename || '').toLowerCase();
  const isPdf = lowerMime === 'application/pdf' || lowerName.endsWith('.pdf');
  if (!isPdf) return true;
  if (settings.pagesPerSheet > 1) return true;
  if (settings.orientation === 'landscape') return true;
  if (settings.paperSize && settings.paperSize.toUpperCase() !== 'A4') return true;
  const pr = (settings.pageRange || '').trim().toLowerCase();
  if (pr && pr !== 'all') return true;
  return false;
}

export async function buildPrintReadyPdf(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  settings: FilePrintSettings
): Promise<Buffer> {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (filename || '').toLowerCase();
  const isPdf = lowerMime === 'application/pdf' || lowerName.endsWith('.pdf');

  const destDoc = await PDFDocument.create();

  const isLandscape = settings.orientation === 'landscape';
  const dims = getPaperDimensions(settings.paperSize || 'A4');
  const sheetWidth = isLandscape ? dims.height : dims.width;
  const sheetHeight = isLandscape ? dims.width : dims.height;

  interface RenderItem {
    emb: any;
    rot: number;
    isImage: boolean;
  }
  const items: RenderItem[] = [];

  if (isPdf) {
    const srcDoc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const totalPages = Math.max(1, srcDoc.getPageCount());
    const pageNums = parsePageRange(settings.pageRange, totalPages);

    // Prevent MissingPageContentsEmbeddingError on empty pages
    for (const page of srcDoc.getPages()) {
      try {
        page.drawLine({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, thickness: 0 });
      } catch {
        // ignore
      }
    }

    const indicesToEmbed = pageNums.map((n) => n - 1);
    const embeddedPages = await destDoc.embedPdf(srcDoc, indicesToEmbed);

    for (let i = 0; i < pageNums.length; i++) {
      const pageIndex = indicesToEmbed[i];
      const srcPage = srcDoc.getPage(pageIndex);
      const rot = ((srcPage.getRotation().angle % 360) + 360) % 360;
      items.push({
        emb: embeddedPages[i],
        rot,
        isImage: false,
      });
    }
  } else {
    let img: any;
    const isPng =
      lowerMime === 'image/png' ||
      lowerName.endsWith('.png') ||
      (buffer.length >= 4 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47);

    let rot = 0;
    if (isPng) {
      img = await destDoc.embedPng(buffer);
    } else {
      img = await destDoc.embedJpg(buffer);
      const exifOrient = getJpegExifOrientation(buffer);
      rot = exifOrientationToDegrees(exifOrient);
    }
    items.push({
      emb: img,
      rot,
      isImage: true,
    });
  }

  const pps = settings.pagesPerSheet || 1;
  let cols = 1;
  let rows = 1;

  if (pps === 2) {
    if (isLandscape) {
      cols = 2;
      rows = 1;
    } else {
      cols = 1;
      rows = 2;
    }
  } else if (pps === 4) {
    cols = 2;
    rows = 2;
  } else if (pps === 6) {
    if (isLandscape) {
      cols = 3;
      rows = 2;
    } else {
      cols = 2;
      rows = 3;
    }
  }

  const margin = 18;
  const gap = pps > 1 ? 8 : 0;
  const availW = sheetWidth - 2 * margin - (cols - 1) * gap;
  const availH = sheetHeight - 2 * margin - (rows - 1) * gap;
  const cellW = availW / cols;
  const cellH = availH / rows;

  for (let i = 0; i < items.length; i += pps) {
    const chunk = items.slice(i, i + pps);
    const sheet = destDoc.addPage([sheetWidth, sheetHeight]);

    for (let cIdx = 0; cIdx < chunk.length; cIdx++) {
      const item = chunk[cIdx];
      const col = cIdx % cols;
      const row = Math.floor(cIdx / cols);

      const cellX = margin + col * (cellW + gap);
      const cellY = sheetHeight - margin - (row + 1) * cellH - row * gap;

      const rawW = item.emb.width;
      const rawH = item.emb.height;
      const rot = item.rot || 0;
      const visualW = rot === 90 || rot === 270 ? rawH : rawW;
      const visualH = rot === 90 || rot === 270 ? rawW : rawH;

      const scale = Math.min(cellW / visualW, cellH / visualH);
      const drawVisualW = visualW * scale;
      const drawVisualH = visualH * scale;

      const targetX = cellX + (cellW - drawVisualW) / 2;
      const targetY = cellY + (cellH - drawVisualH) / 2;

      const drawRawW = rawW * scale;
      const drawRawH = rawH * scale;

      let xOrigin = targetX;
      let yOrigin = targetY;
      if (rot === 90) {
        xOrigin = targetX + drawVisualW;
        yOrigin = targetY;
      } else if (rot === 180) {
        xOrigin = targetX + drawVisualW;
        yOrigin = targetY + drawVisualH;
      } else if (rot === 270) {
        xOrigin = targetX;
        yOrigin = targetY + drawVisualH;
      }

      if (item.isImage) {
        sheet.drawImage(item.emb, {
          x: xOrigin,
          y: yOrigin,
          width: drawRawW,
          height: drawRawH,
          rotate: degrees(rot),
        });
      } else {
        sheet.drawPage(item.emb, {
          x: xOrigin,
          y: yOrigin,
          width: drawRawW,
          height: drawRawH,
          rotate: degrees(rot),
        });
      }
    }
  }

  const outBytes = await destDoc.save();
  return Buffer.from(outBytes);
}
