import { useRef, useState } from "react";
import { Tooltip } from "../Tooltip.js";

export type CareLevel = 1 | 2 | 3 | 4 | 5;

export function careLevelLabel(level: number): string {
  return level <= 2 ? "Connection" : level <= 4 ? "Friend" : "Fam";
}

/** One rating control for identity details and editing, with keyboard parity. */
export function CareRating({
  level,
  onChange,
}: {
  level: CareLevel;
  onChange?: (level: CareLevel) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<CareLevel | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const writing = useRef(false);
  return (
    <div>
      <div
        className="inline-flex items-center gap-0.5"
        role="group"
        aria-label={`Care level ${level.toLocaleString()} of 5: ${careLevelLabel(level)}`}
        onPointerLeave={() => setPreview(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPreview(null);
        }}
      >
        {([1, 2, 3, 4, 5] as const).map((value) => {
          const label = `Set ${careLevelLabel(value)}: ${value.toLocaleString()} of 5 stars`;
          const icon = (
            <svg
              viewBox="0 0 12 12"
              aria-hidden="true"
              className={`h-4 w-4 transition-colors ${value <= (preview ?? level) ? "text-[color:var(--theme-accent-secondary)]" : "text-[color:var(--theme-border-strong)]"}`}
              fill="currentColor"
            >
              <path d="M6 1l1.5 3H11L8.5 6l1 3L6 7.5 2.5 9l1-3L1 4h3.5z" />
            </svg>
          );
          return onChange ? (
            <Tooltip key={value} label={label}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={level === value}
                disabled={pending}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)] disabled:opacity-60 motion-reduce:transform-none"
                onPointerEnter={() => setPreview(value)}
                onFocus={() => setPreview(value)}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={async (event) => {
                  event.stopPropagation();
                  if (writing.current) return;
                  writing.current = true;
                  setPending(true);
                  setError(false);
                  try {
                    await onChange(value);
                  } catch {
                    setError(true);
                  } finally {
                    writing.current = false;
                    setPending(false);
                    setPreview(null);
                  }
                }}
              >
                {icon}
              </button>
            </Tooltip>
          ) : (
            <span key={value}>{icon}</span>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs theme-feedback-text-warning">
          Could not save the care level. Please try again.
        </p>
      )}
    </div>
  );
}
