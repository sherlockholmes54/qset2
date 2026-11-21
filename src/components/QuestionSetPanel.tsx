import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Crop,
  FileOutput,
  Maximize2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { CroppedQuestion, NormalizedRect } from '../types';
import { LoadedPdf } from '../utils/pdfEngine';
import { EditCropModal } from './EditCropModal';

interface QuestionSetPanelProps {
  questions: CroppedQuestion[];
  pdfDoc: LoadedPdf | null;
  totalPages: number;
  dpiScale: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onMoveQuestion: (index: number, direction: 'up' | 'down') => void;
  onDuplicateQuestion: (index: number) => void;
  onRemoveQuestion: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onEditCropSave: (
    id: string,
    rect: NormalizedRect,
    imageDataUrl: string,
    pixelWidth: number,
    pixelHeight: number
  ) => void;
  onClearAll: () => void;
  onJumpToPage: (pageNumber: number) => void;
  onProceedToExport: () => void;
}

export const QuestionSetPanel: React.FC<QuestionSetPanelProps> = ({
  questions,
  pdfDoc,
  totalPages,
  dpiScale,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMoveQuestion,
  onDuplicateQuestion,
  onRemoveQuestion,
  onUpdateLabel,
  onEditCropSave,
  onClearAll,
  onJumpToPage,
  onProceedToExport,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [inspectItem, setInspectItem] = useState<{
    question: CroppedQuestion;
    number: number;
  } | null>(null);
  const [editingItem, setEditingItem] = useState<{
    question: CroppedQuestion;
    number: number;
  } | null>(null);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Question Set</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'} selected
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo"
            aria-label="Undo last change"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo"
            aria-label="Redo change"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          {questions.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {confirmClear ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                    }}
                    className="min-h-[36px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 whitespace-nowrap cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="min-h-[36px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Question List */}
      <div className="flex-1 overflow-y-auto thin-scrollbar divide-y divide-slate-100 dark:divide-slate-800">
        {questions.length === 0 ? (
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-3">
              <Scissors className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No questions cropped yet</p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-[26ch] leading-relaxed">
              Use Auto-Crop Page or drag across any question on the PDF to add it to your set.
            </p>
          </div>
        ) : (
          questions.map((q, idx) => (
            <div key={q.id} className="p-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0 text-xs">
                  <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                    Q{idx + 1}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToPage(q.pageNumber)}
                    className="font-mono tabular-nums text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate cursor-pointer"
                  >
                    Page {q.pageNumber}
                  </button>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-400 dark:text-slate-500">
                    {q.pixelWidth}×{q.pixelHeight}
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingItem({ question: q, number: idx + 1 })}
                    className="min-h-[38px] px-2 flex items-center gap-1 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 cursor-pointer"
                    aria-label={`Edit crop for question ${idx + 1}`}
                    title="Edit crop"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveQuestion(idx, 'up')}
                    disabled={idx === 0}
                    className="min-h-[38px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    aria-label={`Move question ${idx + 1} up`}
                    title="Move up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveQuestion(idx, 'down')}
                    disabled={idx === questions.length - 1}
                    className="min-h-[38px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    aria-label={`Move question ${idx + 1} down`}
                    title="Move down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateQuestion(idx)}
                    className="min-h-[38px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                    aria-label={`Duplicate question ${idx + 1}`}
                    title="Duplicate"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveQuestion(q.id)}
                    className="min-h-[38px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                    aria-label={`Delete question ${idx + 1}`}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Image */}
              <button
                type="button"
                onClick={() => setInspectItem({ question: q, number: idx + 1 })}
                className="group relative w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white overflow-hidden p-2 text-left hover:border-slate-300 dark:hover:border-slate-500 transition-colors cursor-pointer"
              >
                <img
                  src={q.imageDataUrl}
                  alt={`Cropped question ${idx + 1}`}
                  className="w-full max-h-40 object-contain mx-auto bg-white"
                />
                <span className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-slate-900/75 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="w-3.5 h-3.5" />
                </span>
              </button>

              {/* Optional label / marks */}
              <input
                type="text"
                value={q.label}
                onChange={(e) => onUpdateLabel(q.id, e.target.value)}
                placeholder="Optional note or marks (e.g. 1 Mark)"
                className="mt-2 w-full px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors"
              />
            </div>
          ))
        )}
      </div>

      {/* Bottom Merge CTA */}
      {questions.length > 0 && (
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onProceedToExport}
            className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <FileOutput className="w-4 h-4" />
            <span>Merge &amp; Save PDF ({questions.length})</span>
          </button>
        </div>
      )}

      {/* Full-Resolution Inspection Lightbox */}
      {inspectItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4"
          onClick={() => setInspectItem(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                  Question {inspectItem.number}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Page {inspectItem.question.pageNumber} · {inspectItem.question.pixelWidth}×
                  {inspectItem.question.pixelHeight} px
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const current = inspectItem;
                    setInspectItem(null);
                    setEditingItem(current);
                  }}
                  className="min-h-[38px] px-3 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/60 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Crop className="w-3.5 h-3.5" />
                  <span>Edit Crop</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectItem(null)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
              <img
                src={inspectItem.question.imageDataUrl}
                alt={`Question ${inspectItem.number} full resolution`}
                className="max-w-full max-h-full bg-white rounded-lg shadow-sm border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Cropping Modal */}
      {editingItem && (
        <EditCropModal
          question={editingItem.question}
          questionNumber={editingItem.number}
          pdfDoc={pdfDoc}
          totalPages={totalPages}
          dpiScale={dpiScale}
          onSave={(rect, imageDataUrl, pixelWidth, pixelHeight) =>
            onEditCropSave(editingItem.question.id, rect, imageDataUrl, pixelWidth, pixelHeight)
          }
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
};
