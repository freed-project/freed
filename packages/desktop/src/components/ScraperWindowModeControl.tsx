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
        <p className="text-sm text-[#a1a1aa]">Scraper window mode</p>
        <p className="text-xs text-[#52525b] mt-0.5">
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
                  ? "border-[#8b5cf6]/60 bg-[#8b5cf6]/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={active ? "text-[#d8ccff]" : "text-[#d4d4d8]"}>
                  {option.label}
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    active ? "bg-[#8b5cf6]" : "bg-white/15"
                  }`}
                />
              </div>
              <p className="mt-1 text-xs text-[#71717a]">{option.blurb}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
