/**
 * FriendsView — top-level scaffolded view for the Friends social graph.
 *
 * Status: Coming Soon. Components are fully implemented but this view is not
 * wired to live sidebar navigation yet. It will be promoted once Facebook and
 * Instagram capture are production-ready.
 *
 * Layout:
 *   - Full-canvas force graph (FriendGraph)
 *   - Reconnect ring overlay (ReconnectRing)
 *   - Slide-in detail panel when a friend node is selected (FriendDetailPanel)
 *   - FriendEditor modal for create/edit
 */

import { useState, useCallback } from "react";
import type { Friend, ReachOutLog } from "@freed/shared";
import { isInReconnectZone } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { FriendGraph } from "./FriendGraph.js";
import { ReconnectRing } from "./ReconnectRing.js";
import { FriendDetailPanel } from "./FriendDetailPanel.js";
import { FriendEditor } from "./FriendEditor.js";
import { UsersIcon } from "../icons.js";

export function FriendsView() {
  const friends = useAppStore((s) => s.friends);
  const feedItems = useAppStore((s) => {
    // Convert items array to Record for friends.ts helpers
    const map: Record<string, (typeof s.items)[0]> = {};
    for (const item of s.items) map[item.globalId] = item;
    return map;
  });
  const storeFriends = useAppStore((s) => s);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<Friend | null | "new">(null);

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
      await storeFriends.logReachOut(selectedId, entry);
    },
    [selectedId, storeFriends]
  );

  const handleSave = useCallback(
    async (
      data: Omit<Friend, "id" | "createdAt" | "updatedAt">,
      id?: string
    ) => {
      const now = Date.now();
      if (id) {
        await storeFriends.updateFriend(id, { ...data, updatedAt: now });
      } else {
        const friend: Friend = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        await storeFriends.addFriend(friend);
      }
      setEditorTarget(null);
    },
    [storeFriends]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await storeFriends.removeFriend(id);
      if (selectedId === id) setSelectedId(null);
      setEditorTarget(null);
    },
    [storeFriends, selectedId]
  );

  const friendList = Object.values(friends);

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* Graph + overlay */}
      <div className="flex-1 relative">
        {/* Reconnect ring overlay */}
        <ReconnectRing count={reconnectCount} />

        {/* Empty state */}
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

        {/* Floating "Add friend" button */}
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

      {/* Detail panel — slide in from the right */}
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

      {/* Friend editor modal */}
      {editorTarget !== null && (
        <FriendEditor
          existing={editorTarget === "new" ? null : editorTarget}
          onSave={handleSave}
          onDelete={editorTarget !== "new" ? handleDelete : undefined}
          onCancel={() => setEditorTarget(null)}
        />
      )}
    </div>
  );
}
