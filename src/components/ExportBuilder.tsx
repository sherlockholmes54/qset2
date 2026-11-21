import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ArrowLeft, Download, FileCheck2, Share2 } from 'lucide-react';
import { CroppedQuestion, ExportSettings } from '../types';
import {
  generateMergedPdf,
  loadPdfFromBytes,
  renderPdfPageThumbnail,
} from '../utils/pdfEngine';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

interface ExportBuilderProps {
  questions: CroppedQuestion[];
  settings: ExportSettings;
  onUpdateSettings: (patch: Partial<ExportSettings>) => void;
  onBackToCropper: () => void;
}

export const ExportBuilder: React.FC<ExportBuilderProps> = ({
  questions,
  settings,
  onUpdateSettings,
  onBackToCropper,
}) => {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shareSupported, setShareSupported] = useState<boolean>(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  useEffect(() => {
    setShareSupported(
      Capacitor.isNativePlatform() ||
        (typeof navigator !== 'undefined' &&
          typeof navigator.share === 'function' &&
          typeof navigator.canShare === 'function')
    );
  }, []);

  // Re-compose live preview whenever questions or export settings change
  useEffect(() => {
    let cancelled = false;
    if (questions.length === 0) {
      setPdfBytes(null);
      setPreviewPages([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsBuilding(true);
      setError(null);
      try {
        const bytes = await generateMergedPdf(questions, settings);
        if (cancelled) return;
        setPdfBytes(bytes);

        const copy = new Uint8Array(bytes).buffer;
        const previewDoc = await loadPdfFromBytes(copy);
        if (cancelled) return;

        const rendered: string[] = [];
        for (let p = 1; p <= previewDoc.numPages; p++) {
          if (cancelled) return;
          const { dataUrl } = await renderPdfPageThumbnail(previewDoc, p, 760);
          rendered.push(dataUrl);
        }
        if (!cancelled) {
          setPreviewPages(rendered);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to compose PDF');
        }
      } finally {
        if (!cancelled) {
          setIsBuilding(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [questions, settings]);

  const sanitizedFileName =
    (settings.title.trim() || 'Question-Set')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.pdf';

  const handleDownloadPdf = async () => {
    if (!pdfBytes) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const base64Data = uint8ArrayToBase64(pdfBytes);
        try {
          const perm = await Filesystem.checkPermissions();
          if (perm.publicStorage !== 'granted') {
            await Filesystem.requestPermissions();
          }
          await Filesystem.writeFile({
            path: sanitizedFileName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true,
          });
          setSavedFeedback(`Saved to Documents/${sanitizedFileName}`);
          window.setTimeout(() => setSavedFeedback(null), 3500);
          return;
        } catch {
          // Fallback to Cache + native Share/Save dialog on scoped-storage devices
          const cached = await Filesystem.writeFile({
            path: sanitizedFileName,
            data: base64Data,
            directory: Directory.Cache,
            recursive: true,
          });
          await Share.share({
            title: settings.title.trim() || 'Question Set PDF',
            files: [cached.uri],
            dialogTitle: 'Save or Share Question Set PDF',
          });
          setSavedFeedback(`Prepared ${sanitizedFileName}`);
          window.setTimeout(() => setSavedFeedback(null), 3500);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save PDF on device');
        return;
      }
    }

    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizedFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    setSavedFeedback(`Saved ${sanitizedFileName}`);
    window.setTimeout(() => setSavedFeedback(null), 3000);
  };

  const handleSharePdf = async () => {
    if (!pdfBytes) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const base64Data = uint8ArrayToBase64(pdfBytes);
        const cached = await Filesystem.writeFile({
          path: sanitizedFileName,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        });
        await Share.share({
          title: settings.title.trim() || 'Question Set PDF',
          files: [cached.uri],
          dialogTitle: 'Share Question Set PDF',
        });
      } catch (err) {
        if (err instanceof Error && !err.message.toLowerCase().includes('cancel')) {
          setError(err.message);
        }
      }
      return;
    }

    try {
      const file = new File([new Uint8Array(pdfBytes)], sanitizedFileName, {
        type: 'application/pdf',
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: settings.title.trim() || 'Question Set PDF',
          files: [file],
        });
      } else {
        handleDownloadPdf();
      }
    } catch (err) {
      // User cancelled share sheet or platform denied share
      if (err instanceof Error && err.name !== 'AbortError') {
        handleDownloadPdf();
      }
    }
  };

  const fileSizeLabel = pdfBytes
    ? pdfBytes.byteLength >= 1024 * 1024
      ? `${(pdfBytes.byteLength / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(pdfBytes.byteLength / 1024))} KB`
    : '—';

  return (
    <div className="flex-1 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row bg-[#F8F9FA] dark:bg-slate-950">
      {/* Left Configuration Sidebar */}
      <div className="w-full lg:w-96 shrink-0 bg-white dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 lg:overflow-y-auto thin-scrollbar p-4 sm:p-5 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBackToCropper}
            className="min-h-[40px] px-2.5 -ml-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Scanner</span>
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {questions.length} crops · {previewPages.length} {previewPages.length === 1 ? 'page' : 'pages'} · {fileSizeLabel}
          </span>
        </div>

        <div className="space-y-3.5">
          <div>
            <label htmlFor="set-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Document Title (Optional)
            </label>
            <input
              id="set-title"
              type="text"
              value={settings.title}
              onChange={(e) => onUpdateSettings({ title: e.target.value })}
              placeholder="e.g. Physics & Chemistry MCQ — Set A"
              className="w-full min-h-[42px] px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="set-subtitle" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Subtitle / Instructions (Optional)
            </label>
            <input
              id="set-subtitle"
              type="text"
              value={settings.subtitle}
              onChange={(e) => onUpdateSettings({ subtitle: e.target.value })}
              placeholder="e.g. Time: 30 mins · Marks: 30"
              className="w-full min-h-[42px] px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-500"
            />
          </div>
        </div>

        {/* Page Size */}
        <div>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Page Size</span>
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            {(
              [
                { id: 'a4', label: 'A4' },
                { id: 'letter', label: 'Letter' },
                { id: 'fit', label: 'Fit Crop' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onUpdateSettings({ pageSize: opt.id })}
                className={`min-h-[38px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  settings.pageSize === opt.id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Layout Mode */}
        <div>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Merge Layout</span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => onUpdateSettings({ layoutMode: 'flow' })}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                settings.layoutMode === 'flow'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Pack Multiple
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ layoutMode: 'single-per-page' })}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                settings.layoutMode === 'single-per-page'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              1 Per Page
            </button>
          </div>
        </div>

        {/* Columns & Margins (when Pack Multiple is active) */}
        {settings.layoutMode === 'flow' && settings.pageSize !== 'fit' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Columns</span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ columns: 1 })}
                    className={`min-h-[36px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.columns === 1
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    1 Col
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ columns: 2 })}
                    className={`min-h-[36px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.columns === 2
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    2 Cols
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Margins</span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ marginSize: 'narrow' })}
                    className={`min-h-[36px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.marginSize === 'narrow'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Narrow
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ marginSize: 'standard' })}
                    className={`min-h-[36px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.marginSize === 'standard'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Normal
                  </button>
                </div>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Spacing Between Questions
              </span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {(
                  [
                    { id: 'compact', label: 'Compact' },
                    { id: 'standard', label: 'Standard' },
                    { id: 'wide', label: 'Wide' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ spacing: opt.id })}
                    className={`min-h-[38px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      settings.spacing === opt.id
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Formatting Toggles */}
        <div className="space-y-2.5 pt-1">
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Page Formatting</span>
          <label className="flex items-center justify-between min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Inline numbers (01, 02…)
            </span>
            <input
              type="checkbox"
              checked={settings.showQuestionNumbers}
              onChange={(e) => onUpdateSettings({ showQuestionNumbers: e.target.checked })}
              className="w-4 h-4 accent-blue-600 rounded"
            />
          </label>
          {settings.layoutMode === 'flow' && settings.columns === 2 && settings.pageSize !== 'fit' && (
            <label className="flex items-center justify-between min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Center column divider line
              </span>
              <input
                type="checkbox"
                checked={settings.showColumnDivider}
                onChange={(e) => onUpdateSettings({ showColumnDivider: e.target.checked })}
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>
          )}
          <label className="flex items-center justify-between min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Horizontal dividers</span>
            <input
              type="checkbox"
              checked={settings.showDividers}
              onChange={(e) => onUpdateSettings({ showDividers: e.target.checked })}
              className="w-4 h-4 accent-blue-600 rounded"
            />
          </label>
          <label className="flex items-center justify-between min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Page footer numbers</span>
            <input
              type="checkbox"
              checked={settings.showPageNumbers}
              onChange={(e) => onUpdateSettings({ showPageNumbers: e.target.checked })}
              className="w-4 h-4 accent-blue-600 rounded"
            />
          </label>
        </div>

        {/* Save & Share Actions */}
        <div className="pt-2 space-y-2.5">
          <button
            type="button"
            disabled={!pdfBytes || isBuilding}
            onClick={handleDownloadPdf}
            className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{isBuilding ? 'Composing PDF…' : 'Save High-Quality PDF'}</span>
          </button>

          {shareSupported && (
            <button
              type="button"
              disabled={!pdfBytes || isBuilding}
              onClick={handleSharePdf}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-800 dark:text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>Share PDF</span>
            </button>
          )}

          {savedFeedback && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 pt-1">
              <FileCheck2 className="w-4 h-4" />
              <span>{savedFeedback}</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl p-3">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Right Live Merged PDF Preview */}
      <div className="flex-1 lg:overflow-y-auto thin-scrollbar p-4 sm:p-8 flex flex-col items-center gap-6 bg-slate-200/75 dark:bg-slate-950">
        {questions.length === 0 ? (
          <div className="my-auto text-center max-w-sm">
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Your question set is empty</p>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Return to the PDF scanner and crop one or more questions to generate a merged PDF.
            </p>
            <button
              type="button"
              onClick={onBackToCropper}
              className="mt-4 min-h-[44px] px-5 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
            >
              Go to PDF Scanner
            </button>
          </div>
        ) : (
          <>
            <div className="w-full max-w-2xl flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium">Live Merged Document Preview</span>
              <span className="font-mono tabular-nums">
                {previewPages.length} {previewPages.length === 1 ? 'page' : 'pages'}
              </span>
            </div>

            {isBuilding && previewPages.length === 0 ? (
              <div className="my-12 text-sm text-slate-500 dark:text-slate-400 font-medium">
                Rendering high-quality PDF preview…
              </div>
            ) : (
              previewPages.map((dataUrl, idx) => (
                <div
                  key={idx}
                  className="w-full max-w-2xl bg-white shadow-md border border-slate-300/80 dark:border-slate-700 rounded-sm overflow-hidden"
                >
                  <img
                    src={dataUrl}
                    alt={`Merged question set page ${idx + 1}`}
                    className="w-full h-auto block"
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};
