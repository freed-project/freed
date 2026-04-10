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
import { MapView } from "../map/MapView.js";

const DEFAULT_DEBUG_WIDTH = 320;
const MIN_DEBUG_WIDTH = 280;
const MAX_DEBUG_WIDTH = 600;

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const debugVisible = useDebugStore((s) => s.visible);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const activeView = useAppStore((s) => s.activeView);
  const items = useAppStore((s) => s.items);
  const addFriend = useAppStore((s) => s.addFriend);
  const updateFriend = useAppStore((s) => s.updateFriend);

  // Mount the contact sync hook here (not in FriendsView) so the 15-minute
  // interval and focus listener run regardless of which view is active.
  const contactSync = useContactSync();
  const [showContactReview, setShowContactReview] = useState(false);
  const savedDebugWidth = useAppStore((s) => s.preferences.display.debugPanelWidth) ?? DEFAULT_DEBUG_WIDTH;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = useRef(false);

  const debugWidth = dragWidth ?? savedDebugWidth;

  const handleDebugDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = debugWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Panel is on the right; dragging left increases width
        const next = Math.min(MAX_DEBUG_WIDTH, Math.max(MIN_DEBUG_WIDTH, startW - (ev.clientX - startX)));
        setDragWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        dragging.current = false;
        const final = Math.min(MAX_DEBUG_WIDTH, Math.max(MIN_DEBUG_WIDTH, startW - (ev.clientX - startX)));
        setDragWidth(null);
        updatePreferences({ display: { debugPanelWidth: final } } as Parameters<typeof updatePreferences>[0]);
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
    <div className="flex-1 md:min-h-0 flex flex-col bg-[#121212]">
      <Header onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex-1 md:min-h-0 flex md:overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 md:min-h-0 md:overflow-hidden">
          {activeView === "friends"
            ? <FriendsView />
            : activeView === "map"
              ? <MapView />
              : children}
        </main>

        {/* Desktop push drawer - always mounted so width can animate smoothly.
            The DebugPanel's own border-l is clipped by overflow-hidden when width is 0.
            Width is user-draggable; animated only when toggling open/closed. */}
        <div
          className="hidden sm:flex flex-none overflow-hidden relative"
          style={{
            width: debugVisible ? debugWidth : 0,
            transition: dragging.current ? "none" : "width 300ms ease-in-out",
          }}
        >
          {/* Left-edge resize handle - drag left to widen, drag right to narrow */}
          {debugVisible && (
            <div
              className="absolute left-0 top-0 w-1 h-full cursor-col-resize hover:bg-[#8b5cf6]/30 active:bg-[#8b5cf6]/50 transition-colors z-10"
              onMouseDown={handleDebugDragStart}
            />
          )}
          <DebugPanel variant="drawer" />
        </div>
      </div>

      {/* Mobile overlay - only on small screens, conditionally rendered */}
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
