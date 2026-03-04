export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ImportProgress {
  total: number;
  current: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export type ProgressFn = (progress: ImportProgress) => void;
