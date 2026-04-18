import { useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { Header } from "./Header.js";
import { DebugPanel } from "../DebugPanel.js";
import { useDebugStore } from "../../lib/debug-store.js";
import { useAppStore } from "../../context/PlatformContext.js";
import { FriendsView } from "../friends/FriendsView.js";
import { ContactSyncModal } from "../friends/ContactSyncModal.js";
import { useContactSync } from "../../hooks/useContactSync.js";
import { ContactSyncContext } from "../../context/ContactSyncContext.js";
import { buildDiscoveredAccountsFromItems, type GoogleContact, type IdentitySuggestion } from "@freed/shared";
import {
  buildSocialAccountsFromAuthorIds,
  createContactAccountFromGoogleContact,
} from "@freed/shared/google-contacts-automation";
import { applyThemeToDocument, persistTheme } from "../../lib/theme.js";
import { MapView } from "../map/MapView.js";
import { BackgroundAtmosphere } from "./BackgroundAtmosphere.js";

const DEFAULT_DEBUG_WIDTH = 320;
const MIN_DEBUG_WIDTH = 280;
const MAX_DEBUG_WIDTH = 600;

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);
  const debugVisible = useDebugStore((s) => s.visible);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const activeView = useAppStore((s) => s.activeView);
  const items = useAppStore((s) => s.items);
  const accounts = useAppStore((s) => s.accounts);
  const addPerson = useAppStore((s) => s.addPerson);
  const addAccounts = useAppStore((s) => s.addAccounts);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const themeId = useAppStore((s) => s.preferences.display.themeId);
  const showAtmosphere = activeView !== "friends" && activeView !== "map";

  // Mount the contact sync hook here (not in FriendsView) so the 15-minute
  // interval and focus listener run regardless of which view is active.
  const contactSync = useContactSync();
  const [showContactReview, setShowContactReview] = useState(false);
  const persistedDebugWidth =
    useAppStore((s) => s.preferences.display.debugPanelWidth) ?? DEFAULT_DEBUG_WIDTH;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedDebugWidth, setCommittedDebugWidth] = useState(persistedDebugWidth);
  const dragging = useRef(false);
  const pendingPersistedDebugWidth = useRef<number | null>(null);
  const discoveredAccountScanRef = useRef({ itemCount: 0, accountCount: 0 });

  useEffect(() => {
    if (dragging.current || dragWidth !== null) return;
    if (pendingPersistedDebugWidth.current !== null) {
      if (persistedDebugWidth !== pendingPersistedDebugWidth.current) return;
      pendingPersistedDebugWidth.current = null;
    }
    setCommittedDebugWidth(persistedDebugWidth);
  }, [dragWidth, persistedDebugWidth]);

  const debugWidth = dragWidth ?? committedDebugWidth;

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
    const handler = (e: KeyboardEvent) => {
      if (e.key === "D" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleDebug();
      } else if (e.key === "Escape" && debugVisible) {
        toggleDebug();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleDebug, debugVisible]);

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
      {/* On mobile (<md), the layout flows naturally in the document so Safari can
          collapse its address bar when the feed scrolls. min-h-0 and overflow-hidden
          are desktop-only; they lock the layout to 100dvh for in-element scrolling. */}
      <div className="app-theme-shell relative flex flex-1 flex-col md:min-h-0">
        {showAtmosphere ? <BackgroundAtmosphere /> : null}
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          sidebarExpanded={desktopSidebarExpanded}
          onSidebarToggle={() => setDesktopSidebarExpanded((value) => !value)}
        />

        <div className="relative z-10 flex flex-1 px-[var(--feed-card-gap,8px)] pb-[var(--feed-card-gap,8px)] md:min-h-0 md:overflow-hidden">
          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            desktopExpanded={desktopSidebarExpanded}
          />
          <main className="min-w-0 flex-1 md:min-h-0 md:overflow-hidden">
            {activeView === "friends"
              ? <FriendsView />
              : activeView === "map"
                ? <MapView />
                : children}
          </main>

          <div
            data-testid="debug-panel-drawer"
            className="relative hidden sm:flex flex-none overflow-hidden"
            style={{
              width: debugVisible ? debugWidth + 12 : 0,
              opacity: debugVisible ? 1 : 0,
              transition: dragging.current ? "none" : "width 300ms ease-in-out, opacity 180ms ease-in-out",
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
        {debugVisible && (
          <div className="sm:hidden">
            <DebugPanel variant="overlay" />
          </div>
        )}

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
