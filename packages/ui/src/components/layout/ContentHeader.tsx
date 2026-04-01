import type { ReactNode } from "react";

interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ContentHeader({ title, subtitle, actions }: ContentHeaderProps) {
  return (
    <div className="shrink-0 border-b border-white/5 bg-[#0f0f0f] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-white">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-xs text-[#71717a]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
