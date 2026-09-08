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
        className="btn-primary demo-primary-action inline-flex min-w-0 items-center justify-center px-3 py-3 text-center text-sm"
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
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [newsletterVisited, setNewsletterVisited] = useState(false);
  const newsletterPreviewOnly = import.meta.env.DEV ||
    isFreedNewsletterPreviewHostname(window.location.hostname);
  return (
    <div
      data-testid="demo-welcome-desktop"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Freed"
      className={`demo-welcome-overlay fixed inset-0 z-[150] isolate flex items-center justify-center p-5 max-[640px]:p-0 ${departing ? "demo-welcome-first-look-backdrop--departing" : ""}`}
    >
      <div aria-hidden="true" className="demo-welcome-shade pointer-events-none absolute -z-10 bg-black/55 backdrop-blur-md" />
      <div
        className={`theme-floating-panel relative max-h-[100dvh] w-full max-w-3xl overflow-y-auto rounded-[2rem] p-7 text-center shadow-2xl shadow-black/40 sm:p-10 max-[640px]:h-full max-[640px]:!rounded-none max-[640px]:!border-0 ${departing ? "demo-welcome-first-look-card--departing" : "demo-welcome-first-look-card--arriving"}`}
        style={{ background: "var(--theme-bg-elevated)", border: "4px solid var(--theme-border-strong)", borderRadius: "2rem" }}
      >
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--theme-accent-glow),transparent_58%)] opacity-60"
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-center">
          <FreedLogo className="h-20 w-20 sm:h-24 sm:w-24" />
          <p className="mt-7 text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-[var(--theme-accent-secondary)]">
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
            className="btn-primary demo-primary-action mt-8 inline-flex min-h-14 min-w-[15rem] items-center justify-center px-10 py-4 text-lg max-[640px]:w-full max-[640px]:max-w-sm"
            style={{ borderRadius: "2rem" }}
            onClick={onExplore}
          >
            Explore Freed Demo
          </button>
          <div className="mt-3 w-full max-w-sm min-[641px]:hidden">
            <div inert={!newsletterOpen} aria-hidden={!newsletterOpen}
              className="grid transition-[grid-template-rows,opacity,transform,padding] duration-300 ease-in-out motion-reduce:transition-none"
              style={{ gridTemplateRows: newsletterOpen ? "1fr" : "0fr", opacity: newsletterOpen ? 1 : 0,
                transform: newsletterOpen ? "translateY(0)" : "translateY(-12px)", paddingBlock: newsletterOpen ? "1rem" : "0" }}>
              <div className="min-h-0 overflow-hidden">
                {newsletterVisited && <NewsletterSignup compact previewOnly={newsletterPreviewOnly}
                  {...(newsletterPreviewOnly ? { siteKey: FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY } : {})} />
                }
              </div>
            </div>
            <button type="button" aria-expanded={newsletterOpen}
              className="btn-secondary inline-flex !min-h-10 w-full items-center justify-center gap-2 rounded-[2rem] !px-4 !py-2 !text-sm"
              onClick={() => { setNewsletterVisited(true); setNewsletterOpen(value => !value); }}>
              {newsletterOpen && <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 15 6-6 6 6" /></svg>}
              {newsletterOpen ? "Back to welcome" : "Join the newsletter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldGuideWelcome({
  downloadUrl,
  arriving,
  initialMinimized,
  onMaximize,
}: DemoWelcomeBannerProps & {
  arriving: boolean;
  initialMinimized: boolean;
  onMaximize: () => void;
}) {
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [desktopMinimized, updateMinimized] = useState(initialMinimized);
  const setMinimized = (value: boolean) => {
    updateMinimized(value);
    saveDemoWelcomeState(value ? "minimized" : "banner");
  };
  const minimizeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const [mobileTab, setMobileTab] = useState(() => window.innerWidth <= 640);
  const minimized = mobileTab || desktopMinimized;
  const [requestedMobileTab, setRequestedMobileTab] = useState(mobileTab);
  const [tabChangingEdge, setTabChangingEdge] = useState(false);
  useLayoutEffect(() => {
    if (requestedMobileTab === mobileTab) return;
    // Leave through the old edge before mounting at the new edge. Remounting
    // prevents CSS from interpolating the rotation across the page.
    const timer = window.setTimeout(() => {
      setTabChangingEdge(true);
      setMobileTab(requestedMobileTab);
    }, minimized ? 600 : 0);
    return () => window.clearTimeout(timer);
  }, [requestedMobileTab, mobileTab, minimized]);
  useLayoutEffect(() => {
    if (requestedMobileTab !== mobileTab) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setTabChangingEdge(false));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [requestedMobileTab, mobileTab]);
  const tabVisible = minimized && requestedMobileTab === mobileTab && !tabChangingEdge;
  const [tabY, setTabY] = useState<number | null>(null);
  const [tabDragging, setTabDragging] = useState(false);
  const tabDrag = useRef<{ pointerId: number; startY: number; originY: number; moved: boolean } | null>(null);
  const suppressTabClick = useRef(false);
  const clampTabY = (y: number) => {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const height = viewport?.height ?? window.innerHeight;
    // After rotation, the tab's layout width is its vertical footprint.
    const half = (restoreRef.current?.offsetWidth ?? 288) / 2 + 12;
    return Math.max(top + Math.min(half, height / 2), Math.min(top + height - half, y));
  };
  useLayoutEffect(() => {
    const fitTab = () => {
      setRequestedMobileTab(window.innerWidth <= 640);
      setTabY((previous) => clampTabY(previous ??
        (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight) / 2));
    };
    fitTab();
    window.addEventListener("resize", fitTab);
    window.visualViewport?.addEventListener("resize", fitTab);
    window.visualViewport?.addEventListener("scroll", fitTab);
    return () => {
      window.removeEventListener("resize", fitTab);
      window.visualViewport?.removeEventListener("resize", fitTab);
      window.visualViewport?.removeEventListener("scroll", fitTab);
    };
  }, []);
  const endTabDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (tabDrag.current?.pointerId !== event.pointerId) return;
    tabDrag.current = null;
    setTabDragging(false);
  };
  const minimizationChanged = useRef(false);
  useLayoutEffect(() => {
    if (!minimizationChanged.current) return;
    (minimized ? restoreRef : minimizeRef).current?.focus();
  }, [minimized]);
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
    if (!content || minimized) return;
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
  }, [minimized]);
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
    <>
      <button
        key={mobileTab ? "vertical-tab" : "horizontal-tab"}
        data-testid="demo-welcome-tab"
        ref={restoreRef}
        type="button"
        aria-label="Restore demo banner"
        title="Restore demo banner"
        onClick={(event) => {
          if (event.detail !== 0 && suppressTabClick.current) {
            suppressTabClick.current = false;
            return;
          }
          if (mobileTab) onMaximize();
          else setMinimized(false);
        }}
        onPointerDown={(event) => {
          if (!mobileTab || event.button !== 0 || !event.isPrimary) return;
          suppressTabClick.current = false;
          tabDrag.current = { pointerId: event.pointerId, startY: event.clientY,
            originY: tabY ?? window.innerHeight / 2, moved: false };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = tabDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const delta = event.clientY - drag.startY;
          if (!drag.moved && Math.abs(delta) < 6) return;
          drag.moved = true;
          suppressTabClick.current = true;
          setTabDragging(true);
          setTabY(clampTabY(drag.originY + delta));
        }}
        onPointerUp={endTabDrag}
        onPointerCancel={endTabDrag}
        onLostPointerCapture={endTabDrag}
        inert={!minimized}
        className="demo-banner-morph demo-tab-restore fixed bottom-0 left-1/2 z-[139] w-[min(18rem,calc(100vw-1rem))] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-accent-primary)]"
        style={{
          width: "max-content",
          height: mobileTab ? "3rem" : "calc(3rem + var(--safe-area-bottom, 0px))",
          // Percentage positioning follows the layout viewport's scrollbar
          // gutter. Use viewport width so the rotated tab stays on the physical
          // right edge when the document starts or stops scrolling.
          left: mobileTab ? "calc(100vw - 1.5rem)" : undefined,
          top: mobileTab ? (tabY ?? "50%") : undefined,
          bottom: mobileTab ? "auto" : undefined,
          touchAction: mobileTab ? "none" : undefined,
          cursor: mobileTab ? (tabDragging ? "grabbing" : "grab") : undefined,
          opacity: tabVisible ? 1 : 0,
          visibility: tabVisible ? "visible" : "hidden",
          transform: mobileTab
            ? `translate(-50%, -50%) rotate(-90deg) translateY(${tabVisible ? "0" : "100%"})`
            : `translateX(-50%) translateY(${tabVisible ? "0" : "100%"})`,
          transformOrigin: mobileTab ? "center" : "bottom center",
          transition: `transform 600ms ease, opacity 600ms ease, visibility 0s ${tabVisible ? "0s" : "600ms"}`,
          pointerEvents: tabVisible ? "auto" : "none",
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 352 72" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          style={{ filter: mobileTab ? "none" : "drop-shadow(0 4px 12px rgb(0 0 0 / 0.18))" }}>
          <path d="M0 72 C30 72 30 58 36 36 C42 12 54 4 82 4 H270 C298 4 310 12 316 36 C322 58 322 72 352 72"
            fill="var(--theme-bg-elevated)" stroke="var(--theme-border-strong)" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="relative flex h-12 items-center gap-2 pl-10 pr-8 pt-1 text-[var(--theme-text-primary)]">
          <FreedLogo className="h-6 w-6 translate-x-2" />
          <span className="translate-x-2 text-base font-semibold">Freed Demo</span>
          <span className="demo-banner-control ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--theme-accent-primary)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H3v5m13 13h5v-5M3 3l7 7m11 11-7-7" />
            </svg>
          </span>
        </span>
      </button>
    <div
      data-testid="demo-welcome-desktop"
      inert={minimized}
      className="demo-banner-morph fixed bottom-[max(1rem,var(--safe-area-bottom))] left-1/2 z-[140] w-[min(32rem,calc(100vw-2rem))] max-[576px]:w-[calc(100vw-2rem)]"
      style={{
        opacity: minimized ? 0 : 1,
        visibility: minimized ? "hidden" : "visible",
        transform: `translateX(-50%) translateY(${minimized ? "3rem" : "0"}) scale(${minimized ? 0.78 : 1})`,
        transformOrigin: "bottom center",
        transition: `transform 460ms ease, opacity 460ms ease, visibility 0s ${minimized ? "460ms" : "0s"}`,
        pointerEvents: minimized ? "none" : "auto",
      }}
    >
      <div
        ref={cardRef}
        className={`theme-floating-panel relative max-h-[calc(100dvh-2rem)] touch-none overflow-y-auto rounded-[2rem] ${dragging ? "cursor-grabbing" : "cursor-grab"} ${arriving ? "demo-welcome-field-guide--arriving" : ""}`}
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
          className="flex select-none items-center justify-between pl-5 pr-24 pt-5"
        >
          <div className="flex items-center gap-2">
            <FreedLogo className="h-7 w-7" />
            <span className="text-sm font-semibold text-[var(--theme-text-primary)]">
              {newsletterOpen ? "Freed Newsletter" : "Freed Demo"}
            </span>
          </div>
          <div className="absolute right-1 top-1 flex items-center">
          <button ref={minimizeRef} type="button" aria-label="Minimize demo banner" title="Minimize demo banner"
            className="demo-banner-control -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--theme-accent-primary)] hover:bg-[var(--theme-accent-glow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => { minimizationChanged.current = true; setMinimized(true); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button type="button" aria-label="Open demo welcome modal" title="Open demo welcome modal"
            className="demo-banner-control inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--theme-accent-primary)] hover:bg-[var(--theme-accent-glow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={onMaximize}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H3v5m13 13h5v-5M3 3l7 7m11 11-7-7" />
            </svg>
          </button>
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
    </>
  );
}

const DEMO_WELCOME_STATE_KEY = "freed.demo.welcome-state.v1";
type DemoWelcomeState = "modal" | "banner" | "minimized";
function readDemoWelcomeState(): DemoWelcomeState {
  try {
    const state = localStorage.getItem(DEMO_WELCOME_STATE_KEY);
    return state === "banner" || state === "minimized" ? state : "modal";
  } catch { return "modal"; }
}
function saveDemoWelcomeState(state: DemoWelcomeState) {
  try { localStorage.setItem(DEMO_WELCOME_STATE_KEY, state); } catch { /* Storage may be disabled. */ }
}

export function DemoWelcomeBanner({ downloadUrl }: DemoWelcomeBannerProps) {
  const [initialState] = useState(() => window.innerWidth <= 640 ? "modal" : readDemoWelcomeState());
  const [transitioningToGuide, setTransitioningToGuide] = useState(false);
  const [guideVisible, setGuideVisible] = useState(initialState !== "modal");
  const [initialMinimized, setInitialMinimized] = useState(initialState === "minimized");
  const [guideArriving, setGuideArriving] = useState(false);

  const exploreDemo = () => {
    if (transitioningToGuide || guideVisible) return;
    const mobile = window.innerWidth <= 640;
    saveDemoWelcomeState(mobile ? "minimized" : "banner");
    setInitialMinimized(mobile);
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
          initialMinimized={initialMinimized}
          onMaximize={() => {
            saveDemoWelcomeState("modal");
            setTransitioningToGuide(false);
            setGuideArriving(false);
            setGuideVisible(false);
          }}
        />
      )}
    </>
  );
}
