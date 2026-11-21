export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CroppedQuestion {
  id: string;
  pageNumber: number;
  rect: NormalizedRect;
  imageDataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  label: string;
  sourceFileName: string;
  createdAt: number;
}

export type ExportLayoutMode = 'flow' | 'single-per-page';
export type ExportPageSize = 'a4' | 'letter' | 'fit';
export type ExportSpacing = 'compact' | 'standard' | 'wide';
export type ExportColumns = 1 | 2;
export type ExportMargin = 'narrow' | 'standard';

export interface ExportSettings {
  title: string;
  subtitle: string;
  pageSize: ExportPageSize;
  layoutMode: ExportLayoutMode;
  columns: ExportColumns;
  marginSize: ExportMargin;
  spacing: ExportSpacing;
  showQuestionNumbers: boolean;
  showColumnDivider: boolean;
  showDividers: boolean;
  showPageNumbers: boolean;
  dpiScale: 2 | 3 | 4;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  title: '',
  subtitle: '',
  pageSize: 'a4',
  layoutMode: 'flow',
  columns: 2,
  marginSize: 'narrow',
  spacing: 'compact',
  showQuestionNumbers: false,
  showColumnDivider: true,
  showDividers: false,
  showPageNumbers: true,
  dpiScale: 3,
};
