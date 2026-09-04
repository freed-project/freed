interface PwaLibraryBusyScreenProps {
  onRetry: () => void;
}

export function PwaLibraryBusyScreen({ onRetry }: PwaLibraryBusyScreenProps) {
  return (
    <main className="app-theme-shell flex h-screen min-h-screen items-center px-4 py-8 text-[var(--theme-text-primary)]">
      <section className="theme-dialog-shell mx-auto w-full max-w-2xl p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--theme-text-muted)]">
          Library already open
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-[var(--theme-text-primary)]">
          Freed is open in another tab
        </h1>
        <p className="mt-3 max-w-xl text-sm text-[var(--theme-text-muted)]">
          Freed keeps one tab connected to your local Library at a time to
          protect queued edits and offline content. Return to the other tab, or
          close it and retry here.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="theme-accent-button mt-5 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
        >
          Retry here
        </button>
      </section>
    </main>
  );
}
