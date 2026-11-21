import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import { NormalizedRect } from '../types';
import { LoadedPdf } from './pdfEngine';

export interface DetectedQuestionBox {
  id: string;
  rect: NormalizedRect;
  label: string;
  selected: boolean;
  source: 'pdf-text' | 'ocr';
}

export interface DetectQuestionsOptions {
  includeAnswers: boolean;
  forceOcr?: boolean;
  ocrLang?: 'eng' | 'eng+ben';
  onStatus?: (status: string) => void;
}

interface TextSpan {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TextLine {
  spans: TextSpan[];
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  isBottomAnswer: boolean;
  trimmedX1?: number;
}

const QUESTION_START_RE =
  /^(?:Q\.?\s*|Ques\.?\s*|প্রশ্ন\s*)?(?:\(?0?\d{1,3}\)?|[০-৯]{1,3})[.)।:]\s*\S/i;
const OPTION_ONLY_RE = /^\(?[a-dA-Dক-ঘivxIVX]{1,3}\)/;
const SECTION_HEADER_RE =
  /(?:MCQ|Multiple\s*Choice|Section\s*[A-Z0-9]|Part\s*[A-Z0-9]|পদার্থবিজ্ঞান|রসায়ন|গণিত|জীববিজ্ঞান).{0,30}\(\s*\d+\s*[×x*]\s*\d+\s*=\s*\d+\s*\)/i;
const BOTTOM_ANSWER_RE =
  /^(?:[\[*•(]?\s*(?:ans(?:wer)?|sol(?:ution)?|key|hint|explanation|correct(?:\s*ans)?|উত্তর|উঃ|উ:|সমাধান|ব্যাখ্যা)\s*[:.\-–]?\s*|\[?\s*(?:ans|উত্তর)\s*[:.\-–])/i;
const RIGHT_ANSWER_TOKEN_RE =
  /^(?:[\[(]?(?:ans(?:wer)?|key|উত্তর|উঃ|উ:)\s*[:.\-–]?\s*\(?[a-dA-Dক-ঘ০-৯1-4]\)?[\])]?|\[[a-dA-Dক-ঘ]\]|\((?:ans|উঃ)\s*[:.]?\s*[a-dA-Dক-ঘ]\))$/i;
const SHORT_KEY_TOKEN_RE = /^\(?[a-dA-Dক-ঘ]\)?$/;

function isQuestionStartLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (OPTION_ONLY_RE.test(trimmed)) return false;
  if (BOTTOM_ANSWER_RE.test(trimmed)) return false;
  if (SECTION_HEADER_RE.test(trimmed)) return false;

  // Reject decimal numbers like "0.5 A" or "12.5 m"
  if (/^\d+\.\d+/.test(trimmed)) return false;

  return QUESTION_START_RE.test(trimmed);
}

function isBottomAnswerLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return BOTTOM_ANSWER_RE.test(trimmed);
}

function isSectionHeaderLine(text: string): boolean {
  const trimmed = text.trim();
  return SECTION_HEADER_RE.test(trimmed);
}

/**
 * Builds a fast binary ink map from a rendered PDF page canvas so graphs,
 * circuits, and vector drawings (invisible to text extraction) are included in crop bounds.
 */
async function renderInkAnalyzer(pdf: LoadedPdf, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  try {
    const baseVp = page.getViewport({ scale: 1 });
    const targetW = 900;
    const scale = targetW / baseVp.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;
    const ink = new Uint8Array(w * h);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Mark pixel as ink if notably darker than white paper
      if (data[i] < 236 || data[i + 1] < 236 || data[i + 2] < 236) {
        ink[p] = 1;
      }
    }

    const refineRect = (
      seed: NormalizedRect,
      bounds: { minX: number; maxX: number; minY: number; maxY: number }
    ): NormalizedRect => {
      const px0 = Math.max(0, Math.floor(bounds.minX * w));
      const px1 = Math.min(w - 1, Math.ceil(bounds.maxX * w));
      const py0 = Math.max(0, Math.floor(bounds.minY * h));
      const py1 = Math.min(h - 1, Math.ceil(bounds.maxY * h));

      let foundMinX = w;
      let foundMaxX = -1;
      let foundMinY = h;
      let foundMaxY = -1;

      for (let y = py0; y <= py1; y++) {
        const rowOffset = y * w;
        for (let x = px0; x <= px1; x++) {
          if (ink[rowOffset + x]) {
            if (x < foundMinX) foundMinX = x;
            if (x > foundMaxX) foundMaxX = x;
            if (y < foundMinY) foundMinY = y;
            if (y > foundMaxY) foundMaxY = y;
          }
        }
      }

      if (foundMaxX < foundMinX || foundMaxY < foundMinY) {
        return seed;
      }

      // Union seed text bounds with detected ink bounds (within safety limits)
      const inkRect: NormalizedRect = {
        x: foundMinX / w,
        y: foundMinY / h,
        width: (foundMaxX - foundMinX + 1) / w,
        height: (foundMaxY - foundMinY + 1) / h,
      };

      const unionX0 = Math.min(seed.x, inkRect.x);
      const unionY0 = Math.min(seed.y, inkRect.y);
      const unionX1 = Math.max(seed.x + seed.width, inkRect.x + inkRect.width);
      const unionY1 = Math.max(seed.y + seed.height, inkRect.y + inkRect.height);

      const padX = 0.007;
      const padY = 0.005;

      const x0 = Math.max(bounds.minX, unionX0 - padX);
      const y0 = Math.max(bounds.minY, unionY0 - padY);
      const x1 = Math.min(bounds.maxX, unionX1 + padX);
      const y1 = Math.min(bounds.maxY, unionY1 + padY);

      return {
        x: x0,
        y: y0,
        width: Math.max(0.03, x1 - x0),
        height: Math.max(0.02, y1 - y0),
      };
    };

    const detectColumnSplitX = (): number | null => {
      // Scan vertical strip near center (40%..60%) for lowest ink density
      const scanStart = Math.floor(w * 0.42);
      const scanEnd = Math.ceil(w * 0.58);
      const yStart = Math.floor(h * 0.08);
      const yEnd = Math.floor(h * 0.92);

      let leftInk = 0;
      let rightInk = 0;
      for (let y = yStart; y < yEnd; y += 2) {
        const off = y * w;
        for (let x = Math.floor(w * 0.06); x < scanStart; x += 3) {
          if (ink[off + x]) leftInk++;
        }
        for (let x = scanEnd; x < Math.floor(w * 0.94); x += 3) {
          if (ink[off + x]) rightInk++;
        }
      }

      if (leftInk < 40 || rightInk < 40) return null;

      // Find cleanest vertical gap (allow thin vertical column line <= 3px)
      let bestX = Math.floor(w * 0.5);
      let bestScore = Infinity;

      for (let x = scanStart; x <= scanEnd; x++) {
        let colDensity = 0;
        for (let y = yStart; y < yEnd; y += 2) {
          // Check a 7px-wide corridor around x
          let corridorHit = 0;
          for (let dx = -3; dx <= 3; dx++) {
            if (ink[y * w + x + dx]) corridorHit++;
          }
          // A solid 1-2px vertical divider line hits <=2 pixels; text hits more
          if (corridorHit > 2) colDensity += corridorHit;
        }
        if (colDensity < bestScore) {
          bestScore = colDensity;
          bestX = x;
        }
      }

      // Only split if center corridor is genuinely sparse compared to column content
      const sampleRows = (yEnd - yStart) / 2;
      if (bestScore < sampleRows * 0.18) {
        return bestX / w;
      }
      return null;
    };

    return { canvas, refineRect, detectColumnSplitX };
  } finally {
    page.cleanup();
  }
}

async function extractPdfTextSpans(pdf: LoadedPdf, pageNumber: number): Promise<TextSpan[]> {
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const spans: TextSpan[] = [];

    for (const rawItem of content.items) {
      if (!('str' in rawItem) || !rawItem.str || !rawItem.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, rawItem.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(rawItem.height) || 10;
      const x0 = tx[4] / viewport.width;
      const wNorm = Math.max(0.002, (rawItem.width || 0) / viewport.width);
      const yBottom = tx[5] / viewport.height;
      const hNorm = Math.max(0.006, fontHeight / viewport.height);

      spans.push({
        str: rawItem.str,
        x0: Math.max(0, Math.min(1, x0)),
        y0: Math.max(0, Math.min(1, yBottom - hNorm * 0.92)),
        x1: Math.max(0, Math.min(1, x0 + wNorm)),
        y1: Math.max(0, Math.min(1, yBottom + hNorm * 0.22)),
      });
    }

    return spans;
  } finally {
    page.cleanup();
  }
}

async function extractOcrSpans(
  canvas: HTMLCanvasElement,
  ocrLang: 'eng' | 'eng+ben',
  onStatus?: (s: string) => void
): Promise<TextSpan[]> {
  onStatus?.('Initializing OCR engine…');
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  const worker = await createWorker(ocrLang, undefined, {
    workerPath: origin ? `${origin}/tesseract/worker.min.js` : '/tesseract/worker.min.js',
    workerBlobURL: false,
    corePath: origin ? `${origin}/tesseract` : '/tesseract',
    ...(ocrLang === 'eng' ? { langPath: origin ? `${origin}/tesseract/lang` : '/tesseract/lang' } : {}),
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onStatus?.(`OCR scanning page (${Math.round((m.progress || 0) * 100)}%)…`);
      }
    },
  });

  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const spans: TextSpan[] = [];
    const w = canvas.width;
    const h = canvas.height;

    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) {
            if (!word.text || !word.text.trim()) continue;
            spans.push({
              str: word.text.trim(),
              x0: Math.max(0, Math.min(1, word.bbox.x0 / w)),
              y0: Math.max(0, Math.min(1, word.bbox.y0 / h)),
              x1: Math.max(0, Math.min(1, word.bbox.x1 / w)),
              y1: Math.max(0, Math.min(1, word.bbox.y1 / h)),
            });
          }
        }
      }
    }
    return spans;
  } finally {
    await worker.terminate();
  }
}

function buildLinesInColumn(
  spans: TextSpan[],
  colMinX: number,
  colMaxX: number,
  includeAnswers: boolean
): TextLine[] {
  const colSpans = spans
    .filter((s) => {
      const cx = (s.x0 + s.x1) / 2;
      return cx >= colMinX && cx <= colMaxX && s.y1 > 0.02 && s.y0 < 0.98;
    })
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const lines: TextLine[] = [];
  for (const span of colSpans) {
    const spanCy = (span.y0 + span.y1) / 2;
    const spanH = Math.max(0.008, span.y1 - span.y0);

    let matched: TextLine | null = null;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      const candidate = lines[i];
      const candCy = (candidate.y0 + candidate.y1) / 2;
      if (Math.abs(spanCy - candCy) <= Math.max(spanH, candidate.y1 - candidate.y0) * 0.62) {
        matched = candidate;
        break;
      }
    }

    if (matched) {
      matched.spans.push(span);
      matched.x0 = Math.min(matched.x0, span.x0);
      matched.y0 = Math.min(matched.y0, span.y0);
      matched.x1 = Math.max(matched.x1, span.x1);
      matched.y1 = Math.max(matched.y1, span.y1);
    } else {
      lines.push({
        spans: [span],
        text: '',
        x0: span.x0,
        y0: span.y0,
        x1: span.x1,
        y1: span.y1,
        isBottomAnswer: false,
      });
    }
  }

  const colWidth = colMaxX - colMinX;

  for (const line of lines) {
    line.spans.sort((a, b) => a.x0 - b.x0);

    // Check for right-side answer token separated by a horizontal gap or far-right answer key
    let effectiveSpans = line.spans;
    if (!includeAnswers && line.spans.length >= 2) {
      const last = line.spans[line.spans.length - 1];
      const prev = line.spans[line.spans.length - 2];
      const gap = last.x0 - prev.x1;
      const lastText = last.str.trim();
      const isFarRight = last.x0 >= colMinX + colWidth * 0.72;

      const looksLikeRightAns =
        RIGHT_ANSWER_TOKEN_RE.test(lastText) ||
        (isFarRight && gap > colWidth * 0.14 && SHORT_KEY_TOKEN_RE.test(lastText));

      if (looksLikeRightAns) {
        effectiveSpans = line.spans.slice(0, -1);
        line.trimmedX1 = prev.x1;
      }
    }

    line.text = effectiveSpans
      .map((s) => s.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    line.isBottomAnswer = isBottomAnswerLine(line.text);
  }

  return lines
    .filter((l) => l.text.length > 0)
    .sort((a, b) => a.y0 - b.y0);
}

export async function detectQuestionsOnPage(
  pdf: LoadedPdf,
  pageNumber: number,
  options: DetectQuestionsOptions
): Promise<DetectedQuestionBox[]> {
  options.onStatus?.('Analyzing page layout…');
  const { canvas, refineRect, detectColumnSplitX } = await renderInkAnalyzer(pdf, pageNumber);

  let spans = options.forceOcr ? [] : await extractPdfTextSpans(pdf, pageNumber);
  let source: 'pdf-text' | 'ocr' = 'pdf-text';

  const totalChars = spans.reduce((sum, s) => sum + s.str.trim().length, 0);
  if (options.forceOcr || totalChars < 30) {
    source = 'ocr';
    spans = await extractOcrSpans(canvas, options.ocrLang || 'eng', options.onStatus);
  }

  if (spans.length === 0) {
    return [];
  }

  // Determine 1-column vs 2-column geometry
  const splitX = detectColumnSplitX();
  const columns: Array<{ minX: number; maxX: number }> = splitX
    ? [
        { minX: 0.01, maxX: splitX - 0.004 },
        { minX: splitX + 0.004, maxX: 0.99 },
      ]
    : [{ minX: 0.01, maxX: 0.99 }];

  const detected: DetectedQuestionBox[] = [];

  for (const col of columns) {
    const lines = buildLinesInColumn(spans, col.minX, col.maxX, options.includeAnswers);
    if (lines.length === 0) continue;

    // Identify question start indices
    const startIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (isQuestionStartLine(lines[i].text)) {
        startIndices.push(i);
      }
    }

    for (let sIdx = 0; sIdx < startIndices.length; sIdx++) {
      const startLineIdx = startIndices[sIdx];
      const nextStartIdx =
        sIdx + 1 < startIndices.length ? startIndices[sIdx + 1] : lines.length;

      // Determine block lines between startLineIdx and nextStartIdx
      const blockLines: TextLine[] = [];
      let excludedAnswerTopY: number | null = null;
      let excludedRightX: number | null = null;

      for (let li = startLineIdx; li < nextStartIdx; li++) {
        const ln = lines[li];
        // Stop before a section header belonging to the next section
        if (li > startLineIdx && isSectionHeaderLine(ln.text)) {
          excludedAnswerTopY = ln.y0;
          break;
        }
        if (!options.includeAnswers && ln.isBottomAnswer) {
          excludedAnswerTopY = ln.y0;
          break;
        }
        if (!options.includeAnswers && ln.trimmedX1 !== undefined) {
          excludedRightX =
            excludedRightX === null ? ln.trimmedX1 : Math.min(excludedRightX, ln.trimmedX1);
        }
        blockLines.push(ln);
      }

      if (blockLines.length === 0) continue;

      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;

      for (const ln of blockLines) {
        x0 = Math.min(x0, ln.x0);
        y0 = Math.min(y0, ln.y0);
        const lineRight = ln.trimmedX1 !== undefined ? ln.trimmedX1 : ln.x1;
        x1 = Math.max(x1, lineRight);
        y1 = Math.max(y1, ln.y1);
      }

      const nextLineY =
        nextStartIdx < lines.length ? lines[nextStartIdx].y0 - 0.004 : 0.96;
      const hardBottomY =
        excludedAnswerTopY !== null ? Math.min(nextLineY, excludedAnswerTopY - 0.003) : nextLineY;
      const hardRightX =
        excludedRightX !== null ? Math.min(col.maxX, excludedRightX + 0.006) : col.maxX;

      const seedRect: NormalizedRect = {
        x: x0,
        y: y0,
        width: Math.max(0.05, x1 - x0),
        height: Math.max(0.02, y1 - y0),
      };

      // Refine against canvas ink pixels so diagrams/graphs/circuits between question & options are captured
      const refined = refineRect(seedRect, {
        minX: col.minX,
        maxX: hardRightX,
        minY: Math.max(0.02, y0 - 0.004),
        maxY: Math.max(y1 + 0.004, hardBottomY),
      });

      const previewLabel = blockLines[0].text.slice(0, 42);

      detected.push({
        id: `auto-${pageNumber}-${detected.length + 1}`,
        rect: refined,
        label: previewLabel,
        selected: true,
        source,
      });
    }
  }

  return detected;
}
