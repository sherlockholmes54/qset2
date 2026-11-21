import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { LoadedPdf } from '../utils/pdfEngine';
import { CroppedQuestion, NormalizedRect } from '../types';
import { DetectedQuestionBox } from '../utils/questionDetector';

interface PdfPageCanvasProps {
  pdf: LoadedPdf;
  pageNumber: number;
  totalPages: number;
  zoom: number;
  toolMode: 'crop' | 'pan';
  autoCapture: boolean;
  existingCropsOnPage: Array<{ question: CroppedQuestion; index: number }>;
  detectedBoxes: DetectedQuestionBox[];
  isCapturing: boolean;
  onSelectPage: (page: number) => void;
  onConfirmCrop: (rect: NormalizedRect) => Promise<void>;
  onToggleDetectedBox: (id: string) => void;
  onUpdateDetectedRect: (id: string, rect: NormalizedRect) => void;
  onSelectAllDetected: (selected: boolean) => void;
  onAddDetectedBoxes: () => Promise<void>;
  onCancelDetected: () => void;
}

type DragHandle =
  | 'new'
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

interface DragState {
  target: 'manual' | string; // 'manual' or detected box id
  handle: DragHandle;
  startX: number;
  startY: number;
  initialRect: NormalizedRect;
}

const MIN_SIZE = 0.025;

export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdf,
  pageNumber,
  totalPages,
  zoom,
  toolMode,
  autoCapture,
  existingCropsOnPage,
  detectedBoxes,
  isCapturing,
  onSelectPage,
  onConfirmCrop,
  onToggleDetectedBox,
  onUpdateDetectedRect,
  onSelectAllDetected,
  onAddDetectedBoxes,
  onCancelDetected,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });
  const [fitScale, setFitScale] = useState<number>(1);
  const [isRendering, setIsRendering] = useState<boolean>(true);
  const [selection, setSelection] = useState<NormalizedRect | null>(null);
  const [activeDetectedId, setActiveDetectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);

  const touchSwipeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastDx: number;
    startTime: number;
    startScrollLeft: number;
    maxScrollLeft: number;
    lockedAxis: 'x' | 'y' | null;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateFit = () => {
      const availW = Math.max(280, el.clientWidth - 24);
      setFitScale(availW / pageSize.width);
    };
    updateFit();

    const observer = new ResizeObserver(updateFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageSize.width]);

  useEffect(() => {
    setSelection(null);
    setDragState(null);
    setActiveDetectedId(null);
    setSwipeOffset(0);
    setIsSwiping(false);
    touchSwipeRef.current = null;
  }, [pageNumber]);

  const effectiveScale = Math.max(0.35, Math.min(3.5, fitScale * zoom));

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    const render = async () => {
      setIsRendering(true);
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseVp = page.getViewport({ scale: 1 });
        setPageSize((prev) =>
          Math.abs(prev.width - baseVp.width) > 0.5 || Math.abs(prev.height - baseVp.height) > 0.5
            ? { width: baseVp.width, height: baseVp.height }
            : prev
        );

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const cssW = Math.round(baseVp.width * effectiveScale);
        const cssH = Math.round(baseVp.height * effectiveScale);

        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderVp = page.getViewport({ scale: effectiveScale * dpr });
        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderVp,
        });
        await renderTask.promise;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (!message.includes('Rendering cancelled')) {
          console.error('PDF page render error:', err);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdf, pageNumber, effectiveScale]);

  const getNormalizedPoint = useCallback((clientX: number, clientY: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return { x: 0, y: 0 };
    const rect = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  const isReviewMode = detectedBoxes.length > 0;

  const startManualDrag = (handle: DragHandle, e: React.PointerEvent) => {
    if (toolMode !== 'crop' || isCapturing || isReviewMode) return;
    e.preventDefault();
    e.stopPropagation();

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);

    if (handle === 'new') {
      const initialRect: NormalizedRect = { x: pt.x, y: pt.y, width: 0, height: 0 };
      setSelection(initialRect);
      setDragState({
        target: 'manual',
        handle: 'new',
        startX: pt.x,
        startY: pt.y,
        initialRect,
      });
    } else if (selection) {
      setDragState({
        target: 'manual',
        handle,
        startX: pt.x,
        startY: pt.y,
        initialRect: { ...selection },
      });
    }
  };

  const startDetectedDrag = (
    boxId: string,
    initialRect: NormalizedRect,
    handle: Exclude<DragHandle, 'new'>,
    e: React.PointerEvent
  ) => {
    if (isCapturing) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveDetectedId(boxId);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    setDragState({
      target: boxId,
      handle,
      startX: pt.x,
      startY: pt.y,
      initialRect: { ...initialRect },
    });
  };

  const computeResizedRect = (
    pt: { x: number; y: number },
    state: DragState
  ): NormalizedRect => {
    const { handle, startX, startY, initialRect } = state;

    if (handle === 'new') {
      return {
        x: Math.min(startX, pt.x),
        y: Math.min(startY, pt.y),
        width: Math.abs(pt.x - startX),
        height: Math.abs(pt.y - startY),
      };
    }

    if (handle === 'move') {
      const dx = pt.x - startX;
      const dy = pt.y - startY;
      return {
        ...initialRect,
        x: Math.max(0, Math.min(1 - initialRect.width, initialRect.x + dx)),
        y: Math.max(0, Math.min(1 - initialRect.height, initialRect.y + dy)),
      };
    }

    let left = initialRect.x;
    let top = initialRect.y;
    let right = initialRect.x + initialRect.width;
    let bottom = initialRect.y + initialRect.height;

    if (handle.includes('w')) left = Math.max(0, Math.min(right - MIN_SIZE, pt.x));
    if (handle.includes('e')) right = Math.min(1, Math.max(left + MIN_SIZE, pt.x));
    if (handle.includes('n')) top = Math.max(0, Math.min(bottom - MIN_SIZE, pt.y));
    if (handle.includes('s')) bottom = Math.min(1, Math.max(top + MIN_SIZE, pt.y));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    const nextRect = computeResizedRect(pt, dragState);

    if (dragState.target === 'manual') {
      setSelection(nextRect);
    } else {
      onUpdateDetectedRect(dragState.target, nextRect);
    }
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (!dragState) return;
    e.preventDefault();

    const finishedTarget = dragState.target;
    const finishedHandle = dragState.handle;
    setDragState(null);

    if (finishedTarget === 'manual') {
      if (!selection || selection.width < MIN_SIZE || selection.height < MIN_SIZE) {
        if (finishedHandle === 'new') {
          setSelection(null);
        }
        return;
      }

      if (autoCapture && finishedHandle === 'new') {
        const captured = { ...selection };
        setSelection(null);
        await onConfirmCrop(captured);
      }
    }
  };

  const handleConfirmClick = async () => {
    if (!selection || selection.width < MIN_SIZE || selection.height < MIN_SIZE) return;
    const captured = { ...selection };
    setSelection(null);
    await onConfirmCrop(captured);
  };

  const renderManualHandle = (
    handle: Exclude<DragHandle, 'new' | 'move'>,
    positionClass: string,
    cursorClass: string
  ) => (
    <div
      key={handle}
      onPointerDown={(e) => startManualDrag(handle, e)}
      className={`absolute ${positionClass} ${cursorClass} z-20 flex items-center justify-center w-9 h-9 -translate-x-1/2 -translate-y-1/2 touch-none`}
      aria-label={`Resize crop ${handle}`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-600 shadow-sm pointer-events-none" />
    </div>
  );

  const renderDetectedHandle = (
    box: DetectedQuestionBox,
    handle: Exclude<DragHandle, 'new' | 'move'>,
    positionClass: string,
    cursorClass: string
  ) => (
    <div
      key={handle}
      onPointerDown={(e) => startDetectedDrag(box.id, box.rect, handle, e)}
      className={`absolute ${positionClass} ${cursorClass} z-30 flex items-center justify-center w-8 h-8 -translate-x-1/2 -translate-y-1/2 touch-none`}
      aria-label={`Resize detected question ${handle}`}
    >
      <span className="w-3 h-3 rounded-full bg-white border-2 border-amber-600 shadow-sm pointer-events-none" />
    </div>
  );

  const hasValidSelection =
    selection !== null && selection.width >= MIN_SIZE && selection.height >= MIN_SIZE;
  const selectedDetectedCount = detectedBoxes.filter((b) => b.selected).length;

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || dragState || isCapturing) {
      touchSwipeRef.current = null;
      return;
    }

    const target = e.target as Node | null;
    // In Crop mode, single-finger drags on the PDF page draw a crop box;
    // allow swipe from the outer stage backdrop or anytime in Scroll (pan) mode.
    if (toolMode === 'crop' && target && pageBoxRef.current?.contains(target)) {
      touchSwipeRef.current = null;
      return;
    }

    const el = containerRef.current;
    if (!el) return;
    const touch = e.touches[0];
    touchSwipeRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastDx: 0,
      startTime: Date.now(),
      startScrollLeft: el.scrollLeft,
      maxScrollLeft: Math.max(0, el.scrollWidth - el.clientWidth),
      lockedAxis: null,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = touchSwipeRef.current;
    if (!state || !state.active || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    state.lastDx = dx;

    if (state.lockedAxis === null) {
      if (Math.hypot(dx, dy) < 10) return;

      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (state.maxScrollLeft > 4) {
          const atLeftEdge = state.startScrollLeft <= 4;
          const atRightEdge = state.startScrollLeft >= state.maxScrollLeft - 4;
          if ((dx > 0 && !atLeftEdge) || (dx < 0 && !atRightEdge)) {
            state.lockedAxis = 'y';
            return;
          }
        }
        state.lockedAxis = 'x';
        setIsSwiping(true);
      } else {
        state.lockedAxis = 'y';
        return;
      }
    }

    if (state.lockedAxis === 'x') {
      const atFirstBoundary = pageNumber <= 1 && dx > 0;
      const atLastBoundary = pageNumber >= totalPages && dx < 0;
      const factor = atFirstBoundary || atLastBoundary ? 0.22 : 0.65;
      const clamped = Math.max(-110, Math.min(110, dx * factor));
      setSwipeOffset(clamped);
    }
  };

  const finishTouchSwipe = () => {
    const state = touchSwipeRef.current;
    touchSwipeRef.current = null;
    if (!state || state.lockedAxis !== 'x') {
      setSwipeOffset(0);
      setIsSwiping(false);
      return;
    }

    const dx = state.lastDx;
    const elapsed = Date.now() - state.startTime;
    const isFlick = Math.abs(dx) >= 34 && elapsed <= 260;
    const isLongSwipe = Math.abs(dx) >= 68;

    if (isFlick || isLongSwipe) {
      if (dx < 0 && pageNumber < totalPages) {
        onSelectPage(pageNumber + 1);
      } else if (dx > 0 && pageNumber > 1) {
        onSelectPage(pageNumber - 1);
      }
    }

    setSwipeOffset(0);
    setIsSwiping(false);
  };

  const swipeDirectionIndicator =
    isSwiping && Math.abs(swipeOffset) >= 24
      ? swipeOffset > 0 && pageNumber > 1
        ? { dir: 'prev' as const, targetPage: pageNumber - 1 }
        : swipeOffset < 0 && pageNumber < totalPages
          ? { dir: 'next' as const, targetPage: pageNumber + 1 }
          : null
      : null;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishTouchSwipe}
      onTouchCancel={finishTouchSwipe}
      className={`relative flex-1 overflow-auto overflow-x-auto thin-scrollbar bg-slate-200/75 dark:bg-slate-950 p-3 sm:p-5 flex flex-col items-center ${
        toolMode === 'pan' && zoom <= 1 ? 'touch-pan-y' : ''
      }`}
    >
      {swipeDirectionIndicator && (
        <div
          className={`fixed top-1/2 -translate-y-1/2 z-30 pointer-events-none px-3 py-2 rounded-full bg-slate-900/90 text-white text-xs font-mono font-semibold shadow-lg border border-slate-700 inline-flex items-center gap-1 ${
            swipeDirectionIndicator.dir === 'prev' ? 'left-3' : 'right-3'
          }`}
        >
          {swipeDirectionIndicator.dir === 'prev' ? (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Page {swipeDirectionIndicator.targetPage}</span>
            </>
          ) : (
            <>
              <span>Page {swipeDirectionIndicator.targetPage}</span>
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </div>
      )}

      <div
        ref={pageBoxRef}
        className={`relative bg-white shadow-md border border-slate-300/80 dark:border-slate-700 select-none my-auto ${
          isSwiping ? '' : 'transition-transform duration-200 ease-out'
        }`}
        style={{
          width: Math.round(pageSize.width * effectiveScale),
          height: Math.round(pageSize.height * effectiveScale),
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {isRendering && (
          <div className="absolute inset-0 bg-white/40 flex items-center justify-center pointer-events-none">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-200 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
              Rendering page {pageNumber}…
            </span>
          </div>
        )}

        {/* Interactive crop, auto-detected review & existing markers layer */}
        <div
          ref={overlayRef}
          onPointerDown={(e) => startManualDrag('new', e)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDragState(null)}
          className={`absolute inset-0 ${
            isReviewMode
              ? toolMode === 'pan'
                ? 'pointer-events-none'
                : 'touch-none'
              : toolMode === 'crop'
                ? 'cursor-crosshair touch-none'
                : 'pointer-events-none'
          }`}
        >
          {/* Previously cropped questions on this page */}
          {existingCropsOnPage.map(({ question, index }) => (
            <div
              key={question.id}
              className="absolute border border-emerald-600/75 bg-emerald-500/10 pointer-events-none rounded-[2px]"
              style={{
                left: `${question.rect.x * 100}%`,
                top: `${question.rect.y * 100}%`,
                width: `${question.rect.width * 100}%`,
                height: `${question.rect.height * 100}%`,
              }}
            >
              <span className="inline-block bg-emerald-700 text-white text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-br">
                Q{index + 1}
              </span>
            </div>
          ))}

          {/* Auto-detected OCR question boxes */}
          {detectedBoxes.map((box, idx) => {
            const isActive = activeDetectedId === box.id;
            return (
              <div
                key={box.id}
                onPointerDown={(e) => {
                  if (isActive) {
                    startDetectedDrag(box.id, box.rect, 'move', e);
                  } else {
                    e.stopPropagation();
                    setActiveDetectedId(box.id);
                  }
                }}
                className={`absolute rounded-[3px] transition-colors pointer-events-auto ${
                  box.selected
                    ? isActive
                      ? 'border-2 border-amber-600 bg-amber-500/15 z-20 cursor-move'
                      : 'border-2 border-blue-600 bg-blue-500/10 z-10 cursor-pointer'
                    : 'border border-dashed border-slate-400 bg-slate-500/5 opacity-55 z-10 cursor-pointer'
                }`}
                style={{
                  left: `${box.rect.x * 100}%`,
                  top: `${box.rect.y * 100}%`,
                  width: `${box.rect.width * 100}%`,
                  height: `${box.rect.height * 100}%`,
                }}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDetectedBox(box.id);
                  }}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded-br cursor-pointer ${
                    box.selected
                      ? isActive
                        ? 'bg-amber-600 text-white'
                        : 'bg-blue-600 text-white'
                      : 'bg-slate-600 text-white'
                  }`}
                  title={box.selected ? 'Tap to exclude' : 'Tap to include'}
                >
                  <span>#{idx + 1}</span>
                  <span>{box.selected ? '✓' : '—'}</span>
                </button>

                {isActive && (
                  <>
                    {renderDetectedHandle(box, 'nw', 'left-0 top-0', 'cursor-nwse-resize')}
                    {renderDetectedHandle(box, 'n', 'left-1/2 top-0', 'cursor-ns-resize')}
                    {renderDetectedHandle(box, 'ne', 'left-full top-0', 'cursor-nesw-resize')}
                    {renderDetectedHandle(box, 'e', 'left-full top-1/2', 'cursor-ew-resize')}
                    {renderDetectedHandle(box, 'se', 'left-full top-full', 'cursor-nwse-resize')}
                    {renderDetectedHandle(box, 's', 'left-1/2 top-full', 'cursor-ns-resize')}
                    {renderDetectedHandle(box, 'sw', 'left-0 top-full', 'cursor-nesw-resize')}
                    {renderDetectedHandle(box, 'w', 'left-0 top-1/2', 'cursor-ew-resize')}
                  </>
                )}
              </div>
            );
          })}

          {/* Active manual crop marquee */}
          {!isReviewMode && selection && (
            <>
              {hasValidSelection && (
                <div
                  className="absolute inset-0 pointer-events-none bg-slate-950/30"
                  style={{
                    clipPath: `polygon(
                      0% 0%, 0% 100%, ${selection.x * 100}% 100%,
                      ${selection.x * 100}% ${selection.y * 100}%,
                      ${(selection.x + selection.width) * 100}% ${selection.y * 100}%,
                      ${(selection.x + selection.width) * 100}% ${(selection.y + selection.height) * 100}%,
                      ${selection.x * 100}% ${(selection.y + selection.height) * 100}%,
                      ${selection.x * 100}% 100%, 100% 100%, 100% 0%
                    )`,
                  }}
                />
              )}

              <div
                onPointerDown={(e) => startManualDrag('move', e)}
                className="absolute border-2 border-blue-600 bg-blue-500/5 cursor-move touch-none"
                style={{
                  left: `${selection.x * 100}%`,
                  top: `${selection.y * 100}%`,
                  width: `${selection.width * 100}%`,
                  height: `${selection.height * 100}%`,
                }}
              >
                <div className="absolute inset-0 pointer-events-none opacity-35">
                  <div className="absolute left-1/3 top-0 bottom-0 w-px bg-blue-400" />
                  <div className="absolute left-2/3 top-0 bottom-0 w-px bg-blue-400" />
                  <div className="absolute top-1/3 left-0 right-0 h-px bg-blue-400" />
                  <div className="absolute top-2/3 left-0 right-0 h-px bg-blue-400" />
                </div>

                {renderManualHandle('nw', 'left-0 top-0', 'cursor-nwse-resize')}
                {renderManualHandle('n', 'left-1/2 top-0', 'cursor-ns-resize')}
                {renderManualHandle('ne', 'left-full top-0', 'cursor-nesw-resize')}
                {renderManualHandle('e', 'left-full top-1/2', 'cursor-ew-resize')}
                {renderManualHandle('se', 'left-full top-full', 'cursor-nwse-resize')}
                {renderManualHandle('s', 'left-1/2 top-full', 'cursor-ns-resize')}
                {renderManualHandle('sw', 'left-0 top-full', 'cursor-nesw-resize')}
                {renderManualHandle('w', 'left-0 top-1/2', 'cursor-ew-resize')}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating Review Bar for Auto-Detected OCR Boxes */}
      {isReviewMode && (
        <div className="sticky bottom-3 mt-4 z-30 flex flex-wrap items-center justify-center gap-1.5 bg-slate-900 text-white p-1.5 rounded-xl shadow-xl border border-slate-700/80">
          <button
            type="button"
            onClick={onCancelDetected}
            className="min-h-[40px] px-3 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onSelectAllDetected(selectedDetectedCount < detectedBoxes.length)
            }
            className="min-h-[40px] px-3 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 whitespace-nowrap cursor-pointer"
          >
            {selectedDetectedCount < detectedBoxes.length ? 'Select All' : 'Deselect All'}
          </button>

          <button
            type="button"
            disabled={isCapturing || selectedDetectedCount === 0}
            onClick={onAddDetectedBoxes}
            className="min-h-[40px] px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>
              {isCapturing
                ? 'Cropping…'
                : `Add ${selectedDetectedCount} Selected`}
            </span>
          </button>
        </div>
      )}

      {/* Floating Crop Action Bar for Manual Selection */}
      {!isReviewMode && hasValidSelection && !autoCapture && (
        <div className="sticky bottom-3 mt-4 z-30 flex items-center gap-2 bg-slate-900 text-white p-1.5 rounded-xl shadow-xl border border-slate-700/80">
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="min-h-[44px] px-3.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
          <button
            type="button"
            disabled={isCapturing}
            onClick={handleConfirmClick}
            className="min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{isCapturing ? 'Capturing…' : 'Add to Question Set'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
