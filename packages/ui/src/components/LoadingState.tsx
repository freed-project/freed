/** Shared, theme-aware loading treatment for routed views and inline content. */
export function LoadingState({ message, className = "" }: { message?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 text-sm text-[var(--theme-text-muted)] ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0 animate-spin motion-reduce:animate-none" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.18" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--theme-accent-primary)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className={message ? "leading-snug" : "sr-only"}>{message || "Loading"}</span>
    </div>
  );
}
