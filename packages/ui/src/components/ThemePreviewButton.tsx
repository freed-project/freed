import type { FocusEventHandler, MouseEventHandler } from "react";
import type { ThemeDefinition } from "@freed/shared/themes";

interface ThemePreviewButtonProps {
  theme: ThemeDefinition;
  active: boolean;
  onClick: () => void;
  onMouseEnter?: MouseEventHandler<HTMLButtonElement>;
  onMouseLeave?: MouseEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  variant?: "full" | "compact";
  className?: string;
}

export function ThemePreviewButton({
  theme,
  active,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  variant = "full",
  className = "",
}: ThemePreviewButtonProps) {
  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-pressed={active}
        aria-label={`${theme.name}. ${theme.description}`}
        className={`theme-preview-button theme-preview-button-compact ${active ? "theme-preview-button-active" : ""} ${className}`}
      >
        <span className="theme-preview-button-surface" aria-hidden="true">
          <span
            className="theme-preview-button-fill"
            style={{ background: theme.previewGradient }}
          />
          <span className="theme-preview-button-overlay" />
          <span className="theme-preview-button-sheen" />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-2xl border p-3 text-left transition-all ${
        active
          ? "border-[var(--theme-border-strong)] bg-[var(--theme-bg-card-hover)] shadow-[var(--theme-glow-sm)]"
          : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-bg-card-hover)]"
      } ${className}`}
    >
      <div
        className="relative h-20 rounded-xl border border-white/10"
        style={{ background: theme.previewGradient }}
        aria-hidden="true"
      >
        {active ? (
          <span className="absolute right-2 top-2 rounded-full border border-black/10 bg-[color:color-mix(in_srgb,var(--theme-bg-root)_72%,transparent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-primary)] shadow-sm backdrop-blur-md">
            Active
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <p
            className="text-sm font-semibold text-[var(--theme-text-primary)]"
            style={{ fontFamily: theme.previewDisplayFont }}
          >
            {theme.name}
          </p>
          <p
            className="mt-1 text-xs text-[var(--theme-text-muted)]"
            style={{ fontFamily: theme.previewBodyFont }}
          >
            {theme.tagline}
          </p>
        </div>
      </div>
      <p
        className="mt-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]"
        style={{ fontFamily: theme.previewBodyFont }}
      >
        {theme.description}
      </p>
    </button>
  );
}
