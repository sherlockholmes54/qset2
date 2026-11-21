import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { CroppedQuestion, NormalizedRect } from '../types';
import { extractHighResCrop, LoadedPdf } from '../utils/pdfEngine';

interface EditCropModalProps {
  question: CroppedQuestion;
  questionNumber: number;
  pdfDoc: LoadedPdf | null;
  totalPages: number;
  dpiScale: number;
  onSave: (
    updatedRect: NormalizedRect,
    imageDataUrl: string,
    pixelWidth: number,
    pixelHeight: number
  ) => void;
  onClose: () => void;
}

type DragHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  handle: DragHandle;
  startX: number;
  startY: number;
  initialRect: NormalizedRect;
}

const MIN_SIZE = 0.02;

export const EditCropModal: React.FC<EditCropModalProps> = ({
  question,
  questionNumber,
  pdfDoc,
  totalPages,
  dpiScale,
  onSave,
  onClose,
}) => {
  const canUseSourcePdf = pdfDoc !== null && question.pageNumber >= 1 && question.pageNumber <= totalPages;
  const [mode, setMode] = useState<'source' | 'image'>(canUseSourcePdf ? 'source' : 'image');

  const [sourceRect, setSourceRect] = useState<NormalizedRect>(question.rect);
  const [trimRect, setTrimRect] = useState<NormalizedRect>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });

  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });
  const [fitWidth, setFitWidth] = useState<number>(620);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      setFitWidth(Math.max(260, Math.min(720, el.clientWidth - 24)));
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Render source PDF page when in 'source' mode
  useEffect(() => {
    if (mode !== 'source' || !pdfDoc) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(question.pageNumber);
        if (cancelled) return;
        const baseVp = page.getViewport({ scale: 1 });
        setPageSize({ width: baseVp.width, height: baseVp.height });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const scale = fitWidth / baseVp.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = Math.round(baseVp.width * scale);
        const cssH = Math.round(baseVp.height * scale);

        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: page.getViewport({ scale: scale * dpr }),
        });
        await renderTask.promise;
        page.cleanup();
      } catch {
        // ignore cancel
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore
      }
    };
  }, [mode, pdfDoc, question.pageNumber, fitWidth]);

  // Center scroll near existing crop when source mode opens
  useEffect(() => {
    if (mode !== 'source') return;
    const el = stageRef.current;
    if (!el) return;
    const renderedH = (pageSize.height / pageSize.width) * fitWidth;
    const cropCenterY = (sourceRect.y + sourceRect.height / 2) * renderedH;
    el.scrollTop = Math.max(0, cropCenterY - el.clientHeight / 2);
  }, [mode, pageSize.height, pageSize.width, fitWidth]);

  const activeRect = mode === 'source' ? sourceRect : trimRect;
  const setActiveRect = mode === 'source' ? setSourceRect : setTrimRect;

  const getNormalizedPoint = useCallback((clientX: number, clientY: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return { x: 0, y: 0 };
    const rect = overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const startDrag = (handle: DragHandle, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    setDragState({
      handle,
      startX: pt.x,
      startY: pt.y,
      initialRect: { ...activeRect },
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    const { handle, startX, startY, initialRect } = dragState;

    if (handle === 'move') {
      const dx = pt.x - startX;
      const dy = pt.y - startY;
      setActiveRect({
        ...initialRect,
        x: Math.max(0, Math.min(1 - initialRect.width, initialRect.x + dx)),
        y: Math.max(0, Math.min(1 - initialRect.height, initialRect.y + dy)),
      });
      return;
    }

    let left = initialRect.x;
    let top = initialRect.y;
    let right = initialRect.x + initialRect.width;
    let bottom = initialRect.y + initialRect.height;

    if (handle.includes('w')) left = Math.max(0, Math.min(right - MIN_SIZE, pt.x));
    if (handle.includes('e')) right = Math.min(1, Math.max(left + MIN_SIZE, pt.x));
    if (handle.includes('n')) top = Math.max(0, Math.min(bottom - MIN_SIZE, pt.y));
    if (handle.includes('s')) bottom = Math.min(1, Math.max(top + MIN_SIZE, pt.y));

    setActiveRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (mode === 'source' && pdfDoc) {
        const result = await extractHighResCrop(
          pdfDoc,
          question.pageNumber,
          sourceRect,
          dpiScale
        );
        onSave(sourceRect, result.imageDataUrl, result.pixelWidth, result.pixelHeight);
      } else {
        // Crop existing PNG image directly
        const img = new Image();
        img.src = question.imageDataUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load crop image'));
        });
        const sx = Math.round(trimRect.x * img.naturalWidth);
        const sy = Math.round(trimRect.y * img.naturalHeight);
        const sw = Math.max(12, Math.round(trimRect.width * img.naturalWidth));
        const sh = Math.max(12, Math.round(trimRect.height * img.naturalHeight));

        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        const mappedRect: NormalizedRect = {
          x: question.rect.x + trimRect.x * question.rect.width,
          y: question.rect.y + trimRect.y * question.rect.height,
          width: trimRect.width * question.rect.width,
          height: trimRect.height * question.rect.height,
        };

        onSave(mappedRect, canvas.toDataURL('image/png'), sw, sh);
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const renderHandle = (
    handle: Exclude<DragHandle, 'move'>,
    posClass: string,
    cursorClass: string
  ) => (
    <div
      key={handle}
      onPointerDown={(e) => startDrag(handle, e)}
      className={`absolute ${posClass} ${cursorClass} z-20 flex items-center justify-center w-9 h-9 -translate-x-1/2 -translate-y-1/2 touch-none`}
      aria-label={`Resize ${handle}`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-600 shadow-sm pointer-events-none" />
    </div>
  );

  const cssPageHeight = Math.round((pageSize.height / pageSize.width) * fitWidth);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-3xl h-[90vh] sm:h-[86vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 sm:hidden" />

        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              Edit Crop · Q{questionNumber}
            </h3>
            {canUseSourcePdf && (
              <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMode('source')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                    mode === 'source'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Source Page
                </button>
                <button
                  type="button"
                  onClick={() => setMode('image')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                    mode === 'image'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Trim Image
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close edit crop dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Stage */}
        <div
          ref={stageRef}
          className="flex-1 overflow-auto thin-scrollbar bg-slate-200/80 dark:bg-slate-950 p-3 sm:p-5 flex flex-col items-center"
        >
          {mode === 'source' && canUseSourcePdf ? (
            <div
              className="relative bg-white shadow-md border border-slate-300 dark:border-slate-700 select-none shrink-0"
              style={{ width: fitWidth, height: cssPageHeight }}
            >
              <canvas ref={canvasRef} className="block w-full h-full" />
              <div
                ref={overlayRef}
                onPointerMove={handlePointerMove}
                onPointerUp={() => setDragState(null)}
                onPointerCancel={() => setDragState(null)}
                className="absolute inset-0 touch-none"
              >
                <div
                  className="absolute inset-0 pointer-events-none bg-slate-950/35"
                  style={{
                    clipPath: `polygon(
                      0% 0%, 0% 100%, ${sourceRect.x * 100}% 100%,
                      ${sourceRect.x * 100}% ${sourceRect.y * 100}%,
                      ${(sourceRect.x + sourceRect.width) * 100}% ${sourceRect.y * 100}%,
                      ${(sourceRect.x + sourceRect.width) * 100}% ${(sourceRect.y + sourceRect.height) * 100}%,
                      ${sourceRect.x * 100}% ${(sourceRect.y + sourceRect.height) * 100}%,
                      ${sourceRect.x * 100}% 100%, 100% 100%, 100% 0%
                    )`,
                  }}
                />
                <div
                  onPointerDown={(e) => startDrag('move', e)}
                  className="absolute border-2 border-blue-600 bg-blue-500/5 cursor-move touch-none"
                  style={{
                    left: `${sourceRect.x * 100}%`,
                    top: `${sourceRect.y * 100}%`,
                    width: `${sourceRect.width * 100}%`,
                    height: `${sourceRect.height * 100}%`,
                  }}
                >
                  {renderHandle('nw', 'left-0 top-0', 'cursor-nwse-resize')}
                  {renderHandle('n', 'left-1/2 top-0', 'cursor-ns-resize')}
                  {renderHandle('ne', 'left-full top-0', 'cursor-nesw-resize')}
                  {renderHandle('e', 'left-full top-1/2', 'cursor-ew-resize')}
                  {renderHandle('se', 'left-full top-full', 'cursor-nwse-resize')}
                  {renderHandle('s', 'left-1/2 top-full', 'cursor-ns-resize')}
                  {renderHandle('sw', 'left-0 top-full', 'cursor-nesw-resize')}
                  {renderHandle('w', 'left-0 top-1/2', 'cursor-ew-resize')}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative bg-white shadow-md border border-slate-300 dark:border-slate-700 select-none my-auto max-w-full">
              <img
                src={question.imageDataUrl}
                alt={`Crop preview for question ${questionNumber}`}
                className="block max-w-full max-h-[56vh] w-auto h-auto pointer-events-none"
              />
              <div
                ref={overlayRef}
                onPointerMove={handlePointerMove}
                onPointerUp={() => setDragState(null)}
                onPointerCancel={() => setDragState(null)}
                className="absolute inset-0 touch-none"
              >
                <div
                  className="absolute inset-0 pointer-events-none bg-slate-950/35"
                  style={{
                    clipPath: `polygon(
                      0% 0%, 0% 100%, ${trimRect.x * 100}% 100%,
                      ${trimRect.x * 100}% ${trimRect.y * 100}%,
                      ${(trimRect.x + trimRect.width) * 100}% ${trimRect.y * 100}%,
                      ${(trimRect.x + trimRect.width) * 100}% ${(trimRect.y + trimRect.height) * 100}%,
                      ${trimRect.x * 100}% ${(trimRect.y + trimRect.height) * 100}%,
                      ${trimRect.x * 100}% 100%, 100% 100%, 100% 0%
                    )`,
                  }}
                />
                <div
                  onPointerDown={(e) => startDrag('move', e)}
                  className="absolute border-2 border-blue-600 bg-blue-500/5 cursor-move touch-none"
                  style={{
                    left: `${trimRect.x * 100}%`,
                    top: `${trimRect.y * 100}%`,
                    width: `${trimRect.width * 100}%`,
                    height: `${trimRect.height * 100}%`,
                  }}
                >
                  {renderHandle('nw', 'left-0 top-0', 'cursor-nwse-resize')}
                  {renderHandle('n', 'left-1/2 top-0', 'cursor-ns-resize')}
                  {renderHandle('ne', 'left-full top-0', 'cursor-nesw-resize')}
                  {renderHandle('e', 'left-full top-1/2', 'cursor-ew-resize')}
                  {renderHandle('se', 'left-full top-full', 'cursor-nwse-resize')}
                  {renderHandle('s', 'left-1/2 top-full', 'cursor-ns-resize')}
                  {renderHandle('sw', 'left-0 top-full', 'cursor-nesw-resize')}
                  {renderHandle('w', 'left-0 top-1/2', 'cursor-ew-resize')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (mode === 'source') setSourceRect(question.rect);
              else setTrimRect({ x: 0, y: 0, width: 1, height: 1 });
            }}
            className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="min-h-[42px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Saving…' : 'Save Crop'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
