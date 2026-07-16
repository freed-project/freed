import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Sidebar } from "./Sidebar.js";
import { Header } from "./Header.js";
import { DebugPanel } from "../DebugPanel.js";
import { toast } from "../Toast.js";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { LibraryDialog } from "../LibraryDialog.js";
import { addDebugEvent, useDebugStore } from "../../lib/debug-store.js";
import { useAppStore } from "../../context/PlatformContext.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { ContactSyncModal } from "../friends/ContactSyncModal.js";
import { useContactSync } from "../../hooks/useContactSync.js";
import { ContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import {
  buildProvisionalPersonCandidates,
  buildDiscoveredAccountsFromItems,
  isPrunableInvalidDiscoveredSocialAccount,
  provisionalPersonRepairSignature,
  type GoogleContact,
  type IdentitySuggestion,
  type SidebarMode,
} from "@freed/shared";
import {
  buildSocialAccountsFromAuthorIds,
  createContactAccountFromGoogleContact,
} from "@freed/shared/google-contacts-automation";
import { applyThemeToDocument, persistTheme } from "../../lib/theme.js";
import {
  applyAnimationIntensityToDocument,
  resolveAnimationIntensity,
} from "../../lib/animation-preferences.js";
import { applyInterfaceZoomToDocument } from "../../lib/interface-zoom.js";
import {
  useDeviceDisplayPreferences,
} from "../../lib/device-display-preferences.js";
import { MapView } from "../map/MapView.js";
import { BackgroundAtmosphere } from "./BackgroundAtmosphere.js";
import {
  AUXILIARY_DRAWER_GAP_WIDTH_PX,
} from "./layoutConstants.js";

const DEFAULT_DEBUG_WIDTH = 320;
const MIN_DEBUG_WIDTH = 280;
const MAX_DEBUG_WIDTH = 600;
const LazyFriendsView = lazy(() =>
  import("../friends/FriendsView.js").then((module) => ({ default: module.FriendsView })),
);

interface AppShellProps {
  children: ReactNode;
}

type FriendsMobileSurface = "graph" | "details";

type CanvasViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const EMPTY_CANVAS_VIEWPORT_INSETS: CanvasViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function roundInset(value: number): number {
  return Math.max(0, Math.round(value));
}

function sameCanvasViewportInsets(
  left: CanvasViewportInsets,
  right: CanvasViewportInsets,
): boolean {
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left
  );
}

export function AppShell({ children }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [friendsMobileSurface, setFriendsMobileSurface] =
    useState<FriendsMobileSurface>("graph");
  const isMobileViewport = useIsMobile();
  const isMobileDevice = useIsMobileDevice();
  const debugVisible = useDebugStore((s) => s.visible);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const items = useAppStore((s) => s.items);
  const accounts = useAppStore((s) => s.accounts);
  const persons = useAppStore((s) => s.persons);
  const addPerson = useAppStore((s) => s.addPerson);
  const addAccounts = useAppStore((s) => s.addAccounts);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const createConnectionPersonsFromCandidates = useAppStore((s) => s.createConnectionPersonsFromCandidates);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const themeId = useAppStore((s) => s.preferences.display.themeId);
  const animationIntensity = useAppStore((s) =>
    resolveAnimationIntensity(s.preferences.display.animationIntensity),
  );
  const showAtmosphere = activeView !== "friends" && activeView !== "map";
  const settingsOpen = useSettingsStore((s) => s.open);
  const openSettingsTo = useSettingsStore((s) => s.openTo);
  const requestSearchPalette = useCommandSurfaceStore((s) => s.requestSearchPalette);
  const addFeedOpen = useCommandSurfaceStore((s) => s.addFeedOpen);
  const closeAddFeedDialog = useCommandSurfaceStore((s) => s.closeAddFeedDialog);
  const savedContentOpen = useCommandSurfaceStore((s) => s.savedContentOpen);
  const savedContentInitialUrl = useCommandSurfaceStore((s) => s.savedContentInitialUrl);
  const openSavedContentDialog = useCommandSurfaceStore((s) => s.openSavedContentDialog);
  const closeSavedContentDialog = useCommandSurfaceStore((s) => s.closeSavedContentDialog);
  const [savedContentError, setSavedContentError] = useState("");
  const libraryDialogOpen = useCommandSurfaceStore((s) => s.libraryDialogOpen);
  const libraryDialogTab = useCommandSurfaceStore((s) => s.libraryDialogTab);
  const closeLibraryDialog = useCommandSurfaceStore((s) => s.closeLibraryDialog);

  // Mount the contact sync hook here (not in FriendsView) so the 15-minute
  // interval and focus listener run regardless of which view is active.
  const contactSync = useContactSync();
  const [showContactReview, setShowContactReview] = useState(false);
  const [deviceDisplay, setDeviceDisplay] = useDeviceDisplayPreferences();
  const persistedDebugWidth = deviceDisplay.debugPanelWidth ?? DEFAULT_DEBUG_WIDTH;
  const persistedDesktopSidebarMode = deviceDisplay.sidebarMode;
  const friendsSidebarOpen = deviceDisplay.friendsSidebarOpen;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedDebugWidth, setCommittedDebugWidth] = useState(persistedDebugWidth);
  const [desktopSidebarMode, setDesktopSidebarMode] = useState<SidebarMode>(persistedDesktopSidebarMode);
  const contentFrameRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [mapViewportInsets, setMapViewportInsets] = useState<CanvasViewportInsets>(EMPTY_CANVAS_VIEWPORT_INSETS);
  const usesFullCanvasFrame = activeView === "friends";
  const contentFrameSpacingClass = usesFullCanvasFrame
      ? desktopSidebarMode === "closed"
        ? ""
        : "pl-[var(--feed-card-gap,8px)]"
      : "px-[var(--feed-card-gap,8px)] pb-[var(--feed-card-gap,8px)]";
  const [desktopSidebarDisplayMode, setDesktopSidebarDisplayMode] = useState<SidebarMode>(persistedDesktopSidebarMode);
  const dragging = useRef(false);
  const lastNonClosedDesktopSidebarModeRef = useRef<SidebarMode>(
    persistedDesktopSidebarMode === "closed" ? "expanded" : persistedDesktopSidebarMode,
  );
  const discoveredAccountScanRef = useRef({ itemCount: 0, accountCount: 0 });
  const provisionalPersonScanRef = useRef("");
  const invalidAccountCleanupRef = useRef("");
  const blockingModalOpen =
    settingsOpen ||
    addFeedOpen ||
    savedContentOpen ||
    libraryDialogOpen ||
    showContactReview;

  useEffect(() => {
    if (activeView !== "storyWall") return;
    setActiveView("feed");
    openSettingsTo("storyWall");
  }, [activeView, openSettingsTo, setActiveView]);

  useEffect(() => {
    const handleOpenSavedContent = (event: Event) => {
      const detail = (event as CustomEvent<{ initialUrl?: string; errorMessage?: string }>).detail;
      setSavedContentError(detail?.errorMessage ?? "");
      openSavedContentDialog(detail?.initialUrl);
    };
    const handleSaveDetailsError = (event: Event) => {
      const detail = (event as CustomEvent<{ initialUrl?: string; errorMessage?: string }>).detail;
      setSavedContentError(detail?.errorMessage ?? "Freed could not save details for this URL.");
      openSavedContentDialog(detail?.initialUrl);
    };

    window.addEventListener("freed:open-save-content-dialog", handleOpenSavedContent);
    window.addEventListener("freed:save-content-details-error", handleSaveDetailsError);
    return () => {
      window.removeEventListener("freed:open-save-content-dialog", handleOpenSavedContent);
      window.removeEventListener("freed:save-content-details-error", handleSaveDetailsError);
    };
  }, [openSavedContentDialog]);

  const handleCloseSavedContentDialog = useCallback(() => {
    setSavedContentError("");
    closeSavedContentDialog();
  }, [closeSavedContentDialog]);

  const forceCompactDesktopSidebar = !isMobileDevice && isMobileViewport;
  const effectiveDesktopSidebarDisplayMode =
    forceCompactDesktopSidebar && desktopSidebarMode !== "closed"
      ? "compact"
      : desktopSidebarDisplayMode;
  const desktopSidebarToggleMode =
    forceCompactDesktopSidebar && desktopSidebarMode !== "closed"
      ? "compact"
      : desktopSidebarMode;

  useEffect(() => {
    if (dragging.current || dragWidth !== null) return;
    setCommittedDebugWidth(persistedDebugWidth);
  }, [dragWidth, persistedDebugWidth]);

  useEffect(() => {
    setDesktopSidebarMode(persistedDesktopSidebarMode);
    setDesktopSidebarDisplayMode(persistedDesktopSidebarMode);
    if (persistedDesktopSidebarMode !== "closed") {
      lastNonClosedDesktopSidebarModeRef.current = persistedDesktopSidebarMode;
    }
  }, [persistedDesktopSidebarMode]);

  const debugWidth = dragWidth ?? committedDebugWidth;
  const mapViewportInsetStyle = {
    "--freed-canvas-viewport-inset-top": `${mapViewportInsets.top}px`,
    "--freed-canvas-viewport-inset-right": `${mapViewportInsets.right}px`,
    "--freed-canvas-viewport-inset-bottom": `${mapViewportInsets.bottom}px`,
    "--freed-canvas-viewport-inset-left": `${mapViewportInsets.left}px`,
  } as CSSProperties;

  useLayoutEffect(() => {
    if (activeView !== "map") {
      setMapViewportInsets((current) =>
        sameCanvasViewportInsets(current, EMPTY_CANVAS_VIEWPORT_INSETS)
          ? current
          : EMPTY_CANVAS_VIEWPORT_INSETS,
      );
      return;
    }

    const contentFrame = contentFrameRef.current;
    const main = mainRef.current;
    if (!contentFrame || !main) return;

    let frame = 0;
    const updateInsets = () => {
      frame = 0;
      const frameRect = contentFrame.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const next = {
        top: roundInset(mainRect.top - frameRect.top),
        right: roundInset(frameRect.right - mainRect.right),
        bottom: roundInset(frameRect.bottom - mainRect.bottom),
        left: roundInset(mainRect.left - frameRect.left),
      };
      setMapViewportInsets((current) =>
        sameCanvasViewportInsets(current, next) ? current : next,
      );
    };

    const scheduleUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(updateInsets);
    };

    updateInsets();
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(contentFrame);
    observer.observe(main);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [activeView, debugVisible, debugWidth, desktopSidebarMode, effectiveDesktopSidebarDisplayMode, isMobileDevice]);

  const persistDesktopSidebarMode = useCallback((nextMode: SidebarMode) => {
    if (!setDeviceDisplay({ sidebarMode: nextMode })) {
      toast.error("Freed could not save the sidebar layout on this device.");
      return;
    }
    setDesktopSidebarMode(nextMode);
    setDesktopSidebarDisplayMode(nextMode);
    if (nextMode !== "closed") {
      lastNonClosedDesktopSidebarModeRef.current = nextMode;
    }
  }, [setDeviceDisplay]);

  const handleDesktopSidebarToggle = useCallback(() => {
    const nextMode = desktopSidebarToggleMode === "closed"
      ? "expanded"
      : desktopSidebarToggleMode === "compact"
        ? "closed"
        : "compact";
    persistDesktopSidebarMode(nextMode);
  }, [desktopSidebarToggleMode, persistDesktopSidebarMode]);

  const handleFriendsSidebarOpenChange = useCallback((open: boolean) => {
    if (!setDeviceDisplay({ friendsSidebarOpen: open })) {
      toast.error("Freed could not save the sidebar layout on this device.");
    }
  }, [setDeviceDisplay]);

  const handleDebugDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = debugWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Panel is on the right; dragging left increases width
        const next = Math.min(MAX_DEBUG_WIDTH, Math.max(MIN_DEBUG_WIDTH, startW - (ev.clientX - startX)));
        setDragWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        dragging.current = false;
        const final = Math.min(MAX_DEBUG_WIDTH, Math.max(MIN_DEBUG_WIDTH, startW - (ev.clientX - startX)));
        if (setDeviceDisplay({ debugPanelWidth: final })) {
          setCommittedDebugWidth(final);
        } else {
          setCommittedDebugWidth(persistedDebugWidth);
          toast.error("Freed could not save the panel width on this device.");
        }
        setDragWidth(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [debugWidth, persistedDebugWidth, setDeviceDisplay],
  );

  // Keyboard shortcuts: Cmd/Ctrl+Shift+D to toggle, Escape to close
  useLayoutEffect(() => {
    applyInterfaceZoomToDocument();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    applyThemeToDocument(themeId);
    persistTheme(themeId);
  }, [isInitialized, themeId]);

  useEffect(() => {
    if (!isInitialized) return;
    applyAnimationIntensityToDocument(animationIntensity);
  }, [animationIntensity, isInitialized]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (blockingModalOpen) return;
        requestSearchPalette();
      } else if (e.key === "D" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleDebug();
      } else if (e.key === "Escape" && debugVisible) {
        toggleDebug();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [blockingModalOpen, debugVisible, requestSearchPalette, toggleDebug]);

  useEffect(() => {
    if (!isMobileDevice && mobileSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  }, [isMobileDevice, mobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileDevice || !mobileSidebarOpen) return;

    document.documentElement.classList.add("freed-mobile-sidebar-open");
    return () => {
      document.documentElement.classList.remove("freed-mobile-sidebar-open");
    };
  }, [isMobileDevice, mobileSidebarOpen]);

  useEffect(() => {
    if (activeView === "friends" && isMobileViewport) return;
    setFriendsMobileSurface("graph");
  }, [activeView, isMobileViewport]);

  useEffect(() => {
    if (!isInitialized) return;
    const prunableAccounts = Object.values(accounts).filter(isPrunableInvalidDiscoveredSocialAccount);
    if (prunableAccounts.length === 0) return;
    const cleanupSignature = prunableAccounts.map((account) => account.id).sort().join("|");
    if (cleanupSignature === invalidAccountCleanupRef.current) return;
    invalidAccountCleanupRef.current = cleanupSignature;
    void Promise.all(prunableAccounts.map((account) => removeAccount(account.id)))
      .then(() => {
        invalidAccountCleanupRef.current = "";
        addDebugEvent(
          "change",
          `[Identity] removed ${prunableAccounts.length.toLocaleString()} invalid Facebook account${prunableAccounts.length === 1 ? "" : "s"}`,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        addDebugEvent("error", `[Identity] invalid Facebook account cleanup failed: ${message}`);
        invalidAccountCleanupRef.current = "";
      });
  }, [accounts, isInitialized, removeAccount]);

  useEffect(() => {
    const itemCount = items.length;
    const accountCount = Object.keys(accounts).length;
    const previous = discoveredAccountScanRef.current;
    if (itemCount === previous.itemCount && accountCount === previous.accountCount) {
      return;
    }
    discoveredAccountScanRef.current = { itemCount, accountCount };
    const missingAccounts = buildDiscoveredAccountsFromItems(items, accounts);
    if (missingAccounts.length === 0) return;
    void addAccounts(missingAccounts);
  }, [accounts, addAccounts, items]);

  useEffect(() => {
    if (!isInitialized) return;
    const signature = provisionalPersonRepairSignature(persons, accounts);
    if (signature === provisionalPersonScanRef.current) return;
    provisionalPersonScanRef.current = signature;
    const candidates = buildProvisionalPersonCandidates(persons, accounts);
    if (candidates.length === 0) return;
    void createConnectionPersonsFromCandidates(candidates).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      addDebugEvent("error", `[Identity] provisional person repair failed: ${message}`);
    });
  }, [accounts, createConnectionPersonsFromCandidates, isInitialized, persons]);

  const handleLinkSuggestion = useCallback(async (suggestion: IdentitySuggestion) => {
    const match = contactSync.getMatchForSuggestion(suggestion.id);
    if (!match) return;

    const now = Date.now();
    const personId = match.person?.id ?? crypto.randomUUID();
    const person = match.person ?? {
      id: personId,
      name: match.contact.name.displayName ?? match.contact.name.givenName ?? "Unknown",
      relationshipStatus: "friend" as const,
      careLevel: 3 as const,
      createdAt: now,
      updatedAt: now,
    };

    if (!match.person) {
      await addPerson(person);
    }

    const contactAccount = createContactAccountFromGoogleContact(match.contact, now, personId);
    const socialAccounts = buildSocialAccountsFromAuthorIds(items, match.authorIds, now, personId);
    const mergedAccounts = [
      contactAccount,
      ...socialAccounts.filter((account) => !accounts[account.id]),
    ];
    if (mergedAccounts.length > 0) {
      await addAccounts(mergedAccounts);
    }

    contactSync.dismissSuggestion(suggestion.id);
  }, [accounts, addAccounts, addPerson, contactSync, items]);

  const handleCreateFriend = useCallback(async (contact: GoogleContact) => {
    const now = Date.now();
    const personId = crypto.randomUUID();
    await addPerson({
      id: personId,
      name: contact.name.displayName ?? contact.name.givenName ?? "",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    });
    await addAccounts([
      createContactAccountFromGoogleContact(contact, now, personId),
    ]);
  }, [addAccounts, addPerson]);

  const openReview = useCallback(async () => {
    const result = await contactSync.syncNow();
    const shouldOpen =
      result.authStatus === "connected" ||
      result.pendingSuggestions.length > 0 ||
      result.cachedContacts.length > 0;
    setShowContactReview(shouldOpen);
  }, [contactSync]);

  return (
    <ContactSyncContext.Provider value={{ ...contactSync, openReview }}>
      {/* On actual mobile devices, the layout flows naturally in the document so
          Safari can collapse its address bar when the feed scrolls. Desktop devices
          keep the fixed-height shell even when the viewport is narrow. */}
      <div className={`app-theme-shell relative flex min-w-0 flex-1 flex-col ${isMobileDevice ? "" : "min-h-0"}`}>
        {showAtmosphere ? <BackgroundAtmosphere /> : null}
        <Header
          mobileSidebarOpen={mobileSidebarOpen}
          onMobileMenuToggle={() => setMobileSidebarOpen((value) => !value)}
          desktopSidebarMode={desktopSidebarMode}
          desktopSidebarDisplayMode={effectiveDesktopSidebarDisplayMode}
          onDesktopSidebarToggle={handleDesktopSidebarToggle}
          friendsSidebarOpen={friendsSidebarOpen}
          onFriendsSidebarToggle={() =>
            handleFriendsSidebarOpenChange(!friendsSidebarOpen)
          }
          friendsMobileSurface={friendsMobileSurface}
          onFriendsMobileSurfaceChange={setFriendsMobileSurface}
        />

        <div
          ref={contentFrameRef}
          className={`relative z-10 flex flex-1 ${contentFrameSpacingClass} ${
            isMobileDevice ? "" : "min-h-0 overflow-hidden"
          }`}
        >
          {activeView === "map" ? (
            <div
              className="absolute inset-0 z-0"
              data-testid="map-background-layer"
              style={mapViewportInsetStyle}
            >
              <MapView viewportInsets={mapViewportInsets} />
            </div>
          ) : null}
          <div className="relative z-10 flex flex-none">
            <Sidebar
              mobileOpen={mobileSidebarOpen}
              onMobileClose={() => setMobileSidebarOpen(false)}
              desktopMode={desktopSidebarMode}
              onDesktopModeChange={persistDesktopSidebarMode}
              onDesktopDisplayModeChange={setDesktopSidebarDisplayMode}
              desktopGapWidthPx={usesFullCanvasFrame ? 0 : undefined}
            />
          </div>
          <main
            ref={mainRef}
            className={`relative min-w-0 flex-1 ${activeView === "friends" ? "z-0" : "z-10"} ${activeView === "map" ? "pointer-events-none" : ""} ${
              isMobileDevice ? "" : activeView === "friends" ? "min-h-0 overflow-visible" : "min-h-0 overflow-hidden"
            }`}
          >
            {activeView === "friends"
              ? (
                <Suspense fallback={<div className="h-full min-h-0" data-testid="friends-view-loading" />}>
                  <LazyFriendsView
                    friendsSidebarOpen={friendsSidebarOpen}
                    onFriendsSidebarOpenChange={handleFriendsSidebarOpenChange}
                    mobileSurface={friendsMobileSurface}
                  />
                </Suspense>
              )
              : activeView === "map"
                ? null
                : children}
          </main>

          <div
            data-testid="debug-panel-drawer"
            className="relative z-10 hidden sm:flex flex-none overflow-hidden"
            style={{
              width: debugVisible ? debugWidth + AUXILIARY_DRAWER_GAP_WIDTH_PX : 0,
              opacity: debugVisible ? 1 : 0,
              transition: dragging.current || animationIntensity === "none"
                ? "none"
                : animationIntensity === "light"
                  ? "width 140ms ease-out, opacity 120ms ease-out"
                  : "width 300ms ease-in-out, opacity 180ms ease-in-out",
            }}
          >
            <div className="relative flex h-full w-full items-stretch">
              {debugVisible && (
                <div
                  data-testid="debug-panel-resize-handle"
                  className="theme-resize-gap-handle w-3 shrink-0 self-end"
                  style={{ height: "calc(100% - var(--feed-card-gap, 8px))" }}
                  onMouseDown={handleDebugDragStart}
                />
              )}
              <DebugPanel variant="drawer" />
            </div>
          </div>
        </div>
        {debugVisible && isMobileViewport && (
          <div className="sm:hidden">
            <DebugPanel variant="overlay" />
          </div>
        )}
        <AddFeedDialog open={addFeedOpen} onClose={closeAddFeedDialog} />
        <SavedContentDialog
          open={savedContentOpen}
          initialUrl={savedContentInitialUrl}
          initialError={savedContentError}
          onClose={handleCloseSavedContentDialog}
        />
        {libraryDialogOpen ? (
          <LibraryDialog
            onClose={closeLibraryDialog}
            initialTab={libraryDialogTab}
          />
        ) : null}

        {showContactReview && (
          <ContactSyncModal
            onClose={() => setShowContactReview(false)}
            syncState={contactSync.syncState}
            onLinkSuggestion={handleLinkSuggestion}
            onSkipSuggestion={contactSync.dismissSuggestion}
            onCreateFriend={handleCreateFriend}
          />
        )}
      </div>
    </ContactSyncContext.Provider>
  );
}
