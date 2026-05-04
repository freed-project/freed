import { useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { Header } from "./Header.js";
import { DebugPanel } from "../DebugPanel.js";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { LibraryDialog } from "../LibraryDialog.js";
import { addDebugEvent, useDebugStore } from "../../lib/debug-store.js";
import { useAppStore } from "../../context/PlatformContext.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import { FriendsView } from "../friends/FriendsView.js";
import { ContactSyncModal } from "../friends/ContactSyncModal.js";
import { useContactSync } from "../../hooks/useContactSync.js";
import { ContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import {
  buildProvisionalPersonCandidates,
  buildDiscoveredAccountsFromItems,
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
import { MapView } from "../map/MapView.js";
import { BackgroundAtmosphere } from "./BackgroundAtmosphere.js";
import {
  AUXILIARY_DRAWER_GAP_WIDTH_PX,
} from "./layoutConstants.js";

const DEFAULT_DEBUG_WIDTH = 320;
const MIN_DEBUG_WIDTH = 280;
const MAX_DEBUG_WIDTH = 600;

interface AppShellProps {
  children: ReactNode;
}

type FriendsMobileSurface = "graph" | "details";

export function AppShell({ children }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [friendsMobileSurface, setFriendsMobileSurface] =
    useState<FriendsMobileSurface>("graph");
  const isMobileViewport = useIsMobile();
  const isMobileDevice = useIsMobileDevice();
  const debugVisible = useDebugStore((s) => s.visible);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const activeView = useAppStore((s) => s.activeView);
  const items = useAppStore((s) => s.items);
  const accounts = useAppStore((s) => s.accounts);
  const persons = useAppStore((s) => s.persons);
  const addPerson = useAppStore((s) => s.addPerson);
  const addAccounts = useAppStore((s) => s.addAccounts);
  const createConnectionPersonsFromCandidates = useAppStore((s) => s.createConnectionPersonsFromCandidates);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const themeId = useAppStore((s) => s.preferences.display.themeId);
  const animationIntensity = useAppStore((s) =>
    resolveAnimationIntensity(s.preferences.display.animationIntensity),
  );
  const showAtmosphere = activeView !== "friends" && activeView !== "map";
  const settingsOpen = useSettingsStore((s) => s.open);
  const requestSearchPalette = useCommandSurfaceStore((s) => s.requestSearchPalette);
  const addFeedOpen = useCommandSurfaceStore((s) => s.addFeedOpen);
  const closeAddFeedDialog = useCommandSurfaceStore((s) => s.closeAddFeedDialog);
  const savedContentOpen = useCommandSurfaceStore((s) => s.savedContentOpen);
  const closeSavedContentDialog = useCommandSurfaceStore((s) => s.closeSavedContentDialog);
  const libraryDialogOpen = useCommandSurfaceStore((s) => s.libraryDialogOpen);
  const libraryDialogTab = useCommandSurfaceStore((s) => s.libraryDialogTab);
  const closeLibraryDialog = useCommandSurfaceStore((s) => s.closeLibraryDialog);

  // Mount the contact sync hook here (not in FriendsView) so the 15-minute
  // interval and focus listener run regardless of which view is active.
  const contactSync = useContactSync();
  const [showContactReview, setShowContactReview] = useState(false);
  const persistedDebugWidth =
    useAppStore((s) => s.preferences.display.debugPanelWidth) ?? DEFAULT_DEBUG_WIDTH;
  const persistedDesktopSidebarMode =
    useAppStore((s) => s.preferences.display.sidebarMode) ?? "expanded";
  const friendsSidebarOpen =
    useAppStore((s) => s.preferences.display.friendsSidebarOpen) ?? true;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedDebugWidth, setCommittedDebugWidth] = useState(persistedDebugWidth);
  const [desktopSidebarMode, setDesktopSidebarMode] = useState<SidebarMode>(persistedDesktopSidebarMode);
  const [desktopSidebarDisplayMode, setDesktopSidebarDisplayMode] = useState<SidebarMode>(persistedDesktopSidebarMode);
  const dragging = useRef(false);
  const pendingPersistedDebugWidth = useRef<number | null>(null);
  const pendingPersistedDesktopSidebarMode = useRef<SidebarMode | null>(null);
  const lastNonClosedDesktopSidebarModeRef = useRef<SidebarMode>(
    persistedDesktopSidebarMode === "closed" ? "expanded" : persistedDesktopSidebarMode,
  );
  const discoveredAccountScanRef = useRef({ itemCount: 0, accountCount: 0 });
  const provisionalPersonScanRef = useRef({ personCount: 0, accountCount: 0 });
  const blockingModalOpen =
    settingsOpen ||
    addFeedOpen ||
    savedContentOpen ||
    libraryDialogOpen ||
    showContactReview;
  const forceCompactDesktopSidebar = !isMobileDevice && isMobileViewport;
  const effectiveDesktopSidebarDisplayMode =
    forceCompactDesktopSidebar && desktopSidebarMode !== "closed"
      ? "compact"
      : desktopSidebarDisplayMode;

  useEffect(() => {
    if (dragging.current || dragWidth !== null) return;
    if (pendingPersistedDebugWidth.current !== null) {
      if (persistedDebugWidth !== pendingPersistedDebugWidth.current) return;
      pendingPersistedDebugWidth.current = null;
    }
    setCommittedDebugWidth(persistedDebugWidth);
  }, [dragWidth, persistedDebugWidth]);

  useEffect(() => {
    if (pendingPersistedDesktopSidebarMode.current !== null) {
      if (persistedDesktopSidebarMode !== pendingPersistedDesktopSidebarMode.current) {
        return;
      }
      pendingPersistedDesktopSidebarMode.current = null;
    }
    setDesktopSidebarMode(persistedDesktopSidebarMode);
    setDesktopSidebarDisplayMode(persistedDesktopSidebarMode);
    if (persistedDesktopSidebarMode !== "closed") {
      lastNonClosedDesktopSidebarModeRef.current = persistedDesktopSidebarMode;
    }
  }, [persistedDesktopSidebarMode]);

  const debugWidth = dragWidth ?? committedDebugWidth;

  const persistDesktopSidebarMode = useCallback((nextMode: SidebarMode) => {
    setDesktopSidebarMode(nextMode);
    if (nextMode !== "closed") {
      lastNonClosedDesktopSidebarModeRef.current = nextMode;
    }
    pendingPersistedDesktopSidebarMode.current = nextMode;
    void updatePreferences({ display: { sidebarMode: nextMode } } as Parameters<typeof updatePreferences>[0]).catch(() => {
      if (pendingPersistedDesktopSidebarMode.current === nextMode) {
        pendingPersistedDesktopSidebarMode.current = null;
      }
    });
  }, [updatePreferences]);

  const handleDesktopSidebarToggle = useCallback(() => {
    const nextMode = effectiveDesktopSidebarDisplayMode === "closed"
      ? "expanded"
      : effectiveDesktopSidebarDisplayMode === "compact"
        ? "closed"
        : "compact";
    persistDesktopSidebarMode(nextMode);
  }, [effectiveDesktopSidebarDisplayMode, persistDesktopSidebarMode]);

  const handleFriendsSidebarOpenChange = useCallback((open: boolean) => {
    void updatePreferences({
      display: {
        friendsSidebarOpen: open,
      },
    } as Parameters<typeof updatePreferences>[0]);
  }, [updatePreferences]);

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
        pendingPersistedDebugWidth.current = final;
        setCommittedDebugWidth(final);
        setDragWidth(null);
        void updatePreferences({ display: { debugPanelWidth: final } } as Parameters<typeof updatePreferences>[0]).catch(() => {
          if (pendingPersistedDebugWidth.current === final) {
            pendingPersistedDebugWidth.current = null;
          }
        });
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [debugWidth, updatePreferences],
  );

  // Keyboard shortcuts: Cmd/Ctrl+Shift+D to toggle, Escape to close
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
    const personCount = Object.keys(persons).length;
    const accountCount = Object.keys(accounts).length;
    const previous = provisionalPersonScanRef.current;
    if (personCount === previous.personCount && accountCount === previous.accountCount) {
      return;
    }
    provisionalPersonScanRef.current = { personCount, accountCount };
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
          className={`relative z-10 flex flex-1 px-[var(--feed-card-gap,8px)] pb-[var(--feed-card-gap,8px)] ${
            isMobileDevice ? "" : "min-h-0 overflow-hidden"
          }`}
        >
          <Sidebar
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
            onMobileToggle={() => setMobileSidebarOpen((value) => !value)}
            desktopMode={desktopSidebarMode}
            onDesktopModeChange={persistDesktopSidebarMode}
            onDesktopDisplayModeChange={setDesktopSidebarDisplayMode}
          />
          <main
            className={`min-w-0 flex-1 ${isMobileDevice ? "" : "min-h-0 overflow-hidden"}`}
          >
            {activeView === "friends"
              ? (
                <FriendsView
                  friendsSidebarOpen={friendsSidebarOpen}
                  onFriendsSidebarOpenChange={handleFriendsSidebarOpenChange}
                  mobileSurface={friendsMobileSurface}
                />
              )
              : activeView === "map"
                ? <MapView />
                : children}
          </main>

          <div
            data-testid="debug-panel-drawer"
            className="relative hidden sm:flex flex-none overflow-hidden"
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
        <SavedContentDialog open={savedContentOpen} onClose={closeSavedContentDialog} />
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
