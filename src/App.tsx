import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  FileText,
  FileUp,
  Hand,
  Layers,
  LayoutGrid,
  Moon,
  Redo2,
  ScanText,
  Scissors,
  Search,
  Sparkles,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CroppedQuestion,
  DEFAULT_EXPORT_SETTINGS,
  ExportSettings,
  NormalizedRect,
} from './types';
import {
  extractHighResCrop,
  LoadedPdf,
  loadPdfFromBytes,
  loadPdfFromFile,
} from './utils/pdfEngine';
import {
  DetectedQuestionBox,
  detectQuestionsOnPage,
} from './utils/questionDetector';
import { createSampleQuestionBankPdf } from './utils/sampleQuestionBank';
import {
  loadExportSettingsFromDb,
  loadQuestionsFromDb,
  saveExportSettingsToDb,
  saveQuestionsToDb,
} from './utils/storage';
import { PdfPageCanvas } from './components/PdfPageCanvas';
import { PageThumbnailRail } from './components/PageThumbnailRail';
import { PageJumpSearchModal } from './components/PageJumpSearchModal';
import { QuestionSetPanel } from './components/QuestionSetPanel';
import { ExportBuilder } from './components/ExportBuilder';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

type WorkspaceTab = 'scan' | 'set' | 'export';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('scan');
  const [pdfDoc, setPdfDoc] = useState<LoadedPdf | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const [zoom, setZoom] = useState<number>(1);
  const [toolMode, setToolMode] = useState<'crop' | 'pan'>('crop');
  const [autoCapture, setAutoCapture] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [mobilePagesOpen, setMobilePagesOpen] = useState<boolean>(false);
  const [navModalOpen, setNavModalOpen] = useState<boolean>(false);
  const [navModalTab, setNavModalTab] = useState<'jump' | 'chapters' | 'search'>('jump');

  const [questions, setQuestions] = useState<CroppedQuestion[]>([]);
  const [pastHistory, setPastHistory] = useState<CroppedQuestion[][]>([]);
  const [futureHistory, setFutureHistory] = useState<CroppedQuestion[][]>([]);

  const [detectedBoxes, setDetectedBoxes] = useState<DetectedQuestionBox[]>([]);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [detectStatus, setDetectStatus] = useState<string>('');
  const [includeAnswers, setIncludeAnswers] = useState<boolean>(false);
  const [forceOcr, setForceOcr] = useState<boolean>(false);

  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [storageReady, setStorageReady] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const bottomBarSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const suppressBottomBarClickRef = useRef<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('qset-theme', next ? 'dark' : 'light');
      } catch {
        // ignore storage errors
      }
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute('content', next ? '#020617' : '#ffffff');
      }
      return next;
    });
  }, []);

  // Hydrate saved question set & export preferences from IndexedDB
  useEffect(() => {
    let active = true;
    (async () => {
      const [savedQuestions, savedSettings] = await Promise.all([
        loadQuestionsFromDb(),
        loadExportSettingsFromDb(),
      ]);
      if (!active) return;
      setQuestions(savedQuestions);
      setExportSettings(savedSettings);
      setStorageReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist changes locally for offline Android resilience
  useEffect(() => {
    if (!storageReady) return;
    saveQuestionsToDb(questions);
  }, [questions, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    saveExportSettingsToDb(exportSettings);
  }, [exportSettings, storageReady]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 2400);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const commitQuestions = useCallback(
    (updater: (prev: CroppedQuestion[]) => CroppedQuestion[]) => {
      setQuestions((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        setPastHistory((past) => [...past.slice(-39), prev]);
        setFutureHistory([]);
        return next;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    setPastHistory((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setQuestions((curr) => {
        setFutureHistory((fut) => [curr, ...fut.slice(0, 39)]);
        return previous;
      });
      showToast('Undid last change');
      return past.slice(0, -1);
    });
  }, [showToast]);

  const handleRedo = useCallback(() => {
    setFutureHistory((fut) => {
      if (fut.length === 0) return fut;
      const next = fut[0];
      setQuestions((curr) => {
        setPastHistory((past) => [...past.slice(-39), curr]);
        return next;
      });
      showToast('Redid change');
      return fut.slice(1);
    });
  }, [showToast]);

  // Global keyboard shortcuts for Undo / Redo & Left/Right Page Swapping on desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (
        pdfDoc &&
        activeTab === 'scan' &&
        !navModalOpen &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setCurrentPage((p) => Math.max(1, p - 1));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setCurrentPage((p) => Math.min(totalPages, p + 1));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, pdfDoc, activeTab, navModalOpen, totalPages]);

  // Clear pending auto-detect boxes when changing page
  useEffect(() => {
    setDetectedBoxes([]);
  }, [currentPage]);

  const activateLoadedPdf = useCallback(
    (doc: LoadedPdf, fileName: string) => {
      setPdfDoc((prev) => {
        if (prev && prev !== doc) {
          prev.cleanup(false).catch(() => {});
        }
        return doc;
      });
      setPdfFileName(fileName);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
      setZoom(1);
      setToolMode('crop');
      setDetectedBoxes([]);
      setActiveTab('scan');
    },
    []
  );

  const openPdfBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string) => {
      setIsLoadingPdf(true);
      setLoadError(null);
      try {
        const doc = await loadPdfFromBytes(buffer);
        activateLoadedPdf(doc, fileName);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Could not read this PDF file. Please verify it is a valid, unencrypted PDF.'
        );
      } finally {
        setIsLoadingPdf(false);
      }
    },
    [activateLoadedPdf]
  );

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setLoadError('Please choose a PDF (.pdf) question bank file.');
      return;
    }
    setIsLoadingPdf(true);
    setLoadError(null);
    try {
      const doc = await loadPdfFromFile(file);
      activateLoadedPdf(doc, file.name);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Could not read this PDF file. Please verify it is a valid, unencrypted PDF.'
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const handleLoadSamplePdf = async () => {
    setIsLoadingPdf(true);
    setLoadError(null);
    try {
      const bytes = await createSampleQuestionBankPdf();
      await openPdfBuffer(new Uint8Array(bytes).buffer, 'STEM_Question_Bank_Sample.pdf');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to generate sample PDF.');
      setIsLoadingPdf(false);
    }
  };

  const handleConfirmCrop = async (rect: NormalizedRect) => {
    if (!pdfDoc || isCapturing) return;
    setIsCapturing(true);
    try {
      const { imageDataUrl, pixelWidth, pixelHeight } = await extractHighResCrop(
        pdfDoc,
        currentPage,
        rect,
        exportSettings.dpiScale
      );
      const nextNum = questions.length + 1;
      const item: CroppedQuestion = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageNumber: currentPage,
        rect,
        imageDataUrl,
        pixelWidth,
        pixelHeight,
        label: '',
        sourceFileName: pdfFileName,
        createdAt: Date.now(),
      };
      commitQuestions((prev) => [...prev, item]);
      showToast(`Added Q${nextNum} from Page ${currentPage} (${pixelWidth}×${pixelHeight} px)`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to crop region.');
    } finally {
      setIsCapturing(false);
    }
  };

  const runAutoDetect = useCallback(
    async (overrideIncludeAnswers?: boolean, overrideForceOcr?: boolean) => {
      if (!pdfDoc || isDetecting) return;
      const ansMode = overrideIncludeAnswers ?? includeAnswers;
      const ocrMode = overrideForceOcr ?? forceOcr;
      setIsDetecting(true);
      setDetectStatus('Scanning page…');
      setLoadError(null);
      try {
        const boxes = await detectQuestionsOnPage(pdfDoc, currentPage, {
          includeAnswers: ansMode,
          forceOcr: ocrMode,
          ocrLang: 'eng',
          onStatus: setDetectStatus,
        });
        setDetectedBoxes(boxes);
        if (boxes.length === 0) {
          showToast('No numbered questions detected on this page. Try Force OCR or crop manually.');
        } else {
          showToast(
            `Detected ${boxes.length} ${boxes.length === 1 ? 'question' : 'questions'} (${
              ansMode ? 'answers included' : 'answers neglected'
            })`
          );
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Auto-detect failed on this page.');
      } finally {
        setIsDetecting(false);
        setDetectStatus('');
      }
    },
    [pdfDoc, currentPage, includeAnswers, forceOcr, isDetecting, showToast]
  );

  const handleToggleIncludeAnswers = () => {
    const next = !includeAnswers;
    setIncludeAnswers(next);
    if (detectedBoxes.length > 0) {
      runAutoDetect(next, forceOcr);
    }
  };

  const handleAddDetectedBoxes = async () => {
    if (!pdfDoc || isCapturing) return;
    const selected = detectedBoxes.filter((b) => b.selected);
    if (selected.length === 0) return;

    setIsCapturing(true);
    try {
      const created: CroppedQuestion[] = [];
      for (const box of selected) {
        const { imageDataUrl, pixelWidth, pixelHeight } = await extractHighResCrop(
          pdfDoc,
          currentPage,
          box.rect,
          exportSettings.dpiScale
        );
        created.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          pageNumber: currentPage,
          rect: box.rect,
          imageDataUrl,
          pixelWidth,
          pixelHeight,
          label: '',
          sourceFileName: pdfFileName,
          createdAt: Date.now(),
        });
      }
      commitQuestions((prev) => [...prev, ...created]);
      setDetectedBoxes([]);
      showToast(`Added ${created.length} cropped questions from Page ${currentPage}`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to extract detected crops.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= questions.length) return;
    commitQuestions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleDuplicateQuestion = (index: number) => {
    const source = questions[index];
    if (!source) return;
    const copy: CroppedQuestion = {
      ...source,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    commitQuestions((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const handleRemoveQuestion = (id: string) => {
    commitQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const handleEditCropSave = (
    id: string,
    rect: NormalizedRect,
    imageDataUrl: string,
    pixelWidth: number,
    pixelHeight: number
  ) => {
    commitQuestions((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, rect, imageDataUrl, pixelWidth, pixelHeight } : q
      )
    );
    showToast(`Updated crop (${pixelWidth}×${pixelHeight} px)`);
  };

  const handleUpdateLabel = (id: string, label: string) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, label } : q)));
  };

  const handleClearAll = () => {
    commitQuestions(() => []);
  };

  const handleUpdateExportSettings = (patch: Partial<ExportSettings>) => {
    setExportSettings((prev) => ({ ...prev, ...patch }));
  };

  const cropCountsByPage = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const q of questions) {
      counts[q.pageNumber] = (counts[q.pageNumber] || 0) + 1;
    }
    return counts;
  }, [questions]);

  const existingCropsOnCurrentPage = useMemo(() => {
    return questions
      .map((question, index) => ({ question, index }))
      .filter((entry) => entry.question.pageNumber === currentPage);
  }, [questions, currentPage]);

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="h-[100dvh] pt-[env(safe-area-inset-top)] flex flex-col bg-[#F8F9FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Hidden PDF File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          handleFileSelected(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Top Navigation Bar (Strict 3-Zone Contract, <= 48px mobile / 56px desktop) */}
      <header className="h-12 lg:h-14 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4 sm:gap-8 z-30">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('scan')}
          className="text-base lg:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Qset maker
        </button>

        {/* Zone 2: Desktop Single-Line Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'scan'
                ? 'border-blue-600 dark:border-blue-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Scan Bank
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'export'
                ? 'border-blue-600 dark:border-blue-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Export PDF ({questions.length})
          </button>
        </nav>

        {/* Zone 3: Theme Toggle, PWA Install & Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
            className="min-h-[36px] lg:min-h-[40px] min-w-[36px] lg:min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <PWAInstallButton />
          <button
            type="button"
            onClick={triggerUpload}
            className="inline-flex items-center gap-1.5 min-h-[36px] lg:min-h-[40px] px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>{pdfDoc ? 'Open PDF' : 'Upload PDF'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {activeTab === 'export' ? (
          <ExportBuilder
            questions={questions}
            settings={exportSettings}
            onUpdateSettings={handleUpdateExportSettings}
            onBackToCropper={() => setActiveTab('scan')}
          />
        ) : activeTab === 'set' ? (
          /* Mobile Question Set View */
          <div className="flex-1 overflow-hidden lg:hidden">
            <QuestionSetPanel
              questions={questions}
              pdfDoc={pdfDoc}
              totalPages={totalPages}
              dpiScale={exportSettings.dpiScale}
              canUndo={pastHistory.length > 0}
              canRedo={futureHistory.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onMoveQuestion={handleMoveQuestion}
              onDuplicateQuestion={handleDuplicateQuestion}
              onRemoveQuestion={handleRemoveQuestion}
              onUpdateLabel={handleUpdateLabel}
              onEditCropSave={handleEditCropSave}
              onClearAll={handleClearAll}
              onJumpToPage={(page) => {
                setCurrentPage(page);
                setActiveTab('scan');
              }}
              onProceedToExport={() => setActiveTab('export')}
            />
          </div>
        ) : !pdfDoc ? (
          /* Empty State: Upload Question Bank PDF */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              handleFileSelected(e.dataTransfer.files?.[0]);
            }}
            className="flex-1 overflow-y-auto thin-scrollbar flex flex-col items-center justify-center px-4 py-8 sm:p-10"
          >
            <div
              className={`w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border p-6 sm:p-10 text-center transition-colors ${
                isDraggingFile
                  ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-black text-white dark:border dark:border-slate-700 flex items-center justify-center mx-auto mb-5 shadow-sm">
                <Scissors className="w-6 h-6" />
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                Scan a Question Bank PDF &amp; Build Your Custom Set
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
                Upload any multi-page question bank PDF, crop specific questions with finger or
                mouse precision, and merge them into a clean, high-resolution printable PDF.
              </p>

              {loadError && (
                <div className="mt-4 text-xs sm:text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                  {loadError}
                </div>
              )}

              <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={isLoadingPdf}
                  onClick={triggerUpload}
                  className="w-full sm:w-auto min-h-[48px] px-6 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  <span>{isLoadingPdf ? 'Scanning PDF…' : 'Upload Question Bank PDF'}</span>
                </button>

                <button
                  type="button"
                  disabled={isLoadingPdf}
                  onClick={handleLoadSamplePdf}
                  className="w-full sm:w-auto min-h-[48px] px-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <span>Try Sample Question Bank</span>
                </button>
              </div>

              {questions.length > 0 && (
                <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {questions.length} cropped {questions.length === 1 ? 'question' : 'questions'}{' '}
                    saved from previous session
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('export')}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Open Export Builder
                  </button>
                </div>
              )}

              {/* Clean 3-Step Workflow Summary */}
              <div className="mt-9 pt-7 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-5 text-left">
                <div>
                  <p className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">01. Scan</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Full PDF Indexing</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Browse all pages from your question bank locally with zero file upload delays.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">02. Crop</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">High-DPI Capture</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Drag around any question or diagram to extract razor-sharp 3× resolution crops.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">03. Merge</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Exam-Ready PDF</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Reorder your chosen questions and pack them cleanly onto A4 or Letter pages.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Active PDF Scanner + Cropper + Desktop Question Set Split */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Workspace Control Toolbar */}
            <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2">
              {/* Left: File name, Search & Mobile Thumbnails */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="hidden md:inline text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
                  {pdfFileName}
                </span>
                <span className="hidden md:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
                  ·
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setNavModalTab('search');
                      setNavModalOpen(true);
                    }}
                    className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    aria-label="Find text or chapters in PDF"
                    title="Find text or chapters"
                  >
                    <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    <span className="hidden sm:inline">Find</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobilePagesOpen(true)}
                    className="lg:hidden min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                    aria-label="Browse page thumbnails"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Right: Touch Mode, Undo/Redo, OCR Auto-Crop, Quality, Zoom */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                {/* Undo / Redo */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={pastHistory.length === 0}
                    onClick={handleUndo}
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer disabled:cursor-default"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={futureHistory.length === 0}
                    onClick={handleRedo}
                    title="Redo (Ctrl+Shift+Z)"
                    aria-label="Redo"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer disabled:cursor-default"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* OCR Auto-Crop Group */}
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                  <button
                    type="button"
                    disabled={isDetecting}
                    onClick={() => runAutoDetect()}
                    title="Automatically detect & crop questions with options on this page"
                    className="min-h-[34px] px-2.5 rounded-md bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <ScanText className="w-3.5 h-3.5" />
                    <span>{isDetecting ? detectStatus || 'Scanning…' : 'Auto-Crop'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleIncludeAnswers}
                    title="Choose whether OCR neglects or includes answers on the right or below options"
                    className={`min-h-[34px] px-2 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      includeAnswers
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm'
                    }`}
                  >
                    {includeAnswers ? 'Ans: Include' : 'Ans: Neglect'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForceOcr((v) => !v)}
                    title="Force image-based Tesseract OCR even on PDFs with a text layer"
                    className={`hidden md:inline-flex min-h-[34px] px-2 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      forceOcr
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    OCR
                  </button>
                </div>

                {/* Crop vs Scroll/Pan Segmented Control */}
                <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setToolMode('crop')}
                    className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                      toolMode === 'crop'
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>Crop</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setToolMode('pan')}
                    className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                      toolMode === 'pan'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span>Scroll</span>
                  </button>
                </div>

                {/* Quick Auto-Add Toggle */}
                <button
                  type="button"
                  onClick={() => setAutoCapture((v) => !v)}
                  title="Automatically add manual crop to Question Set on release"
                  className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    autoCapture
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Auto-Add</span>
                </button>

                {/* Resolution Selector */}
                <select
                  aria-label="Crop resolution scale"
                  value={exportSettings.dpiScale}
                  onChange={(e) =>
                    handleUpdateExportSettings({ dpiScale: Number(e.target.value) as 2 | 3 | 4 })
                  }
                  className="hidden sm:block min-h-[36px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  <option value={2}>2× Std</option>
                  <option value={3}>3× High</option>
                  <option value={4}>4× Ultra</option>
                </select>

                {/* Zoom Controls */}
                <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 p-0.5">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                    disabled={zoom <= 0.75}
                    className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="min-h-[32px] px-1.5 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                    title="Reset zoom to fit width"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2.25, Number((z + 0.25).toFixed(2))))}
                    disabled={zoom >= 2.25}
                    className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* 3-Column Scanner Body */}
            <div className="flex-1 flex overflow-hidden">
              <PageThumbnailRail
                pdf={pdfDoc}
                totalPages={totalPages}
                currentPage={currentPage}
                cropCountsByPage={cropCountsByPage}
                onSelectPage={setCurrentPage}
                mobileOpen={mobilePagesOpen}
                onCloseMobile={() => setMobilePagesOpen(false)}
              />

              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <PdfPageCanvas
                  pdf={pdfDoc}
                  pageNumber={currentPage}
                  totalPages={totalPages}
                  zoom={zoom}
                  toolMode={toolMode}
                  autoCapture={autoCapture}
                  existingCropsOnPage={existingCropsOnCurrentPage}
                  detectedBoxes={detectedBoxes}
                  isCapturing={isCapturing}
                  onSelectPage={setCurrentPage}
                  onConfirmCrop={handleConfirmCrop}
                  onToggleDetectedBox={(id) =>
                    setDetectedBoxes((prev) =>
                      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b))
                    )
                  }
                  onUpdateDetectedRect={(id, rect) =>
                    setDetectedBoxes((prev) =>
                      prev.map((b) => (b.id === id ? { ...b, rect } : b))
                    )
                  }
                  onSelectAllDetected={(selected) =>
                    setDetectedBoxes((prev) => prev.map((b) => ({ ...b, selected })))
                  }
                  onAddDetectedBoxes={handleAddDetectedBoxes}
                  onCancelDetected={() => setDetectedBoxes([])}
                />

                {/* Bottom Page Navigation Bar (Back / Page Jump / Forward + Horizontal Swipe) */}
                <div
                  onPointerDown={(e) => {
                    bottomBarSwipeRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onPointerUp={(e) => {
                    const start = bottomBarSwipeRef.current;
                    bottomBarSwipeRef.current = null;
                    if (!start) return;
                    const dx = e.clientX - start.x;
                    const dy = e.clientY - start.y;
                    if (Math.abs(dx) >= 38 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                      suppressBottomBarClickRef.current = true;
                      window.setTimeout(() => {
                        suppressBottomBarClickRef.current = false;
                      }, 80);
                      if (dx < 0) {
                        setCurrentPage((p) => Math.min(totalPages, p + 1));
                      } else {
                        setCurrentPage((p) => Math.max(1, p - 1));
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    bottomBarSwipeRef.current = null;
                  }}
                  className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 sm:px-5 py-1.5 flex items-center justify-between gap-3 select-none touch-pan-y"
                >
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => {
                      if (suppressBottomBarClickRef.current) return;
                      setCurrentPage((p) => Math.max(1, p - 1));
                    }}
                    className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer disabled:cursor-default whitespace-nowrap shrink-0"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (suppressBottomBarClickRef.current) return;
                      setNavModalTab('jump');
                      setNavModalOpen(true);
                    }}
                    title="Tap to jump to page · Swipe left or right to swap pages"
                    className="min-h-[38px] px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>
                      Page {currentPage} / {totalPages}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => {
                      if (suppressBottomBarClickRef.current) return;
                      setCurrentPage((p) => Math.min(totalPages, p + 1));
                    }}
                    className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer disabled:cursor-default whitespace-nowrap shrink-0"
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Desktop Docked Question Set Sidebar */}
              <aside className="hidden lg:block w-88 xl:w-96 shrink-0 border-l border-slate-200 dark:border-slate-800 overflow-hidden">
                <QuestionSetPanel
                  questions={questions}
                  pdfDoc={pdfDoc}
                  totalPages={totalPages}
                  dpiScale={exportSettings.dpiScale}
                  canUndo={pastHistory.length > 0}
                  canRedo={futureHistory.length > 0}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onMoveQuestion={handleMoveQuestion}
                  onDuplicateQuestion={handleDuplicateQuestion}
                  onRemoveQuestion={handleRemoveQuestion}
                  onUpdateLabel={handleUpdateLabel}
                  onEditCropSave={handleEditCropSave}
                  onClearAll={handleClearAll}
                  onJumpToPage={setCurrentPage}
                  onProceedToExport={() => setActiveTab('export')}
                />
              </aside>
            </div>
          </div>
        )}
      </main>

      {pdfDoc && (
        <PageJumpSearchModal
          open={navModalOpen}
          pdf={pdfDoc}
          totalPages={totalPages}
          currentPage={currentPage}
          cropCountsByPage={cropCountsByPage}
          initialTab={navModalTab}
          onSelectPage={setCurrentPage}
          onClose={() => setNavModalOpen(false)}
        />
      )}

      {/* Mobile Fixed Bottom Navigation Bar (56px height) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe">
        <div className="grid grid-cols-3 h-14 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'scan' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Scissors className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Scan &amp; Crop</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('set')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'set' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight tabular-nums">
              Set ({questions.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'export' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <FileText className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Export PDF</span>
          </button>
        </div>
      </nav>

      {/* Non-blocking capture confirmation toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-30 lg:bottom-16 right-4 z-40 rounded-xl bg-slate-900 dark:bg-slate-800 text-white px-3.5 py-2.5 text-xs font-medium shadow-lg border border-slate-700 dark:border-slate-600"
        >
          {toastMessage}
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
