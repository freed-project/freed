/**
 * SettingsDialog — unified two-column settings experience.
 *
 * Desktop: left nav (search + section list) + right scrollable column with all
 * sections stacked. An IntersectionObserver drives scrollspy so the nav always
 * reflects which section is currently in view.
 *
 * Mobile: single-column. The nav is a full-screen list; tapping any section
 * "pushes" to that section's content with a back button (iOS-style).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { useDebugStore } from "../lib/debug-store.js";
import { useSettingsStore } from "../lib/settings-store.js";
import {
  BASE_SECTION_METAS,
  UPDATES_SECTION_META,
  DANGER_SECTION_META,
  X_SECTION_META,
  type SectionId,
  type SectionMeta,
} from "../lib/settings-sections.js";
import { FeedsSection } from "./settings/FeedsSection.js";
import { SavedSection } from "./settings/SavedSection.js";
// ── Types ─────────────────────────────────────────────────────────────────────

interface Section extends SectionMeta {
  icon: ReactNode;
}

/** A nav group (e.g. "Sources") containing child sections in the left nav. */
interface NavGroup {
  kind: "group";
  label: string;
  icon: ReactNode;
  children: Section[];
}

type NavStructureItem = Section | NavGroup;

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

// ── Toggle primitive ──────────────────────────────────────────────────────────

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-[#a1a1aa]">{label}</p>
        {description && <p className="text-xs text-[#52525b] mt-0.5">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          checked ? "bg-[#8b5cf6]" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// ── Section icons ─────────────────────────────────────────────────────────────

/** Icon for the Sources nav group (not a section itself). */
const ICON_SOURCES = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const ICONS: Record<SectionId, ReactNode> = {
  reading: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  ai: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  feeds: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  ),
  saved: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  ),
  sync: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  updates: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  danger: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  x: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  ),
};

// ── Update check state ────────────────────────────────────────────────────────

type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "error" };

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const {
    SettingsExtraSections,
    XSettingsContent,
    checkForUpdates,
    applyUpdate,
    headerDragRegion,
    factoryReset,
    activeCloudProviderLabel,
  } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const toggleDebug = useDebugStore((s) => s.toggle);

  // Flat section list — drives scrollspy and right-pane rendering.
  // Keywords live in settings-sections.ts so Header's command palette can share them.
  // ── AI section is coming soon -- preserve ICONS.ai, do not delete ──
  const allSections: Section[] = [
    ...BASE_SECTION_METAS.map((m) => ({ ...m, icon: ICONS[m.id] })),
    ...(XSettingsContent ? [{ ...X_SECTION_META, icon: ICONS.x }] : []),
    ...(checkForUpdates ? [{ ...UPDATES_SECTION_META, icon: ICONS.updates }] : []),
    ...(factoryReset ? [{ ...DANGER_SECTION_META, icon: ICONS.danger }] : []),
  ];

  // Hierarchical nav structure — drives left sidebar rendering only.
  // Re-use the Section objects already defined in allSections so keywords stay in sync.
  const sectionById = Object.fromEntries(allSections.map((s) => [s.id, s])) as Record<SectionId, Section>;
  const navStructure: NavStructureItem[] = [
    sectionById.sync,
    sectionById.reading,
    {
      kind: "group",
      label: "Sources",
      icon: ICON_SOURCES,
      children: [
        sectionById.feeds,
        sectionById.saved,
        ...(XSettingsContent ? [sectionById.x] : []),
      ],
    },
    // sectionById.ai, // AI coming soon -- do not delete
    ...(checkForUpdates ? [sectionById.updates] : []),
    ...(factoryReset ? [sectionById.danger] : []),
  ];

  // ── Preferences state ────────────────────────────────────────────────────
  const [display, setDisplay] = useState(() => preferences.display);

  const handleDisplayChange = useCallback(
    (update: Partial<typeof display>) => {
      setDisplay((prev) => {
        const next = { ...prev, ...update };
        updatePreferences({ display: next });
        return next;
      });
    },
    [updatePreferences],
  );

  const handleReadingChange = useCallback(
    (update: Partial<typeof display.reading>) => {
      setDisplay((prev) => {
        const next = { ...prev, reading: { ...prev.reading, ...update } };
        updatePreferences({ display: next });
        return next;
      });
    },
    [updatePreferences],
  );

  // ── Update check ─────────────────────────────────────────────────────────
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ status: "idle" });
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCheckForUpdates = useCallback(async () => {
    if (!checkForUpdates) return;
    setUpdateState({ status: "checking" });
    try {
      const version = await checkForUpdates();
      const next: UpdateCheckState = version
        ? { status: "available", version }
        : { status: "up-to-date" };
      setUpdateState(next);
      if (next.status === "up-to-date") {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
      }
    } catch {
      setUpdateState({ status: "error" });
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
    }
  }, [checkForUpdates]);

  // ── Factory reset ─────────────────────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [deleteFromCloud, setDeleteFromCloud] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = useCallback(async () => {
    if (!factoryReset) return;
    setResetting(true);
    try {
      await factoryReset(deleteFromCloud);
    } catch {
      setResetting(false);
      setShowResetConfirm(false);
    }
  }, [factoryReset, deleteFromCloud]);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase().trim();
  const visibleSections = searchLower
    ? allSections.filter((s) =>
        s.label.toLowerCase().includes(searchLower) ||
        s.keywords.some((k) => k.includes(searchLower)),
      )
    : allSections;

  // ── Scrollspy ────────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>("sync");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep a ref in sync with updateState.status so scroll/visibility callbacks
  // always read the current value without needing to be re-created.
  const updateStatusRef = useRef(updateState.status);
  updateStatusRef.current = updateState.status;

  // Ref for the "Check for updates" button element.
  const checkButtonRef = useRef<HTMLDivElement>(null);

  // Auto-check when the button enters the scroll container's visible area.
  // Re-checks each time the button transitions from hidden → visible, so scrolling
  // away and back triggers a fresh check (once the previous check has settled).
  useEffect(() => {
    if (!open || !checkForUpdates) return;
    const root = scrollRef.current;
    if (!root) return;

    let wasVisible = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const btn = checkButtonRef.current;
        if (!btn) return;
        const rootRect = root.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const isVisible = btnRect.bottom > rootRect.top && btnRect.top < rootRect.bottom;

        if (isVisible && !wasVisible && updateStatusRef.current === "idle") {
          handleCheckForUpdates();
        }
        wasVisible = isVisible;
      }, 120);
    };

    check();
    root.addEventListener("scroll", check, { passive: true });
    return () => {
      clearTimeout(debounceTimer);
      root.removeEventListener("scroll", check);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkForUpdates]);
  // While true, IntersectionObserver updates are suppressed so intermediate
  // sections that drift through the trigger zone during a smooth-scroll
  // animation don't cause nav items to flicker.
  const isScrollingProgrammatically = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // When search is cleared, restore observer-driven active section.
  // When searching, highlight the first visible match.
  useEffect(() => {
    if (searchLower && visibleSections.length > 0) {
      setActiveSection(visibleSections[0].id);
    }
  }, [searchLower, visibleSections]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || searchLower) return;

    const intersecting = new Set<SectionId>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute("data-section") as SectionId;
          if (entry.isIntersecting) {
            intersecting.add(id);
          } else {
            intersecting.delete(id);
          }
        });

        // Suppress updates while a click-initiated scroll is animating
        if (isScrollingProgrammatically.current) return;

        // Active = topmost intersecting section in document order
        for (const section of allSections) {
          if (intersecting.has(section.id)) {
            setActiveSection(section.id);
            break;
          }
        }
      },
      {
        root,
        // Consider a section "active" when its top is within the top 20% of the pane
        rootMargin: "0px 0px -80% 0px",
        threshold: 0,
      },
    );

    root.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  // allSections identity changes on each render because it's built inline;
  // the relevant dep is the set of section IDs which only changes when
  // platform capabilities change (practically never after mount).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchLower]);

  const scrollToSection = useCallback((id: SectionId) => {
    setActiveSection(id);
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (el) {
        const container = scrollRef.current;
        const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top;

        // Lock out the observer so intermediate sections don't flicker
        isScrollingProgrammatically.current = true;
        clearTimeout(scrollEndTimerRef.current);

        const clearScrolling = () => {
          isScrollingProgrammatically.current = false;
        };
        // scrollend fires when the animation settles (Chrome/FF/Safari 17.4+)
        container.addEventListener("scrollend", clearScrolling, { once: true });
        // Timeout fallback for older Safari
        scrollEndTimerRef.current = setTimeout(clearScrolling, 800);

        container.scrollBy({ top: elTop - 16, behavior: "smooth" });
      }
    }
    // On mobile, switch to section view
    setMobileView("section");
  }, []);

  // ── Mobile nav state ──────────────────────────────────────────────────────
  const [mobileView, setMobileView] = useState<"nav" | "section">("nav");

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setMobileView("nav");
    }
  }, [open]);

  // Scroll to a programmatically requested section (e.g. nudge → Sync)
  const { targetSection, clearTarget } = useSettingsStore();
  useEffect(() => {
    if (!open || !targetSection) return;
    // Wait one frame for the DOM to be fully painted before scrolling
    const rafId = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-section="${targetSection}"]`);
      if (el && scrollRef.current) {
        scrollRef.current.scrollTop = el.offsetTop - 16;
        setActiveSection(targetSection as SectionId);
        setMobileView("section");
      }
      clearTarget();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, targetSection, clearTarget]);

  // Body scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  // ── Section content renderer ──────────────────────────────────────────────

  function SectionBlock({ id }: { id: SectionId }) {
    const isVisible = visibleSections.some((s) => s.id === id);
    if (!isVisible) return null;

    return (
      <section data-section={id} className="pb-8 min-h-full flex flex-col">
        <SectionContent id={id} />
      </section>
    );
  }

  function SectionContent({ id }: { id: SectionId }) {
    switch (id) {
      case "reading":
        return (
          <>
            <SectionHeading label="Reading" />
            <div className="space-y-5">
              <Toggle
                label="Mark read on scroll"
                checked={display.reading.markReadOnScroll}
                onChange={(v) => handleReadingChange({ markReadOnScroll: v })}
                description="Mark items as read when you scroll past them in the feed"
              />
              <Toggle
                label="Show engagement counts"
                checked={display.showEngagementCounts}
                onChange={(v) => handleDisplayChange({ showEngagementCounts: v })}
                description="Show likes, reposts, and views on posts"
              />
              <Toggle
                label="Focus mode"
                checked={display.reading.focusMode}
                onChange={(v) => handleReadingChange({ focusMode: v })}
                description="Bold word beginnings to aid reading speed"
              />
              {display.reading.focusMode && (
                <div className="space-y-2">
                  <p className="text-sm text-[#a1a1aa]">Focus intensity</p>
                  <div className="flex gap-2">
                    {(["light", "normal", "strong"] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => handleReadingChange({ focusIntensity: level })}
                        className={`flex-1 py-1.5 rounded-lg text-sm capitalize transition-colors border ${
                          display.reading.focusIntensity === level
                            ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border-[#8b5cf6]/30"
                            : "bg-white/5 text-[#71717a] hover:text-white border-transparent"
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        );

      case "x":
        return XSettingsContent ? (
          <>
            <SectionHeading label="X / Twitter" />
            <XSettingsContent />
          </>
        ) : null;

      case "ai":
        // AI section is coming soon -- AISection component is preserved, do not delete.
        return null;

      case "feeds":
        return (
          <>
            <SectionHeading label="Feeds" />
            <FeedsSection />
          </>
        );

      case "saved":
        return (
          <>
            <SectionHeading label="Saved Content" />
            <SavedSection />
          </>
        );

      case "sync":
        return (
          <div className="flex flex-col flex-1">
            <SectionHeading label="Sync" />
            {SettingsExtraSections && <SettingsExtraSections />}
          </div>
        );

      case "updates":
        return (
          <>
            <SectionHeading label="Updates" />
            <div className="space-y-3">
              <p className="text-xs text-[#52525b]">
                Current version:{" "}
                <span className="text-sm font-bold font-mono">v{__APP_VERSION__}</span>
              </p>
              {checkForUpdates && (
                <div ref={checkButtonRef} className="flex items-center gap-3">
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={updateState.status === "checking"}
                    className="text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updateState.status === "checking" ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-[#8b5cf6] border-t-transparent rounded-full animate-spin" />
                        Checking&hellip;
                      </span>
                    ) : (
                      "Check for updates"
                    )}
                  </button>
                  {updateState.status === "up-to-date" && <UpToDateBadge />}
                  {updateState.status === "available" && (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-[#8b5cf6]">Update available</span>
                      {applyUpdate && (
                        <button
                          onClick={applyUpdate}
                          className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#8b5cf6] text-white hover:bg-[#7c3aed] transition-colors"
                        >
                          {headerDragRegion ? "Install & Restart" : "Reload"}
                        </button>
                      )}
                    </span>
                  )}
                  {updateState.status === "error" && (
                    <span className="text-xs text-red-400">Check failed</span>
                  )}
                </div>
              )}
            </div>
          </>
        );

      case "danger":
        return factoryReset ? (
          <>
            <SectionHeading label="Danger Zone" danger />
            <div className="space-y-6">
              <button
                onClick={() => {
                  onClose();
                  setTimeout(toggleDebug, 150);
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
              >
                <div>
                  <p className="text-sm text-[#a1a1aa]">Open Debug Panel</p>
                  <p className="text-xs text-[#52525b] mt-0.5">Sync diagnostics, event log, document inspector</p>
                </div>
                <span className="text-[10px] font-mono text-[#52525b] shrink-0 ml-3">⌘⇧D</span>
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-colors text-left"
              >
                <div>
                  <p className="text-sm text-red-400">Reset this device</p>
                  <p className="text-xs text-red-400/50 mt-0.5">Wipes all local data and restarts fresh</p>
                </div>
                <svg className="w-4 h-4 text-red-400/40 shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        ) : null;
    }
  }

  // ── Left nav ──────────────────────────────────────────────────────────────

  /** Single nav button shared by top-level sections and group children. */
  function NavButton({
    section,
    indented = false,
  }: {
    section: Section;
    indented?: boolean;
  }) {
    const isActive = activeSection === section.id;
    const isDanger = section.id === "danger";
    return (
      <button
        onClick={() => scrollToSection(section.id)}
        className={`w-full flex items-center gap-2 text-left text-xs transition-colors rounded-md ${
          indented ? "pl-7 pr-2 py-2" : "px-2 py-2"
        } ${
          isActive
            ? "bg-[#8b5cf6]/15 text-[#8b5cf6]"
            : isDanger
            ? "text-red-400/70 hover:text-red-400 hover:bg-red-500/5"
            : "text-[#a1a1aa] hover:text-white hover:bg-white/5"
        }`}
      >
        <span className={`shrink-0 ${isActive ? "text-[#8b5cf6]" : isDanger ? "text-red-400/60" : "text-[#52525b]"}`}>
          {section.icon}
        </span>
        <span>{section.label}</span>
      </button>
    );
  }

  const NavList = () => {
    // When searching, collapse to a flat filtered list for simplicity.
    if (searchLower) {
      return (
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {visibleSections.map((section) => (
            <NavButton key={section.id} section={section} />
          ))}
        </nav>
      );
    }

    return (
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
        {navStructure.map((item) => {
          if ("kind" in item) {
            // Group header + indented children
            const isGroupActive = item.children.some((c) => c.id === activeSection);
            return (
              <div key={item.label} className="space-y-0.5">
                {/* Clicking the group header jumps to its first child section */}
                <button
                  onClick={() => scrollToSection(item.children[0].id)}
                  className={`w-full flex items-center gap-2 px-2 py-2 text-left text-xs transition-colors rounded-md ${
                    isGroupActive
                      ? "text-[#8b5cf6]"
                      : "text-[#a1a1aa] hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span className={`shrink-0 ${isGroupActive ? "text-[#8b5cf6]" : "text-[#52525b]"}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
                {item.children.map((child) => (
                  <NavButton key={child.id} section={child} indented />
                ))}
              </div>
            );
          }
          // Regular top-level section
          return <NavButton key={item.id} section={item} />;
        })}
      </nav>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`
          relative z-10 w-full bg-[#141414] overflow-hidden flex flex-col
          h-[92dvh] rounded-t-2xl
          sm:rounded-2xl sm:border sm:border-[rgba(255,255,255,0.08)] sm:shadow-2xl
          sm:flex-row sm:max-w-3xl sm:h-[80vh] sm:max-h-[700px]
        `}
      >
        {/* ── Left column ────────────────────────────────────────────────── */}
        <div
          className={`
            flex flex-col border-b border-[rgba(255,255,255,0.06)] shrink-0
            sm:w-52 sm:border-b-0 sm:border-r sm:border-[rgba(255,255,255,0.06)]
            ${mobileView === "section" ? "hidden sm:flex" : "flex"}
          `}
        >
          {/* Header */}
          <div className="pl-5 pr-3 pt-4 pb-2 shrink-0">
            <h2 className="text-base font-semibold text-white">Settings</h2>
          </div>

          {/* Search */}
          <div className="px-3 pt-2 pb-2 shrink-0">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#52525b] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings"
                className={`w-full pl-8 py-1.5 bg-white/[0.05] border border-[rgba(255,255,255,0.06)] rounded-lg text-sm text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/40 transition-colors ${search ? "pr-7" : "pr-3"}`}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-[#71717a] hover:text-white transition-colors"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <NavList />

          {/* Footer — desktop sidebar only */}
          <div className="hidden sm:flex items-center justify-between px-4 py-3 shrink-0 border-t border-[rgba(255,255,255,0.05)]">
            {checkForUpdates ? (
              <button
                onClick={() => {
                  setSearch("");
                  scrollToSection("updates");
                }}
                className="text-xs font-mono text-[#52525b] hover:text-[#a1a1aa] transition-colors tabular-nums"
              >
                v{__APP_VERSION__}
              </button>
            ) : (
              <span className="text-xs font-mono text-[#52525b] tabular-nums">
                v{__APP_VERSION__}
              </span>
            )}
            <a
              href="https://freed.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#52525b] hover:text-[#8b5cf6] transition-colors"
            >
              freed.wtf
            </a>
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div
          className={`
            flex-1 flex flex-col overflow-hidden
            ${mobileView === "nav" ? "hidden sm:flex" : "flex"}
          `}
        >
          {/* Mobile back button + section title */}
          <div className="sm:hidden flex items-center gap-2 px-4 pt-5 pb-3 shrink-0 border-b border-[rgba(255,255,255,0.06)]">
            <button
              onClick={() => setMobileView("nav")}
              className="p-1.5 -ml-1 rounded-lg hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors"
              aria-label="Back to settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-white">
              {allSections.find((s) => s.id === activeSection)?.label}
            </span>
          </div>

          {/* Scrollable sections */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 pt-6 [&>section+section]:mt-14"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {searchLower && visibleSections.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 pb-16 text-center">
                <svg className="w-8 h-8 text-[#3f3f46]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm text-[#52525b]">No settings match <span className="text-[#71717a]">"{search}"</span></p>
              </div>
            ) : (
              allSections.map((section) => SectionBlock({ id: section.id }))
            )}

            {/* Footer — mobile + narrow screens */}
            <div className="sm:hidden text-center pb-4">
              <a
                href="https://freed.wtf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#52525b] hover:text-[#8b5cf6] transition-colors"
              >
                freed.wtf
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Factory reset confirmation overlay */}
      {showResetConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#18181b] border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Reset this device?</p>
                <p className="text-xs text-[#71717a] mt-0.5">
                  Clears all local data on this device only.
                  {!deleteFromCloud && " Cloud sync will re-download your data on next launch."}
                </p>
              </div>
            </div>

            {activeCloudProviderLabel?.() && (
              <label className="flex items-start gap-3 mb-5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteFromCloud}
                  onChange={(e) => setDeleteFromCloud(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm text-[#a1a1aa] group-hover:text-white transition-colors">
                    Also delete from {activeCloudProviderLabel()}
                  </p>
                  <p className="text-xs text-[#52525b] mt-0.5">Permanently removes your cloud backup</p>
                </div>
              </label>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowResetConfirm(false); setDeleteFromCloud(false); }}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {resetting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    Resetting&hellip;
                  </span>
                ) : (
                  "Reset Device"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Up-to-date badge ──────────────────────────────────────────────────────────

function UpToDateBadge() {
  return (
    <>
      <style>{`
        @keyframes _utd-badge-in {
          from { opacity: 0; transform: translateY(3px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0)  scale(1);    }
        }
        @keyframes _utd-ring {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(2);   opacity: 0;   }
        }
        @keyframes _utd-check {
          from { stroke-dashoffset: 22; }
          to   { stroke-dashoffset: 0;  }
        }
        ._utd-badge { animation: _utd-badge-in 0.28s cubic-bezier(0.34,1.56,0.64,1) both; }
        ._utd-ring  { animation: _utd-ring  0.55s ease-out 0.08s both; }
        ._utd-check { animation: _utd-check 0.38s ease-out 0.18s both;
                      stroke-dasharray: 22; stroke-dashoffset: 22; }
      `}</style>
      <span className="_utd-badge flex items-center gap-2">
        <span className="relative flex items-center justify-center w-[18px] h-[18px] shrink-0">
          {/* Ripple ring */}
          <span className="_utd-ring absolute inset-0 rounded-full bg-green-400/25" />
          {/* Circle + animated check */}
          <svg viewBox="0 0 18 18" fill="none" className="w-[18px] h-[18px]">
            <circle cx="9" cy="9" r="8" stroke="rgb(74 222 128 / 0.35)" strokeWidth="1.5" />
            <path
              d="M5.5 9l2.5 2.5 4.5-5"
              stroke="rgb(74 222 128)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="_utd-check"
            />
          </svg>
        </span>
        <span className="text-xs text-green-400">You're up to date</span>
      </span>
    </>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <h3
      className={`text-sm font-semibold uppercase tracking-wide mb-5 ${
        danger ? "text-red-400/60" : "text-[#71717a]"
      }`}
    >
      {label}
    </h3>
  );
}
