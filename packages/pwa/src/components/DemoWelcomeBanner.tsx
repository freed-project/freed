import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY } from "@freed/shared";
import { NewsletterSignup } from "@freed/ui/components/NewsletterSignup";
import { isFreedNewsletterPreviewHostname } from "../lib/demo-mode";

type DemoWelcomeBannerProps = {
  downloadUrl: string;
};

type PanelMode = "minimized" | "expanded";

type WelcomeCopy = {
  eyebrow: string;
  headline: string;
  body: string;
};

const WELCOME_COPY: WelcomeCopy = {
  eyebrow: "Your feed. Your rules.",
  headline: "Take back your feed.",
  body: "Freed brings social posts, RSS, video, and saved pages into one local Library. You control what you see. No ads, no tracking, and no algorithmic manipulation.",
};

function FreedLogo({ className = "h-16 w-16" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Freed"
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-[28%] bg-[image:var(--theme-logo-spectrum)] text-[var(--theme-button-primary-text)] shadow-xl shadow-black/20 [container-type:inline-size]`}
    >
      <span className="font-logo text-[58cqi] font-bold leading-none">F</span>
    </span>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "up" ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5"} />
    </svg>
  );
}

function WelcomeActions({
  downloadUrl,
  stacked = false,
  onJoinNewsletter,
}: DemoWelcomeBannerProps & {
  stacked?: boolean;
  onJoinNewsletter: () => void;
}) {
  return (
    <div className={`flex ${stacked ? "flex-col" : "flex-wrap"} gap-2`}>
      <a
        className="btn-primary inline-flex items-center justify-center px-4 py-2 text-sm"
        href={downloadUrl}
      >
        Download Freed Desktop
      </a>
      <button
        type="button"
        className="btn-secondary inline-flex items-center justify-center px-4 py-2 text-sm"
        onClick={onJoinNewsletter}
      >
        Join the newsletter
      </button>
    </div>
  );
}

function FirstLookWelcome({
  copy,
  departing,
  onExplore,
}: {
  copy: WelcomeCopy;
  departing: boolean;
  onExplore: () => void;
}) {
  return (
    <div
      data-testid="demo-welcome-desktop"
      className={`fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-5 backdrop-blur-md ${departing ? "demo-welcome-first-look-backdrop--departing" : ""}`}
    >
      <div className={`theme-floating-panel relative w-full max-w-3xl overflow-hidden rounded-[2rem] p-7 text-center shadow-2xl shadow-black/40 sm:p-10 ${departing ? "demo-welcome-first-look-card--departing" : ""}`}>
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--theme-accent-glow),transparent_58%)] opacity-60"
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-center">
          <FreedLogo className="h-20 w-20 sm:h-24 sm:w-24" />
          <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--theme-accent-secondary)]">
            {copy.eyebrow}
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-[1.06] text-[var(--theme-text-primary)] sm:text-5xl">
            {copy.headline}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--theme-text-muted)]">
            {copy.body}
          </p>
          <button
            type="button"
            className="btn-primary mt-8 inline-flex min-h-14 min-w-[15rem] items-center justify-center px-10 py-4 text-lg"
            onClick={onExplore}
          >
            Explore Freed Demo
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldGuideWelcome({
  downloadUrl,
  mode,
  onModeChange,
  arriving,
}: DemoWelcomeBannerProps & {
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  arriving: boolean;
}) {
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const newsletterPreviewOnly =
    import.meta.env.DEV ||
    isFreedNewsletterPreviewHostname(window.location.hostname);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    baseLeft: number;
    baseRight: number;
    baseTop: number;
    baseBottom: number;
  } | null>(null);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      baseLeft: rect.left - offset.x,
      baseRight: rect.right - offset.x,
      baseTop: rect.top - offset.y,
      baseBottom: rect.bottom - offset.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const margin = 12;
    const nextX = drag.originX + event.clientX - drag.startX;
    const nextY = drag.originY + event.clientY - drag.startY;
    setOffset({
      x: Math.min(
        window.innerWidth - margin - drag.baseRight,
        Math.max(margin - drag.baseLeft, nextX),
      ),
      y: Math.min(
        window.innerHeight - margin - drag.baseBottom,
        Math.max(margin - drag.baseTop, nextY),
      ),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  if (mode === "minimized") {
    return (
      <button
        type="button"
        data-testid="demo-welcome-reopen"
        className="theme-floating-panel fixed bottom-0 left-1/2 z-[140] flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-t-xl border-b-0 px-5 pb-[max(0.625rem,var(--safe-area-bottom))] pt-2 text-sm font-semibold text-[var(--theme-text-primary)] shadow-xl"
        onClick={() => onModeChange("expanded")}
      >
        <ChevronIcon direction="up" />
        Freed Demo
      </button>
    );
  }

  return (
    <div
      data-testid="demo-welcome-desktop"
      className="fixed bottom-[max(1rem,var(--safe-area-bottom))] left-1/2 z-[140] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      <div
        ref={cardRef}
        className={`theme-floating-panel max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl shadow-2xl shadow-black/30 ${arriving ? "demo-welcome-field-guide--arriving" : ""}`}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      >
        <div
          data-testid="demo-welcome-drag-handle"
          className={`flex touch-none select-none items-center justify-between border-b border-[var(--theme-border-subtle)] px-4 py-2.5 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="flex items-center gap-2">
            <FreedLogo className="h-7 w-7" />
            <span className="text-sm font-semibold text-[var(--theme-text-primary)]">
              Freed Demo
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="hidden h-1.5 w-10 rounded-full bg-[var(--theme-border-strong)] sm:block"
              aria-hidden="true"
            />
            <button
              type="button"
              aria-label="Minimize Freed Demo"
              className="theme-toolbar-button-neutral -mr-1 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--theme-text-muted)] sm:hidden"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onModeChange("minimized")}
            >
              <ChevronIcon direction="down" />
            </button>
          </div>
        </div>
        <div className="p-3">
          <div>
            {newsletterOpen ? (
              <>
                {newsletterPreviewOnly ? (
                  <NewsletterSignup
                    compact
                    previewOnly
                    siteKey={FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY}
                  />
                ) : (
                  <NewsletterSignup compact />
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    className="btn-secondary inline-flex items-center justify-center px-4 py-2 text-sm"
                    href={downloadUrl}
                  >
                    Download Freed Desktop
                  </a>
                  <button
                    type="button"
                    className="theme-toolbar-button-ghost rounded-lg px-3 py-2 text-xs font-semibold"
                    onClick={() => setNewsletterOpen(false)}
                  >
                    Back to guide
                  </button>
                </div>
              </>
            ) : (
              <WelcomeActions
                downloadUrl={downloadUrl}
                onJoinNewsletter={() => setNewsletterOpen(true)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoWelcomeBanner({ downloadUrl }: DemoWelcomeBannerProps) {
  const [mode, setMode] = useState<PanelMode>("expanded");
  const [transitioningToGuide, setTransitioningToGuide] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideArriving, setGuideArriving] = useState(false);

  const exploreDemo = () => {
    setTransitioningToGuide(true);
    window.setTimeout(() => {
      setGuideVisible(true);
      setMode("expanded");
      setTransitioningToGuide(false);
      setGuideArriving(true);
      window.setTimeout(() => setGuideArriving(false), 620);
    }, 460);
  };

  return (
    <>
      {guideVisible ? (
        <FieldGuideWelcome
          downloadUrl={downloadUrl}
          mode={mode}
          onModeChange={setMode}
          arriving={guideArriving}
        />
      ) : (
        <FirstLookWelcome
          copy={WELCOME_COPY}
          departing={transitioningToGuide}
          onExplore={exploreDemo}
        />
      )}
    </>
  );
}
