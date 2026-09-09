import type { ReactNode } from "react";

/** Local provider preferences stay available even when authentication expires. */
export function ProviderAdvancedSettings({ children }: { children: ReactNode }) {
  return (
    <details className="group">
      <summary className="text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] cursor-pointer select-none list-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block">›</span>
        Advanced
      </summary>
      <div className="mt-3 pl-3 border-l border-[var(--theme-border-subtle)]">
        {children}
      </div>
    </details>
  );
}
