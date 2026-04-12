import type { ScraperWindowMode } from "../lib/scraper-prefs";

const OPTIONS: Array<{
  mode: ScraperWindowMode;
  label: string;
  blurb: string;
}> = [
  {
    mode: "shown",
    label: "Shown",
    blurb: "Keep the browser window visible while syncing.",
  },
  {
    mode: "cloaked",
    label: "Cloaked",
    blurb: "Keep WebKit awake without showing the window on screen.",
  },
  {
    mode: "hidden",
    label: "Hidden",
    blurb: "Hide the window entirely. This is quieter, but may be less reliable.",
  },
];

interface ScraperWindowModeControlProps {
  mode: ScraperWindowMode;
  onChange: (mode: ScraperWindowMode) => void;
  sourceLabel: string;
}

export function ScraperWindowModeControl({
  mode,
  onChange,
  sourceLabel,
}: ScraperWindowModeControlProps) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm text-[var(--theme-text-secondary)]">Scraper window mode</p>
        <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">
          Choose how the {sourceLabel} browser window behaves during sync.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label={`${sourceLabel} scraper window mode`}
        className="grid gap-2"
      >
        {OPTIONS.map((option) => {
          const active = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.mode)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.12)]"
                  : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] hover:bg-[var(--theme-bg-card)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={active ? "text-[var(--theme-text-primary)]" : "text-[var(--theme-text-secondary)]"}>
                  {option.label}
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    active ? "bg-[var(--theme-accent-secondary)]" : "bg-[var(--theme-border-quiet)]"
                  }`}
                />
              </div>
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{option.blurb}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
