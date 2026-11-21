import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Hash, Search, X } from 'lucide-react';
import {
  extractPdfOutline,
  LoadedPdf,
  PdfOutlineEntry,
  PdfSearchMatch,
  searchPdfText,
} from '../utils/pdfEngine';

interface PageJumpSearchModalProps {
  open: boolean;
  pdf: LoadedPdf;
  totalPages: number;
  currentPage: number;
  cropCountsByPage: Record<number, number>;
  initialTab?: 'jump' | 'chapters' | 'search';
  onSelectPage: (page: number) => void;
  onClose: () => void;
}

export const PageJumpSearchModal: React.FC<PageJumpSearchModalProps> = ({
  open,
  pdf,
  totalPages,
  currentPage,
  cropCountsByPage,
  initialTab = 'jump',
  onSelectPage,
  onClose,
}) => {
  const [tab, setTab] = useState<'jump' | 'chapters' | 'search'>(initialTab);
  const [pageInput, setPageInput] = useState<string>(String(currentPage));

  // PDF Outline / Bookmarks
  const [outline, setOutline] = useState<PdfOutlineEntry[] | null>(null);
  const [loadingOutline, setLoadingOutline] = useState<boolean>(false);

  // Full-text Search across 500+ pages
  const [query, setQuery] = useState<string>('');
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<{ scanned: number; total: number }>({
    scanned: 0,
    total: 0,
  });
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setPageInput(String(currentPage));
    } else {
      searchAbortRef.current?.abort();
    }
  }, [open, initialTab, currentPage]);

  // Reset outline & search when PDF changes
  useEffect(() => {
    setOutline(null);
    setMatches([]);
    setQuery('');
    searchAbortRef.current?.abort();
  }, [pdf]);

  useEffect(() => {
    if (!open || tab !== 'chapters' || outline !== null) return;
    let cancelled = false;
    setLoadingOutline(true);
    extractPdfOutline(pdf)
      .then((entries) => {
        if (!cancelled) setOutline(entries);
      })
      .finally(() => {
        if (!cancelled) setLoadingOutline(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, outline, pdf]);

  if (!open) return null;

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(pageInput, 10);
    if (!Number.isNaN(num)) {
      const clamped = Math.max(1, Math.min(totalPages, num));
      onSelectPage(clamped);
      onClose();
    }
  };

  const handleStartSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setMatches([]);
    setIsSearching(true);
    setScanProgress({ scanned: 0, total: totalPages });

    try {
      await searchPdfText(pdf, query, {
        signal: controller.signal,
        maxMatches: 80,
        onProgress: (scanned, total) => setScanProgress({ scanned, total }),
        onMatch: (match) => setMatches((prev) => [...prev, match]),
      });
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
        setScanProgress((prev) => ({ ...prev, scanned: totalPages }));
      }
    }
  };

  const stopSearch = () => {
    searchAbortRef.current?.abort();
    setIsSearching(false);
  };

  const croppedPages = Object.entries(cropCountsByPage)
    .filter(([, count]) => count > 0)
    .map(([page, count]) => ({ page: Number(page), count }))
    .sort((a, b) => a.page - b.page);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[82vh] overflow-hidden pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 sm:hidden" />

        {/* Modal Header + Segmented Tabs */}
        <div className="px-4 pt-3 pb-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Navigate Question Bank</h3>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Close navigation dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('jump')}
              className={`min-h-[38px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'jump'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>Go to Page</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('chapters')}
              className={`min-h-[38px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'chapters'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Chapters</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('search')}
              className={`min-h-[38px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'search'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Find Text</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto thin-scrollbar p-4">
          {tab === 'jump' && (
            <div className="space-y-5">
              <form onSubmit={handleJumpSubmit} className="space-y-3">
                <label htmlFor="jump-page-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Page Number (1 – {totalPages})
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="jump-page-input"
                    type="number"
                    min={1}
                    max={totalPages}
                    inputMode="numeric"
                    autoFocus
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    className="flex-1 min-h-[46px] px-3.5 text-base font-mono tabular-nums text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                  />
                  <button
                    type="submit"
                    className="min-h-[46px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Jump
                  </button>
                </div>
              </form>

              {/* Quick Stride Buttons for 500+ Page PDFs */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Quick Skip from Page {currentPage}
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[-50, -10, 10, 50].map((delta) => {
                    const target = Math.max(1, Math.min(totalPages, currentPage + delta));
                    return (
                      <button
                        key={delta}
                        type="button"
                        disabled={target === currentPage}
                        onClick={() => {
                          onSelectPage(target);
                          onClose();
                        }}
                        className="min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        {delta > 0 ? `+${delta}` : delta} (p.{target})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pages with saved crops */}
              {croppedPages.length > 0 && (
                <div>
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Pages with Saved Questions ({croppedPages.length})
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {croppedPages.map((entry) => (
                      <button
                        key={entry.page}
                        type="button"
                        onClick={() => {
                          onSelectPage(entry.page);
                          onClose();
                        }}
                        className="min-h-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-left flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                          p.{entry.page}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-400">
                          {entry.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'chapters' && (
            <div className="space-y-2">
              {loadingOutline ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  Reading PDF table of contents…
                </p>
              ) : !outline || outline.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    No bookmarks embedded in this PDF
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use Go to Page or Find Text to jump straight to any question or topic.
                  </p>
                </div>
              ) : (
                outline.map((entry, idx) => (
                  <button
                    key={`${entry.pageNumber}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectPage(entry.pageNumber);
                      onClose();
                    }}
                    style={{ paddingLeft: `${12 + entry.level * 16}px` }}
                    className="w-full min-h-[44px] pr-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 cursor-pointer"
                  >
                    <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{entry.title}</span>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      p.{entry.pageNumber}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'search' && (
            <div className="space-y-4">
              <form onSubmit={handleStartSearch} className="flex items-center gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Keyword, formula, or question #…"
                  className="flex-1 min-h-[44px] px-3.5 text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
                {isSearching ? (
                  <button
                    type="button"
                    onClick={stopSearch}
                    className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!query.trim()}
                    className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Search
                  </button>
                )}
              </form>

              {(isSearching || scanProgress.scanned > 0) && (
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>
                    {isSearching
                      ? `Scanning ${scanProgress.scanned} / ${scanProgress.total} pages…`
                      : `Scanned ${scanProgress.scanned} / ${scanProgress.total} pages`}
                  </span>
                  <span>
                    {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                  </span>
                </div>
              )}

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {matches.map((m, idx) => (
                  <button
                    key={`${m.pageNumber}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectPage(m.pageNumber);
                      onClose();
                    }}
                    className="w-full py-3 px-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                      Page {m.pageNumber}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                      {m.snippet}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
