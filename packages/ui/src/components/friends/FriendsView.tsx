/**
 * FriendsView — force-directed social graph + CRM.
 *
 * Layout:
 *   - Toolbar with "Import Contacts" button (Google Contacts sync)
 *   - Full-canvas force graph (FriendGraph)
 *   - Reconnect ring overlay (ReconnectRing)
 *   - Slide-in detail panel when a friend node is selected (FriendDetailPanel)
 *   - FriendEditor modal for create / edit
 *   - ContactSyncModal for reviewing Google Contacts matches
 */

import { useState, useCallback, useMemo } from "react";
import type { Friend, FriendSource, DeviceContact, ReachOutLog, ContactMatch, GoogleContact } from "@freed/shared";
import { isInReconnectZone } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";
import { FriendGraph } from "./FriendGraph.js";
import { ReconnectRing } from "./ReconnectRing.js";
import { FriendDetailPanel } from "./FriendDetailPanel.js";
import { FriendEditor } from "./FriendEditor.js";
import { ContactSyncModal } from "./ContactSyncModal.js";
import { UsersIcon } from "../icons.js";

export function FriendsView() {
  const friends = useAppStore((s) => s.friends);
  const items = useAppStore((s) => s.items);
  const addFriend = useAppStore((s) => s.addFriend);
  const updateFriend = useAppStore((s) => s.updateFriend);
  const removeFriend = useAppStore((s) => s.removeFriend);
  const logReachOut = useAppStore((s) => s.logReachOut);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const feedItems = useMemo(() => {
    const map: Record<string, (typeof items)[number]> = {};
    for (const item of items) map[item.globalId] = item;
    return map;
  }, [items]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<Friend | null | "new">(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [openingSyncModal, setOpeningSyncModal] = useState(false);

  const { syncState, dismissMatch, syncNow } = useContactSyncContext();

  const selectedFriend = selectedId ? friends[selectedId] : null;

  const reconnectCount = Object.values(friends).filter((f) =>
    isInReconnectZone(f)
  ).length;

  const handleSelectFriend = useCallback((friend: Friend) => {
    setSelectedId((prev) => (prev === friend.id ? null : friend.id));
  }, []);

  const handleLogReachOut = useCallback(
    async (entry: ReachOutLog) => {
      if (!selectedId) return;
      await logReachOut(selectedId, entry);
    },
    [logReachOut, selectedId]
  );

  const handleSave = useCallback(
    async (
      data: Omit<Friend, "id" | "createdAt" | "updatedAt">,
      id?: string
    ) => {
      const now = Date.now();
      if (id) {
        await updateFriend(id, { ...data, updatedAt: now });
      } else {
        const friend: Friend = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        await addFriend(friend);
      }
      setEditorTarget(null);
    },
    [addFriend, updateFriend]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await removeFriend(id);
      if (selectedId === id) setSelectedId(null);
      setEditorTarget(null);
    },
    [removeFriend, selectedId]
  );

  /**
   * Link a Google contact match to the store.
   *
   * If an existing Friend is matched:
   *   - Update their `contact` field with the Google contact data.
   *   - Add any matched unlinked authors as new FriendSource entries.
   *
   * If only unlinked feed authors are matched (no existing Friend):
   *   - Create a new Friend with the contact info and those sources.
   *
   * In both cases, dismiss all potential IDs for this contact to clear the
   * match from the pending queue.
   */
  const handleLink = useCallback(
    async (match: ContactMatch) => {
      const { contact, friend, authorIds } = match;

      const deviceContact: DeviceContact = {
        importedFrom: "google",
        name: contact.name.displayName ?? contact.name.givenName ?? "",
        phone: contact.phones[0]?.value,
        email: contact.emails[0]?.value,
        // Store resourceName as nativeId for reliable re-identification on
        // future syncs (name matching alone is ambiguous).
        nativeId: contact.resourceName,
        importedAt: Date.now(),
      };

      // Build FriendSource entries for any unlinked feed authors in the match.
      const newSources: FriendSource[] = authorIds.flatMap((authorId) => {
        const item = items.find((i) => i.author.id === authorId);
        if (!item) return [];
        return [{
          platform: item.platform,
          authorId: item.author.id,
          handle: item.author.handle,
          displayName: item.author.displayName,
          avatarUrl: item.author.avatarUrl,
        }];
      });

      if (friend) {
        // Merge new sources into the existing friend's source list.
        const updatedSources = [...(friend.sources ?? []), ...newSources];
        await updateFriend(friend.id, {
          contact: deviceContact,
          sources: updatedSources,
        });
      } else if (newSources.length > 0) {
        const now = Date.now();
        await addFriend({
          id: crypto.randomUUID(),
          name: contact.name.displayName ?? contact.name.givenName ?? "",
          sources: newSources,
          contact: deviceContact,
          careLevel: 3,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Dismiss all potential IDs to clear this contact from the pending queue.
      const allIds = [
        ...(friend ? [friend.id] : []),
        ...authorIds,
      ];
      for (const id of allIds) {
        dismissMatch(contact.resourceName, id);
      }
    },
    [addFriend, dismissMatch, items, updateFriend]
  );

  /**
   * Create a new Friend from an unmatched Google contact (no social feed match).
   * The Friend starts with no linked sources; the user can add them later.
   */
  const handleCreateFriend = useCallback(
    async (contact: GoogleContact) => {
      const now = Date.now();
      await addFriend({
        id: crypto.randomUUID(),
        name: contact.name.displayName ?? contact.name.givenName ?? "",
        sources: [],
        contact: {
          importedFrom: "google",
          name: contact.name.displayName ?? contact.name.givenName ?? "",
          phone: contact.phones[0]?.value,
          email: contact.emails[0]?.value,
          nativeId: contact.resourceName,
          importedAt: now,
        },
        careLevel: 3,
        createdAt: now,
        updatedAt: now,
      });
    },
    [addFriend]
  );

  /** Open the contact sync modal, running a fresh sync first if Google is connected. */
  const handleOpenSyncModal = useCallback(async () => {
    setOpeningSyncModal(true);
    try {
      await syncNow();
      setShowSyncModal(true);
    } finally {
      setOpeningSyncModal(false);
    }
  }, [syncNow]);

  const friendList = Object.values(friends);

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-[#0f0f0f]">
        <span className="text-sm font-medium text-text-primary">Friends</span>
        <button
          onClick={handleOpenSyncModal}
          disabled={openingSyncModal}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM2 15v-1a4 4 0 014-4h.5" />
          </svg>
          {openingSyncModal ? "Syncing..." : "Import Contacts"}
          {pendingMatchCount > 0 && (
            <span className="text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded-full bg-[#8b5cf6]/30 text-[#c4b5fd]">
              {pendingMatchCount.toLocaleString()}
            </span>
          )}
        </button>
      </div>

      {/* Graph + detail panel */}
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative">
          <ReconnectRing count={reconnectCount} />

          {friendList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <UsersIcon className="w-8 h-8 text-text-secondary" />
              </div>
              <div>
                <p className="text-text-primary font-medium">No friends yet</p>
                <p className="text-text-secondary text-sm mt-1 max-w-xs">
                  Add friends to see their posts across all social channels in one place.
                </p>
              </div>
              <button
                className="px-4 py-2 text-sm font-medium bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg transition-colors"
                onClick={() => setEditorTarget("new")}
              >
                Add your first friend
              </button>
            </div>
          ) : (
            <FriendGraph
              friends={friendList}
              feedItems={feedItems}
              onSelectFriend={handleSelectFriend}
              selectedFriendId={selectedId}
            />
          )}

          {friendList.length > 0 && (
            <button
              className="absolute bottom-6 right-6 flex items-center gap-2 px-4 py-2.5 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-sm font-medium rounded-full shadow-lg shadow-[#8b5cf6]/30 transition-colors"
              onClick={() => setEditorTarget("new")}
              aria-label="Add friend"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4" aria-hidden>
                <path d="M10 4v12M4 10h12" />
              </svg>
              Add friend
            </button>
          )}
        </div>

        {selectedFriend && (
          <div className="w-80 shrink-0 border-l border-white/10 overflow-hidden">
            <FriendDetailPanel
              friend={selectedFriend}
              feedItems={feedItems}
              onClose={() => setSelectedId(null)}
              onEdit={() => setEditorTarget(selectedFriend)}
              onLogReachOut={handleLogReachOut}
            />
          </div>
        )}
      </div>

      {/* Friend editor modal */}
      {editorTarget !== null && (
        <FriendEditor
          existing={editorTarget === "new" ? null : editorTarget}
          onSave={handleSave}
          onDelete={editorTarget !== "new" ? handleDelete : undefined}
          onCancel={() => setEditorTarget(null)}
        />
      )}

      {/* Contact sync modal */}
      {showSyncModal && (
        <ContactSyncModal
          onClose={() => setShowSyncModal(false)}
          syncState={syncState}
          onLink={handleLink}
          onSkip={dismissMatch}
          onCreateFriend={handleCreateFriend}
        />
      )}
    </div>
  );
}
