import type { ReactNode } from "react";

interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ContentHeader({ title, subtitle, actions }: ContentHeaderProps) {
  return (
    <div className="theme-topbar shrink-0 border-b px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-[var(--theme-text-primary)]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
