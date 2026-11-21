import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { LoadedPdf, renderPdfPageThumbnail } from '../utils/pdfEngine';

interface PageThumbnailRailProps {
  pdf: LoadedPdf;
  totalPages: number;
  currentPage: number;
  cropCountsByPage: Record<number, number>;
  onSelectPage: (page: number) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const MAX_CACHED_THUMBS = 64;
const DESKTOP_ROW_HEIGHT = 212;
const MOBILE_ROW_HEIGHT = 204;

export const PageThumbnailRail: React.FC<PageThumbnailRailProps> = ({
  pdf,
  totalPages,
  currentPage,
  cropCountsByPage,
  onSelectPage,
  mobileOpen,
  onCloseMobile,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'cropped'>('all');
  const [jumpInput, setJumpInput] = useState<string>('');

  // Bounded LRU cache stored in ref + version tick to avoid 500-page React state bloat
  const cacheRef = useRef<Map<number, string>>(new Map());
  const inFlightRef = useRef<Set<number>>(new Set());
  const [cacheTick, setCacheTick] = useState<number>(0);

  // Desktop virtualization state
  const desktopListRef = useRef<HTMLDivElement>(null);
  const [desktopScrollTop, setDesktopScrollTop] = useState<number>(0);
  const [desktopHeight, setDesktopHeight] = useState<number>(640);

  // Mobile drawer virtualization state
  const mobileGridRef = useRef<HTMLDivElement>(null);
  const [mobileScrollTop, setMobileScrollTop] = useState<number>(0);
  const [mobileHeight, setMobileHeight] = useState<number>(480);
  const [mobileCols, setMobileCols] = useState<number>(2);

  // Clear thumbnail cache when PDF changes
  useEffect(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setFilterMode('all');
    setDesktopScrollTop(0);
    setMobileScrollTop(0);
    setCacheTick((t) => t + 1);
  }, [pdf]);

  const croppedPageCount = useMemo(
    () => Object.values(cropCountsByPage).filter((c) => c > 0).length,
    [cropCountsByPage]
  );

  const visiblePageList = useMemo(() => {
    if (filterMode === 'cropped') {
      const list: number[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if ((cropCountsByPage[p] || 0) > 0) list.push(p);
      }
      return list;
    }
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }, [filterMode, totalPages, cropCountsByPage]);

  // Observe desktop container height
  useEffect(() => {
    const el = desktopListRef.current;
    if (!el) return;
    const update = () => setDesktopHeight(el.clientHeight || 640);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Observe mobile drawer grid dimensions
  useEffect(() => {
    if (!mobileOpen) return;
    const el = mobileGridRef.current;
    if (!el) return;
    const update = () => {
      setMobileHeight(el.clientHeight || 480);
      setMobileCols(el.clientWidth >= 500 ? 3 : 2);
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [mobileOpen]);

  // Keep desktop rail scrolled to currentPage when jumping via search/input
  useEffect(() => {
    const el = desktopListRef.current;
    if (!el) return;
    const idx = visiblePageList.indexOf(currentPage);
    if (idx === -1) return;
    const itemTop = idx * DESKTOP_ROW_HEIGHT;
    const itemBottom = itemTop + DESKTOP_ROW_HEIGHT;
    if (itemTop < el.scrollTop || itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({
        top: Math.max(0, itemTop - el.clientHeight / 2 + DESKTOP_ROW_HEIGHT / 2),
        behavior: 'auto',
      });
    }
  }, [currentPage, visiblePageList]);

  // Keep mobile grid scrolled near currentPage when opened
  useEffect(() => {
    if (!mobileOpen) return;
    const el = mobileGridRef.current;
    if (!el) return;
    const idx = visiblePageList.indexOf(currentPage);
    if (idx === -1) return;
    const rowIdx = Math.floor(idx / mobileCols);
    const targetTop = Math.max(0, rowIdx * MOBILE_ROW_HEIGHT - el.clientHeight / 3);
    el.scrollTop = targetTop;
    setMobileScrollTop(targetTop);
  }, [mobileOpen, currentPage, visiblePageList, mobileCols]);

  // Compute visible slice for desktop
  const desktopStart = Math.max(0, Math.floor(desktopScrollTop / DESKTOP_ROW_HEIGHT) - 2);
  const desktopEnd = Math.min(
    visiblePageList.length - 1,
    Math.ceil((desktopScrollTop + desktopHeight) / DESKTOP_ROW_HEIGHT) + 2
  );
  const desktopSlice =
    visiblePageList.length > 0 ? visiblePageList.slice(desktopStart, desktopEnd + 1) : [];

  // Compute visible rows for mobile drawer
  const totalMobileRows = Math.ceil(visiblePageList.length / mobileCols);
  const mobileRowStart = Math.max(0, Math.floor(mobileScrollTop / MOBILE_ROW_HEIGHT) - 1);
  const mobileRowEnd = Math.min(
    totalMobileRows - 1,
    Math.ceil((mobileScrollTop + mobileHeight) / MOBILE_ROW_HEIGHT) + 2
  );
  const mobileSlice = useMemo(() => {
    if (!mobileOpen || visiblePageList.length === 0) return [];
    const startIdx = mobileRowStart * mobileCols;
    const endIdx = Math.min(visiblePageList.length, (mobileRowEnd + 1) * mobileCols);
    return visiblePageList.slice(startIdx, endIdx);
  }, [mobileOpen, visiblePageList, mobileRowStart, mobileRowEnd, mobileCols]);

  // Priority queue: render ONLY thumbnails currently visible in viewport
  const requestedPagesKey = useMemo(() => {
    const set = new Set<number>();
    for (const p of desktopSlice) set.add(p);
    for (const p of mobileSlice) set.add(p);
    return Array.from(set).join(',');
  }, [desktopSlice, mobileSlice]);

  useEffect(() => {
    if (!requestedPagesKey) return;
    let cancelled = false;
    const pagesToRender = requestedPagesKey
      .split(',')
      .map(Number)
      .filter((p) => p > 0 && !cacheRef.current.has(p) && !inFlightRef.current.has(p));

    if (pagesToRender.length === 0) return;

    const runQueue = async () => {
      for (const page of pagesToRender) {
        if (cancelled) return;
        if (cacheRef.current.has(page)) continue;
        inFlightRef.current.add(page);
        try {
          const { dataUrl } = await renderPdfPageThumbnail(pdf, page, 160);
          if (cancelled) return;

          // Evict oldest LRU entry if cache exceeds MAX_CACHED_THUMBS
          if (cacheRef.current.size >= MAX_CACHED_THUMBS) {
            const oldestKey = cacheRef.current.keys().next().value;
            if (oldestKey !== undefined) {
              cacheRef.current.delete(oldestKey);
            }
          }
          cacheRef.current.set(page, dataUrl);
          setCacheTick((t) => t + 1);
        } catch {
          // ignore cancelled/transient render errors
        } finally {
          inFlightRef.current.delete(page);
        }
      }
    };

    runQueue();
    return () => {
      cancelled = true;
    };
  }, [pdf, requestedPagesKey]);

  const getCachedThumb = (page: number): string | undefined => {
    void cacheTick;
    return cacheRef.current.get(page);
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(jumpInput, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= totalPages) {
      setFilterMode('all');
      onSelectPage(num);
      setJumpInput('');
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Desktop Virtualized Left Thumbnail Rail */}
      <aside className="hidden lg:flex flex-col w-48 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Pages</span>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">{totalPages}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('cropped')}
              className={`py-1 rounded-md text-[11px] font-medium transition-colors tabular-nums cursor-pointer ${
                filterMode === 'cropped'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Cropped ({croppedPageCount})
            </button>
          </div>
        </div>

        <div
          ref={desktopListRef}
          onScroll={(e) => setDesktopScrollTop(e.currentTarget.scrollTop)}
          className="flex-1 overflow-y-auto thin-scrollbar relative p-2.5"
        >
          {visiblePageList.length === 0 ? (
            <div className="text-center py-10 px-3 text-xs text-slate-500 dark:text-slate-400">
              No cropped pages yet.
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: visiblePageList.length * DESKTOP_ROW_HEIGHT }}
            >
              {desktopSlice.map((page, offsetIdx) => {
                const realIdx = desktopStart + offsetIdx;
                const isActive = page === currentPage;
                const cropCount = cropCountsByPage[page] || 0;
                const thumb = getCachedThumb(page);

                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => onSelectPage(page)}
                    style={{
                      position: 'absolute',
                      top: realIdx * DESKTOP_ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: DESKTOP_ROW_HEIGHT - 10,
                    }}
                    className={`w-full text-left rounded-xl p-2 transition-colors border flex flex-col cursor-pointer ${
                      isActive
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 ring-1 ring-blue-600/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex-1 min-h-0 w-full rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={`Page ${page}`}
                          className="w-full h-full object-contain bg-white"
                        />
                      ) : (
                        <span className="text-[11px] font-mono tabular-nums text-slate-400">
                          p.{page}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs shrink-0">
                      <span
                        className={`font-mono tabular-nums font-medium ${
                          isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        Page {page}
                      </span>
                      {cropCount > 0 && (
                        <span className="font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                          {cropCount} saved
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Virtualized Bottom-Sheet Page Grid */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl h-[82vh] flex flex-col shadow-2xl border-t border-slate-200 dark:border-slate-800 pb-safe">
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 mb-1" />
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Browse Pages</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {totalPages} pages · {croppedPageCount} with crops
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close pages drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <form onSubmit={handleJumpSubmit} className="flex-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    inputMode="numeric"
                    value={jumpInput}
                    onChange={(e) => setJumpInput(e.target.value)}
                    placeholder={`Go to page (1–${totalPages})`}
                    className="flex-1 min-h-[40px] px-3 text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-3.5 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    Go
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setFilterMode((m) => (m === 'all' ? 'cropped' : 'all'))}
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium whitespace-nowrap ${
                    filterMode === 'cropped'
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Cropped ({croppedPageCount})
                </button>
              </div>
            </div>

            <div
              ref={mobileGridRef}
              onScroll={(e) => setMobileScrollTop(e.currentTarget.scrollTop)}
              className="flex-1 overflow-y-auto relative p-4"
            >
              {visiblePageList.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">
                  No cropped pages yet.
                </div>
              ) : (
                <div
                  className="relative w-full"
                  style={{ height: totalMobileRows * MOBILE_ROW_HEIGHT }}
                >
                  {mobileSlice.map((page, idx) => {
                    const globalIdx = mobileRowStart * mobileCols + idx;
                    const row = Math.floor(globalIdx / mobileCols);
                    const col = globalIdx % mobileCols;
                    const isActive = page === currentPage;
                    const cropCount = cropCountsByPage[page] || 0;
                    const thumb = getCachedThumb(page);
                    const widthPct = 100 / mobileCols;

                    return (
                      <div
                        key={page}
                        style={{
                          position: 'absolute',
                          top: row * MOBILE_ROW_HEIGHT,
                          left: `${col * widthPct}%`,
                          width: `${widthPct}%`,
                          height: MOBILE_ROW_HEIGHT - 10,
                          paddingLeft: col === 0 ? 0 : 6,
                          paddingRight: col === mobileCols - 1 ? 0 : 6,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPage(page);
                            onCloseMobile();
                          }}
                          className={`w-full h-full text-left rounded-xl p-2 border flex flex-col transition-colors ${
                            isActive
                              ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex-1 min-h-0 w-full rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200/70 dark:border-slate-700 flex items-center justify-center">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={`Page ${page}`}
                                className="w-full h-full object-contain bg-white"
                              />
                            ) : (
                              <span className="text-xs font-mono tabular-nums text-slate-400">
                                p.{page}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-xs shrink-0">
                            <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                              Page {page}
                            </span>
                            {cropCount > 0 && (
                              <span className="font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                                {cropCount} saved
                              </span>
                            )}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
