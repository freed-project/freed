import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY } from "@freed/shared";
import { NewsletterSignup } from "@freed/ui/components/NewsletterSignup";
import { isFreedNewsletterPreviewHostname } from "../lib/demo-mode";

type DemoWelcomeBannerProps = {
  downloadUrl: string;
};

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
      className={`${className} demo-freed-logo inline-flex shrink-0 items-center justify-center rounded-[28%] bg-[image:var(--theme-logo-spectrum)] text-[var(--theme-button-primary-text)] shadow-xl shadow-black/20 [container-type:inline-size]`}
    >
      <span className="font-logo text-[58cqi] font-bold leading-none">F</span>
    </span>
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
    <div className={`demo-banner-actions grid ${stacked ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
      <a
        className="btn-primary inline-flex min-w-0 items-center justify-center px-3 py-3 text-center text-sm"
        href={downloadUrl}
        style={{ borderRadius: "var(--demo-button-radius, 1.5rem)" }}
      >
        <span className="hidden min-[641px]:inline">Download Freed Desktop</span>
        <span className="whitespace-nowrap min-[641px]:hidden">Download Freed</span>
      </a>
      <button
        type="button"
        className="btn-secondary inline-flex min-w-0 items-center justify-center px-3 py-3 text-center text-sm"
        onClick={onJoinNewsletter}
        style={{ borderRadius: "var(--demo-button-radius, 1.5rem)" }}
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
      className={`fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-5 backdrop-blur-md ${departing ? "demo-welcome-first-look-backdrop--departing" : ""}`}
    >
      <div
        className={`theme-floating-panel relative w-full max-w-3xl overflow-hidden rounded-[2rem] p-7 text-center shadow-2xl shadow-black/40 sm:p-10 ${departing ? "demo-welcome-first-look-card--departing" : ""}`}
        style={{ background: "var(--theme-bg-elevated)", border: "4px solid var(--theme-border-strong)", borderRadius: "2rem" }}
      >
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
  arriving,
}: DemoWelcomeBannerProps & {
  arriving: boolean;
}) {
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const newsletterPreviewOnly =
    import.meta.env.DEV ||
    isFreedNewsletterPreviewHostname(window.location.hostname);
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>();
  const measuredHeightRef = useRef<number | undefined>(undefined);
  // Keep the chosen edge stable through a form's entire expand/collapse cycle.
  const expansionAnchorRef = useRef<"top" | "bottom">("bottom");
  useLayoutEffect(() => {
    const fitNarrowViewport = () => {
      if (window.innerWidth <= 576) setOffset((previous) => ({ ...previous, x: 0 }));
    };
    window.addEventListener("resize", fitNarrowViewport);
    return () => window.removeEventListener("resize", fitNarrowViewport);
  }, []);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Layout height excludes the entrance animation's temporary scale.
    const measure = () => {
      const nextHeight = content.offsetHeight;
      const previousHeight = measuredHeightRef.current;
      const card = cardRef.current;
      if (card && previousHeight !== undefined && previousHeight !== nextHeight) {
        const rect = card.getBoundingClientRect();
        const delta = nextHeight - previousHeight;
        const anchorTop = expansionAnchorRef.current === "top";
        setOffset((previous) => ({
          ...previous,
          y: previous.y + (anchorTop ? delta : 0) +
            Math.max(0, 16 - (rect.top - (anchorTop ? 0 : delta))) -
            Math.max(0, rect.bottom + (anchorTop ? delta : 0) - window.innerHeight + 16),
        }));
      }
      measuredHeightRef.current = nextHeight;
      setContentHeight(nextHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
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
    verticalOnly: boolean;
  } | null>(null);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !cardRef.current) return;
    if ((event.target as Element).closest("button, a, input, textarea, select, label, iframe, [role='button']")) return;
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
      verticalOnly: window.innerWidth <= 576,
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
      x: drag.verticalOnly ? 0 : Math.min(
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
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) expansionAnchorRef.current = rect.top < window.innerHeight / 2 ? "top" : "bottom";
    setDragging(false);
  };

  return (
    <div
      data-testid="demo-welcome-desktop"
      className="fixed bottom-[max(1rem,var(--safe-area-bottom))] left-1/2 z-[140] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 max-[576px]:w-[calc(100vw-2rem)]"
    >
      <div
        ref={cardRef}
        className={`theme-floating-panel max-h-[calc(100dvh-2rem)] touch-none overflow-y-auto rounded-[2rem] ${dragging ? "cursor-grabbing" : "cursor-grab"} ${arriving ? "demo-welcome-field-guide--arriving" : ""}`}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          transition: dragging ? "none" : "transform 300ms ease-in-out",
          background: "var(--theme-bg-elevated)",
          borderRadius: "2rem",
          border: "4px solid var(--theme-border-strong)",
          boxShadow: "0 24px 64px -12px rgb(0 0 0 / 0.6), 0 8px 20px rgb(0 0 0 / 0.25)",
        }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          data-testid="demo-welcome-drag-handle"
          className="flex select-none items-center justify-between px-5 pt-4"
        >
          <div className="flex items-center gap-2">
            <FreedLogo className="h-7 w-7" />
            <span className="text-sm font-semibold text-[var(--theme-text-primary)]">
              {newsletterOpen ? "Freed Newsletter" : "Freed Demo"}
            </span>
          </div>
        </div>
        <div className="overflow-hidden transition-[height] duration-300 ease-in-out motion-reduce:transition-none" style={{ height: contentHeight }}>
          <div ref={contentRef} className="px-4 pb-4">
            {!newsletterOpen && (
              <p className="pb-4 pt-0 text-center text-sm leading-relaxed text-[var(--theme-text-muted)] max-[480px]:pt-3">
                <span className="min-[641px]:hidden">Social media that respects you.</span>
                <span className="hidden min-[641px]:inline">
                  Social media that respects you, and your friends.
                  <span className="block">Ready to make it your own?</span>
                </span>
              </p>
            )}
            {newsletterOpen ? (
              <div className="pt-4">
                {newsletterPreviewOnly ? (
                  <NewsletterSignup
                    compact
                    previewOnly
                    siteKey={FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY}
                  />
                ) : (
                  <NewsletterSignup compact />
                )}
                <div className="demo-banner-actions mt-3 grid grid-cols-2 gap-2">
                  <a
                    className="btn-secondary inline-flex min-w-0 items-center justify-center px-3 py-3 text-center text-sm"
                    href={downloadUrl}
                    style={{ borderRadius: "var(--demo-button-radius, 1.5rem)" }}
                  >
                    <span className="hidden min-[641px]:inline">Download Freed Desktop</span>
                    <span className="whitespace-nowrap min-[641px]:hidden">Download Freed</span>
                  </a>
                  <button
                    type="button"
                    className="btn-secondary inline-flex min-w-0 items-center justify-center gap-2 px-3 py-3 text-center text-sm"
                    onClick={() => setNewsletterOpen(false)}
                    style={{ borderRadius: "var(--demo-button-radius, 1.5rem)" }}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="m6 6 12 12M6 18 18 6" />
                    </svg>
                    Skip the newsletter
                  </button>
                </div>
              </div>
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
  const [transitioningToGuide, setTransitioningToGuide] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideArriving, setGuideArriving] = useState(false);

  const exploreDemo = () => {
    if (transitioningToGuide || guideVisible) return;
    setTransitioningToGuide(true);
    setGuideVisible(true);
    setGuideArriving(true);
    window.setTimeout(() => {
      setTransitioningToGuide(false);
    }, 460);
    window.setTimeout(() => setGuideArriving(false), 900);
  };

  return (
    <>
      {(!guideVisible || transitioningToGuide) && (
        <FirstLookWelcome
          copy={WELCOME_COPY}
          departing={transitioningToGuide}
          onExplore={exploreDemo}
        />
      )}
      {guideVisible && (
        <FieldGuideWelcome
          downloadUrl={downloadUrl}
          arriving={guideArriving}
        />
      )}
    </>
  );
}
