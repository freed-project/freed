export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

export type ImportPhase = "scanning" | "writing" | "caching" | "fetching";

export interface ImportProgress {
  phase: ImportPhase;
  /** Total units in the current phase (files during scanning, chunks during writing) */
  total: number;
  /** Units completed in the current phase */
  current: number;
  /** Running count of items successfully imported so far */
  imported: number;
  /** Running count of items skipped (already exist or unparseable) */
  skipped: number;
  errors: string[];
}

export type ProgressFn = (progress: ImportProgress) => void;
