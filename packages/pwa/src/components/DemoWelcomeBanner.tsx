import { useState } from "react";
import { DraggableFloatingPanel } from "@freed/ui/components/DraggableFloatingPanel";

type DemoWelcomeBannerProps = {
  downloadUrl: string;
};

function BannerBody({ downloadUrl }: DemoWelcomeBannerProps) {
  return (
    <div className="theme-floating-panel rounded-2xl p-4 shadow-2xl shadow-black/30">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
        Freed showcase
      </p>
      <p className="mt-1 text-sm font-semibold text-[var(--theme-text-primary)]">
        Explore a pristine, read only Library
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
        This anonymous demo resets on every refresh. When you are ready for your own Library, download Freed Desktop.
      </p>
      <a
        className="btn-primary mt-3 inline-flex px-3 py-1.5 text-xs font-semibold"
        href={downloadUrl}
      >
        Download Freed Desktop
      </a>
    </div>
  );
}

export function DemoWelcomeBanner({ downloadUrl }: DemoWelcomeBannerProps) {
  const [minimized, setMinimized] = useState(false);

  return (
    <>
      <div className="hidden md:block">
        <DraggableFloatingPanel
          className="w-[min(24rem,calc(100vw-2rem))]"
          dataTestId="demo-welcome-desktop"
          initialEdge="top"
        >
          <BannerBody downloadUrl={downloadUrl} />
        </DraggableFloatingPanel>
      </div>
      <div className="md:hidden">
        {minimized ? (
          <button
            className="theme-floating-panel fixed bottom-20 right-4 z-[140] rounded-full px-3 py-2 text-xs font-semibold text-[var(--theme-text-primary)] shadow-xl"
            data-testid="demo-welcome-reopen"
            onClick={() => setMinimized(false)}
          >
            Show demo welcome
          </button>
        ) : (
          <div
            className="fixed bottom-20 left-4 right-4 z-[140]"
            data-testid="demo-welcome-mobile"
          >
            <button
              aria-label="Minimize demo welcome"
              className="theme-floating-panel absolute right-2 top-2 z-10 rounded-full px-2 py-1 text-xs text-[var(--theme-text-muted)]"
              onClick={() => setMinimized(true)}
            >
              Minimize
            </button>
            <BannerBody downloadUrl={downloadUrl} />
          </div>
        )}
      </div>
    </>
  );
}
