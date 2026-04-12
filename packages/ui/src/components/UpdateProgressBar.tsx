interface UpdateProgressBarProps {
  percent: number;
  trackClassName?: string;
  fillClassName?: string;
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

export function UpdateProgressBar({
  percent,
  trackClassName = "h-1.5 overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_86%,transparent)]",
  fillClassName = "h-full rounded-full bg-[linear-gradient(90deg,var(--theme-accent-primary),var(--theme-accent-secondary),var(--theme-accent-tertiary))]",
}: UpdateProgressBarProps) {
  const clampedPercent = clampPercent(percent);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedPercent)}
      className={trackClassName}
    >
      <div className={fillClassName} style={{ width: `${clampedPercent}%` }} />
    </div>
  );
}
