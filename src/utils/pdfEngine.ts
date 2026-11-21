import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { CroppedQuestion, ExportSettings, NormalizedRect } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type LoadedPdf = pdfjsLib.PDFDocumentProxy;

export interface PdfOutlineEntry {
  title: string;
  pageNumber: number;
  level: number;
}

export interface PdfSearchMatch {
  pageNumber: number;
  snippet: string;
}

class FileRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  private file: File;

  constructor(file: File, initialData: Uint8Array) {
    super(file.size, initialData, false);
    this.file = file;
  }

  requestDataRange(begin: number, end: number): void {
    const safeBegin = Math.max(0, begin);
    const safeEnd = Math.min(this.file.size, end);
    this.file
      .slice(safeBegin, safeEnd)
      .arrayBuffer()
      .then((buf) => {
        this.onDataRange(safeBegin, new Uint8Array(buf));
      })
      .catch(() => {
        this.onDataRange(safeBegin, null);
      });
  }
}

function getLocalPdfjsResourceUrls() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return {};
  }
  const base = window.location.origin;
  return {
    cMapUrl: new URL('/pdfjs/cmaps/', base).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('/pdfjs/standard_fonts/', base).href,
    wasmUrl: new URL('/pdfjs/wasm/', base).href,
  };
}

export async function loadPdfFromBytes(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    ...getLocalPdfjsResourceUrls(),
  });
  return loadingTask.promise;
}

/**
 * Loads a File into PDF.js. For large 500+ page PDFs (> 8 MB), uses byte-range
 * streaming via File.slice() so Android & browser memory stays low and opening is instant.
 */
export async function loadPdfFromFile(file: File): Promise<LoadedPdf> {
  const RANGE_THRESHOLD_BYTES = 8 * 1024 * 1024;
  if (file.size <= RANGE_THRESHOLD_BYTES) {
    const buffer = await file.arrayBuffer();
    return loadPdfFromBytes(buffer);
  }

  const initialChunkSize = Math.min(65536, file.size);
  const initialBuf = await file.slice(0, initialChunkSize).arrayBuffer();
  const rangeTransport = new FileRangeTransport(file, new Uint8Array(initialBuf));

  const loadingTask = pdfjsLib.getDocument({
    range: rangeTransport,
    rangeChunkSize: 65536,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
    ...getLocalPdfjsResourceUrls(),
  });
  return loadingTask.promise;
}

export async function renderPdfPageThumbnail(
  pdf: LoadedPdf,
  pageNumber: number,
  targetWidth = 220
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.78),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    page.cleanup();
  }
}

export async function extractHighResCrop(
  pdf: LoadedPdf,
  pageNumber: number,
  rect: NormalizedRect,
  dpiScale: number = 3
): Promise<{ imageDataUrl: string; pixelWidth: number; pixelHeight: number }> {
  const page = await pdf.getPage(pageNumber);
  try {
    const baseViewport = page.getViewport({ scale: 1 });

    const nx = Math.max(0, Math.min(1, rect.x));
    const ny = Math.max(0, Math.min(1, rect.y));
    const nw = Math.max(0.01, Math.min(1 - nx, rect.width));
    const nh = Math.max(0.01, Math.min(1 - ny, rect.height));

    const desiredW = nw * baseViewport.width * dpiScale;
    const desiredH = nh * baseViewport.height * dpiScale;
    const maxCanvasDim = 3200;
    let effectiveScale = dpiScale;
    if (desiredW > maxCanvasDim || desiredH > maxCanvasDim) {
      const ratio = Math.min(maxCanvasDim / desiredW, maxCanvasDim / desiredH);
      effectiveScale = Math.max(1.5, dpiScale * ratio);
    }

    const viewport = page.getViewport({ scale: effectiveScale });
    const cropX = nx * viewport.width;
    const cropY = ny * viewport.height;
    const cropW = Math.max(16, Math.round(nw * viewport.width));
    const cropH = Math.max(16, Math.round(nh * viewport.height));

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropW, cropH);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -cropX, -cropY],
    }).promise;

    return {
      imageDataUrl: canvas.toDataURL('image/png'),
      pixelWidth: cropW,
      pixelHeight: cropH,
    };
  } finally {
    page.cleanup();
  }
}

export async function extractPdfOutline(pdf: LoadedPdf): Promise<PdfOutlineEntry[]> {
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length === 0) return [];

    const results: PdfOutlineEntry[] = [];

    const resolvePageNumber = async (dest: unknown): Promise<number | null> => {
      try {
        let resolvedDest = dest;
        if (typeof dest === 'string') {
          resolvedDest = await pdf.getDestination(dest);
        }
        if (Array.isArray(resolvedDest) && resolvedDest[0]) {
          const ref = resolvedDest[0];
          const index = await pdf.getPageIndex(ref);
          return index + 1;
        }
      } catch {
        return null;
      }
      return null;
    };

    const walk = async (items: typeof outline, level: number) => {
      for (const item of items) {
        if (results.length >= 250) return;
        const pageNumber = item.dest ? await resolvePageNumber(item.dest) : null;
        if (pageNumber && pageNumber >= 1 && pageNumber <= pdf.numPages) {
          results.push({
            title: item.title || `Page ${pageNumber}`,
            pageNumber,
            level,
          });
        }
        if (item.items && item.items.length > 0 && level < 3) {
          await walk(item.items, level + 1);
        }
      }
    };

    await walk(outline, 0);
    return results;
  } catch {
    return [];
  }
}

export async function searchPdfText(
  pdf: LoadedPdf,
  query: string,
  options: {
    signal: AbortSignal;
    maxMatches?: number;
    onProgress: (scanned: number, total: number) => void;
    onMatch: (match: PdfSearchMatch) => void;
  }
): Promise<void> {
  const needle = query.trim().toLowerCase();
  if (!needle) return;

  const total = pdf.numPages;
  const maxMatches = options.maxMatches ?? 80;
  let matchCount = 0;

  for (let p = 1; p <= total; p++) {
    if (options.signal.aborted || matchCount >= maxMatches) return;

    const page = await pdf.getPage(p);
    try {
      const content = await page.getTextContent();
      if (options.signal.aborted) return;

      const joined = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ');

      const idx = joined.toLowerCase().indexOf(needle);
      if (idx !== -1) {
        const start = Math.max(0, idx - 36);
        const end = Math.min(joined.length, idx + needle.length + 64);
        const prefix = start > 0 ? '…' : '';
        const suffix = end < joined.length ? '…' : '';
        options.onMatch({
          pageNumber: p,
          snippet: `${prefix}${joined.slice(start, end).trim()}${suffix}`,
        });
        matchCount += 1;
      }
    } finally {
      page.cleanup();
    }

    if (p % 5 === 0 || p === total) {
      options.onProgress(p, total);
      // Yield back to UI thread so Android stays responsive across 500+ pages
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateMergedPdf(
  questions: CroppedQuestion[],
  settings: ExportSettings
): Promise<Uint8Array> {
  if (questions.length === 0) {
    throw new Error('Add at least one cropped question before generating a PDF.');
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageDims =
    settings.pageSize === 'letter'
      ? { width: 612, height: 792 }
      : { width: 595.28, height: 841.89 };

  const marginX = settings.marginSize === 'narrow' ? 24 : 38;
  const marginTop = settings.marginSize === 'narrow' ? 26 : 40;
  const marginBottom = settings.showPageNumbers
    ? settings.marginSize === 'narrow'
      ? 28
      : 38
    : settings.marginSize === 'narrow'
      ? 22
      : 32;

  const gapMap = {
    compact: 8,
    standard: 16,
    wide: 28,
  } as const;
  const itemGap = gapMap[settings.spacing];

  const embeddedImages = await Promise.all(
    questions.map(async (q) => {
      const bytes = dataUrlToUint8Array(q.imageDataUrl);
      const image = await pdfDoc.embedPng(bytes);
      return { question: q, image };
    })
  );

  const drawDocumentHeader = (
    page: ReturnType<typeof pdfDoc.addPage>,
    width: number,
    startY: number
  ): number => {
    if (!settings.title.trim() && !settings.subtitle.trim()) {
      return startY;
    }
    let y = startY;
    if (settings.title.trim()) {
      const titleText = settings.title.trim();
      const titleW = fontBold.widthOfTextAtSize(titleText, 13);
      page.drawText(titleText, {
        x: Math.max(marginX, (width - titleW) / 2),
        y: y - 11,
        size: 13,
        font: fontBold,
        color: rgb(0.06, 0.09, 0.16),
      });
      y -= 17;
    }
    if (settings.subtitle.trim()) {
      const subText = settings.subtitle.trim();
      const subW = fontRegular.widthOfTextAtSize(subText, 9);
      page.drawText(subText, {
        x: Math.max(marginX, (width - subW) / 2),
        y: y - 9,
        size: 9,
        font: fontRegular,
        color: rgb(0.39, 0.45, 0.55),
      });
      y -= 13;
    }
    page.drawLine({
      start: { x: marginX, y },
      end: { x: width - marginX, y },
      thickness: 0.65,
      color: rgb(0.75, 0.79, 0.85),
    });
    return y - 12;
  };

  if (settings.layoutMode === 'single-per-page' || settings.pageSize === 'fit') {
    for (let i = 0; i < embeddedImages.length; i++) {
      const { question, image } = embeddedImages[i];
      const imgAspect = image.width / image.height;

      if (settings.pageSize === 'fit') {
        const targetWidth = 595.28;
        const headerAllowance =
          i === 0 && (settings.title.trim() || settings.subtitle.trim()) ? 44 : 0;
        const gutter = settings.showQuestionNumbers ? 22 : 0;
        const labelAllowance = question.label.trim() ? 14 : 0;
        const drawWidth = targetWidth - marginX * 2 - gutter;
        const drawHeight = drawWidth / imgAspect;
        const pageHeight = Math.max(
          160,
          marginTop + headerAllowance + labelAllowance + drawHeight + marginBottom
        );

        const page = pdfDoc.addPage([targetWidth, pageHeight]);
        let cursorY = pageHeight - marginTop;
        if (i === 0) {
          cursorY = drawDocumentHeader(page, targetWidth, cursorY);
        }

        if (question.label.trim()) {
          const labelText = question.label.trim();
          const labelW = fontRegular.widthOfTextAtSize(labelText, 9);
          page.drawText(labelText, {
            x: targetWidth - marginX - labelW,
            y: cursorY - 9,
            size: 9,
            font: fontRegular,
            color: rgb(0.39, 0.45, 0.55),
          });
          cursorY -= 14;
        }

        if (settings.showQuestionNumbers) {
          const numStr = `${String(i + 1).padStart(2, '0')}.`;
          page.drawText(numStr, {
            x: marginX,
            y: cursorY - 10,
            size: 10,
            font: fontBold,
            color: rgb(0.1, 0.14, 0.22),
          });
        }

        page.drawImage(image, {
          x: marginX + gutter,
          y: cursorY - drawHeight,
          width: drawWidth,
          height: drawHeight,
        });
      } else {
        const page = pdfDoc.addPage([pageDims.width, pageDims.height]);
        let cursorY = pageDims.height - marginTop;
        if (i === 0) {
          cursorY = drawDocumentHeader(page, pageDims.width, cursorY);
        }

        const gutter = settings.showQuestionNumbers ? 22 : 0;
        if (question.label.trim()) {
          const labelText = question.label.trim();
          const labelW = fontRegular.widthOfTextAtSize(labelText, 9);
          page.drawText(labelText, {
            x: pageDims.width - marginX - labelW,
            y: cursorY - 9,
            size: 9,
            font: fontRegular,
            color: rgb(0.39, 0.45, 0.55),
          });
          cursorY -= 16;
        }

        if (settings.showQuestionNumbers) {
          const numStr = `${String(i + 1).padStart(2, '0')}.`;
          page.drawText(numStr, {
            x: marginX,
            y: cursorY - 10,
            size: 10.5,
            font: fontBold,
            color: rgb(0.1, 0.14, 0.22),
          });
        }

        const availW = pageDims.width - marginX * 2 - gutter;
        const availH = cursorY - marginBottom;
        let drawW = availW;
        let drawH = drawW / imgAspect;
        if (drawH > availH) {
          drawH = availH;
          drawW = drawH * imgAspect;
        }

        page.drawImage(image, {
          x: marginX + gutter + (availW - drawW) / 2,
          y: cursorY - drawH,
          width: drawW,
          height: drawH,
        });
      }
    }
  } else {
    // High-density Flow & Pack (1 Column or 2 Columns Exam Paper)
    const numCols = settings.columns === 2 ? 2 : 1;
    const colGap = numCols === 2 ? 18 : 0;
    const usableWidth = pageDims.width - marginX * 2;
    const colWidth = (usableWidth - colGap * (numCols - 1)) / numCols;

    let currentPage = pdfDoc.addPage([pageDims.width, pageDims.height]);
    let pageTopY = drawDocumentHeader(currentPage, pageDims.width, pageDims.height - marginTop);
    let colIndex = 0;
    let cursorY = pageTopY;
    let itemsInCurrentCol = 0;
    let columnDividerDrawnOnPage = false;

    const drawPageColumnDivider = (page: ReturnType<typeof pdfDoc.addPage>, topY: number) => {
      if (numCols === 2 && settings.showColumnDivider && !columnDividerDrawnOnPage) {
        const centerX = marginX + colWidth + colGap / 2;
        page.drawLine({
          start: { x: centerX, y: topY },
          end: { x: centerX, y: marginBottom },
          thickness: 0.5,
          color: rgb(0.82, 0.85, 0.89),
        });
        columnDividerDrawnOnPage = true;
      }
    };

    for (let i = 0; i < embeddedImages.length; i++) {
      const { question, image } = embeddedImages[i];
      const imgAspect = image.width / image.height;
      const gutter = settings.showQuestionNumbers ? 19 : 0;
      const maxImgW = colWidth - gutter;

      // Preserve proportional visual size: don't over-stretch tiny crops,
      // while aligning standard column crops cleanly to colWidth.
      const referenceFraction = numCols === 2 ? 0.36 : 0.72;
      const widthScale =
        question.rect.width < referenceFraction
          ? Math.max(0.45, question.rect.width / referenceFraction)
          : 1;
      let drawW = maxImgW * widthScale;
      let drawH = drawW / imgAspect;

      const labelHeight = question.label.trim() ? 12 : 0;
      const fullColAvailH = pageDims.height - marginTop - marginBottom - labelHeight;
      if (drawH > fullColAvailH) {
        drawH = fullColAvailH;
        drawW = drawH * imgAspect;
      }

      const neededHeight = labelHeight + drawH;

      // Move to next column or new page if this question doesn't fit
      if (itemsInCurrentCol > 0 && cursorY - neededHeight < marginBottom) {
        if (colIndex + 1 < numCols) {
          colIndex += 1;
          cursorY = pageTopY;
          itemsInCurrentCol = 0;
        } else {
          currentPage = pdfDoc.addPage([pageDims.width, pageDims.height]);
          pageTopY = pageDims.height - marginTop;
          colIndex = 0;
          cursorY = pageTopY;
          itemsInCurrentCol = 0;
          columnDividerDrawnOnPage = false;
        }
      }

      // Draw center column divider when Column 2 starts (or on page with 2 cols)
      if (colIndex === 1) {
        drawPageColumnDivider(currentPage, pageTopY);
      }

      const colX = marginX + colIndex * (colWidth + colGap);

      // Optional horizontal divider between questions in the same column
      if (itemsInCurrentCol > 0 && settings.showDividers) {
        const dividerY = cursorY + itemGap / 2;
        currentPage.drawLine({
          start: { x: colX, y: dividerY },
          end: { x: colX + colWidth, y: dividerY },
          thickness: 0.45,
          color: rgb(0.88, 0.9, 0.93),
        });
      }

      if (question.label.trim()) {
        const labelText = question.label.trim();
        const labelW = fontRegular.widthOfTextAtSize(labelText, 8);
        currentPage.drawText(labelText, {
          x: colX + colWidth - labelW,
          y: cursorY - 8,
          size: 8,
          font: fontRegular,
          color: rgb(0.42, 0.48, 0.57),
        });
        cursorY -= labelHeight;
      }

      // Inline left-gutter question number (01., 02.) adds zero vertical height overhead
      if (settings.showQuestionNumbers) {
        const numStr = `${String(i + 1).padStart(2, '0')}.`;
        currentPage.drawText(numStr, {
          x: colX,
          y: cursorY - 10,
          size: 9.5,
          font: fontBold,
          color: rgb(0.08, 0.12, 0.2),
        });
      }

      currentPage.drawImage(image, {
        x: colX + gutter,
        y: cursorY - drawH,
        width: drawW,
        height: drawH,
      });

      cursorY -= drawH + itemGap;
      itemsInCurrentCol += 1;
    }
  }

  if (settings.showPageNumbers) {
    const pages = pdfDoc.getPages();
    const total = pages.length;
    pages.forEach((page, idx) => {
      const text = `Page ${idx + 1} of ${total}`;
      const textW = fontRegular.widthOfTextAtSize(text, 8.5);
      const { width } = page.getSize();
      page.drawText(text, {
        x: (width - textW) / 2,
        y: 12,
        size: 8.5,
        font: fontRegular,
        color: rgb(0.45, 0.51, 0.6),
      });
    });
  }

  return pdfDoc.save();
}
