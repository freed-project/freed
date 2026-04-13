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
import type { ContactMatch, GoogleContact } from "@freed/shared";
import {
  buildFriendSourcesFromAuthorIds,
  createDeviceContactFromGoogleContact,
  mergeFriendSources,
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
  const addFriend = useAppStore((s) => s.addFriend);
  const updateFriend = useAppStore((s) => s.updateFriend);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const themeId = useAppStore((s) => s.preferences.display.themeId);

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

  useEffect(() => {
    if (dragging.current || dragWidth !== null) return;
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
        setCommittedDebugWidth(final);
        setDragWidth(null);
        void updatePreferences({ display: { debugPanelWidth: final } } as Parameters<typeof updatePreferences>[0]);
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

  const handleLinkContact = useCallback(async (match: ContactMatch) => {
    const now = Date.now();
    const contact = createDeviceContactFromGoogleContact(match.contact, now);
    const newSources = buildFriendSourcesFromAuthorIds(items, match.authorIds);

    if (match.friend) {
      await updateFriend(match.friend.id, {
        contact,
        sources: mergeFriendSources(match.friend.sources ?? [], newSources),
        updatedAt: now,
      });
    } else if (newSources.length > 0) {
      await addFriend({
        id: crypto.randomUUID(),
        name: contact.name,
        sources: newSources,
        contact,
        careLevel: 3,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const id of [
      ...(match.friend ? [match.friend.id] : []),
      ...match.authorIds,
    ]) {
      contactSync.dismissMatch(match.contact.resourceName, id);
    }
  }, [addFriend, contactSync, items, updateFriend]);

  const handleCreateFriend = useCallback(async (contact: GoogleContact) => {
    const now = Date.now();
    await addFriend({
      id: crypto.randomUUID(),
      name: contact.name.displayName ?? contact.name.givenName ?? "",
      sources: [],
      contact: createDeviceContactFromGoogleContact(contact, now),
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    });
  }, [addFriend]);

  const openReview = useCallback(async () => {
    const result = await contactSync.syncNow();
    const shouldOpen =
      result.authStatus === "connected" ||
      result.pendingMatches.length > 0 ||
      result.cachedContacts.length > 0;
    setShowContactReview(shouldOpen);
  }, [contactSync]);

  return (
    <ContactSyncContext.Provider value={{ ...contactSync, openReview }}>
      {/* On mobile (<md), the layout flows naturally in the document so Safari can
          collapse its address bar when the feed scrolls. min-h-0 and overflow-hidden
          are desktop-only; they lock the layout to 100dvh for in-element scrolling. */}
      <div className="app-theme-shell relative flex flex-1 flex-col md:min-h-0">
        <BackgroundAtmosphere />
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          sidebarExpanded={desktopSidebarExpanded}
          onSidebarToggle={() => setDesktopSidebarExpanded((value) => !value)}
        />

        <div className="relative z-10 flex flex-1 px-3 pb-3 md:min-h-0 md:overflow-hidden">
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
            <div className="relative flex h-full w-full pl-3">
              {debugVisible && (
                <div
                  data-testid="debug-panel-resize-handle"
                  className="absolute left-3 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-[rgb(var(--theme-accent-secondary-rgb)/0.24)] active:bg-[rgb(var(--theme-accent-secondary-rgb)/0.4)]"
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
            onLink={handleLinkContact}
            onSkip={contactSync.dismissMatch}
            onCreateFriend={handleCreateFriend}
          />
        )}
      </div>
    </ContactSyncContext.Provider>
  );
}
