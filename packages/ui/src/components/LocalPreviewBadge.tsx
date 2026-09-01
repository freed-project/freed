import { DraggableFloatingPanel } from "./DraggableFloatingPanel";
type LocalPreviewBadgeProps = {
  label: string | null;
};

export function LocalPreviewBadge({ label }: LocalPreviewBadgeProps) {
  if (!label) {
    return null;
  }

  return (
    <DraggableFloatingPanel
      className="max-w-[min(32rem,calc(100vw-2rem))]"
      dataTestId="local-preview-badge"
    >
      <div className="theme-floating-panel flex items-center gap-0 rounded-2xl px-3 py-2 shadow-2xl shadow-black/30 sm:gap-3">
        <div className="hidden min-w-0 truncate whitespace-nowrap rounded-full bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)] sm:block">
          Local preview
        </div>
        <p className="min-w-0 truncate font-mono text-xs text-[var(--theme-text-primary)]">
          {label}
        </p>
      </div>
    </DraggableFloatingPanel>
  );
}
