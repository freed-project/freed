type LocalPreviewBadgeProps = {
  label: string | null;
};

export function LocalPreviewBadge({ label }: LocalPreviewBadgeProps) {
  if (!label) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed left-4 top-4 z-[140] max-w-[min(32rem,calc(100vw-2rem))]">
      <div className="theme-floating-panel flex items-start gap-3 rounded-2xl px-3 py-2 shadow-2xl shadow-black/30">
        <div className="rounded-full bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
          Local preview
        </div>
        <p className="min-w-0 truncate font-mono text-xs text-[var(--theme-text-primary)]">
          {label}
        </p>
      </div>
    </div>
  );
}
