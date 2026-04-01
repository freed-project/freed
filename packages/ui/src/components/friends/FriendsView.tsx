import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { FeedItem, Friend, ReachOutLog } from "@freed/shared";
import { formatDistanceToNow } from "date-fns";
import { DEFAULT_FRIEND_AVATAR_TINT, isInReconnectZone } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { FriendGraphHandle } from "./FriendGraph.js";
import { FriendAvatar } from "./FriendAvatar.js";
import { FriendGraph } from "./FriendGraph.js";
import { FriendDetailPanel } from "./FriendDetailPanel.js";
import { FriendEditor } from "./FriendEditor.js";
import { UsersIcon, MapPinIcon } from "../icons.js";
import { ContentHeader } from "../layout/ContentHeader.js";
import {
  buildFriendOverviewEntries,
  filterAndSortFriendOverview,
  type FriendOverviewEntry,
  type FriendOverviewFilter,
  type FriendOverviewSort,
} from "../../lib/friends-workspace.js";
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";

const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 520;

const FILTER_OPTIONS: Array<{ id: FriendOverviewFilter; label: string }> = [
  { id: "need_outreach", label: "Need outreach" },
  { id: "no_contact", label: "No contact logged" },
  { id: "close_friends", label: "Close friends" },
  { id: "recently_active", label: "Recently active" },
  { id: "has_location", label: "Has location" },
];

const SORT_OPTIONS: Array<{ id: FriendOverviewSort; label: string }> = [
  { id: "recent_activity", label: "Recent activity" },
  { id: "care_level", label: "Care level" },
  { id: "last_contact", label: "Last contact" },
  { id: "name", label: "Name" },
];

const BUTTON_CHROME =
  "rounded-lg border border-[#6f56a8]/20 bg-[linear-gradient(180deg,rgba(52,33,76,0.2),rgba(15,14,22,0.88))] px-3 py-1.5 text-xs text-[#b8afcc] transition-colors hover:border-[#8b5cf6]/24 hover:bg-[linear-gradient(180deg,rgba(73,42,112,0.34),rgba(19,17,27,0.94))] hover:text-white";

function CareDots({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <span
          key={value}
          className={`h-1.5 w-1.5 rounded-full ${value <= level ? "bg-[#8b5cf6]" : "bg-[#2a2538]"}`}
        />
      ))}
    </div>
  );
}

function FriendListRow({
  entry,
  selected,
  onSelect,
}: {
  entry: FriendOverviewEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const lastPost = entry.lastPostAt
    ? formatDistanceToNow(entry.lastPostAt, { addSuffix: true })
    : "No posts yet";
  const lastContact = entry.lastContactAt
    ? formatDistanceToNow(entry.lastContactAt, { addSuffix: true })
    : "Never contacted";
  const avatarUrl = resolveFriendAvatarUrl(
    entry.friend,
    entry.items.map((item) => item.author.avatarUrl)
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
        selected
          ? "border-[#8b5cf6]/28 bg-[linear-gradient(180deg,rgba(91,33,182,0.14),rgba(20,16,28,0.88))] shadow-[0_18px_40px_rgba(17,12,29,0.28)]"
          : "border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(19,17,27,0.96),rgba(12,11,18,0.98))] hover:border-[#8b5cf6]/18 hover:bg-[linear-gradient(180deg,rgba(31,24,46,0.96),rgba(14,12,20,0.98))]"
      }`}
    >
      <div className="flex items-start gap-3">
        <FriendAvatar
          name={entry.friend.name}
          avatarUrl={avatarUrl}
          size={40}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-white">{entry.friend.name}</p>
            <CareDots level={entry.friend.careLevel} />
          </div>
          {entry.friend.bio && (
            <p className="mt-1 line-clamp-2 text-xs text-[#71717a]">{entry.friend.bio}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#8a8a93]">
            <span>{lastPost}</span>
            <span className="text-[#342d44]">•</span>
            <span>{lastContact}</span>
            {entry.hasLocation && (
              <>
                <span className="text-[#342d44]">•</span>
                <span className="inline-flex items-center gap-1 text-[#c4b5fd]">
                  <MapPinIcon className="h-3 w-3" />
                  Has location
                </span>
              </>
            )}
            {entry.needsOutreach && (
              <>
                <span className="text-[#342d44]">•</span>
                <span className="text-[#fbbf24]">Needs outreach</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export function FriendsView() {
  const friends = useAppStore((s) => s.friends);
  const items = useAppStore((s) => s.items);
  const addFriend = useAppStore((s) => s.addFriend);
  const updateFriend = useAppStore((s) => s.updateFriend);
  const removeFriend = useAppStore((s) => s.removeFriend);
  const logReachOut = useAppStore((s) => s.logReachOut);
  const selectedFriendId = useAppStore((s) => s.selectedFriendId);
  const setSelectedFriend = useAppStore((s) => s.setSelectedFriend);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const savedSidebarWidth = useAppStore((s) => s.preferences.display.friendsSidebarWidth) ?? DEFAULT_SIDEBAR_WIDTH;
  const avatarTint = useAppStore((s) => s.preferences.display.friendAvatarTint) ?? DEFAULT_FRIEND_AVATAR_TINT;
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<Friend | null | "new">(null);
  const [openingSyncModal, setOpeningSyncModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FriendOverviewFilter>>(new Set());
  const [sortBy, setSortBy] = useState<FriendOverviewSort>("recent_activity");
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const graphRef = useRef<FriendGraphHandle>(null);
  const isDraggingSidebar = useRef(false);
  const isMobile = useIsMobile();

  const { openReview } = useContactSyncContext();

  const feedItems = useMemo(() => {
    const map: Record<string, FeedItem> = {};
    for (const item of items) map[item.globalId] = item;
    return map;
  }, [items]);

  const friendList = useMemo(() => Object.values(friends), [friends]);
  const selectedFriend = selectedId ? friends[selectedId] ?? null : null;

  useEffect(() => {
    if (selectedFriendId && friends[selectedFriendId]) {
      setSelectedId(selectedFriendId);
      return;
    }
    if (selectedFriendId === null) {
      setSelectedId(null);
    }
  }, [friends, selectedFriendId]);

  const reconnectCount = useMemo(
    () => Object.values(friends).filter((friend) => isInReconnectZone(friend)).length,
    [friends]
  );

  const overviewEntries = useMemo(
    () => buildFriendOverviewEntries(friends, feedItems),
    [feedItems, friends]
  );
  const filteredOverviewEntries = useMemo(
    () => filterAndSortFriendOverview(overviewEntries, searchQuery, activeFilters, sortBy),
    [activeFilters, overviewEntries, searchQuery, sortBy]
  );

  const sidebarWidth = dragWidth ?? savedSidebarWidth;
  const handleSelectFriend = useCallback((friend: Friend, focusGraph: boolean = false) => {
    setSelectedId(friend.id);
    setSelectedFriend(friend.id);
    if (focusGraph) {
      graphRef.current?.focusFriend(friend.id);
    }
  }, [setSelectedFriend]);

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedFriend(null);
  }, [setSelectedFriend]);

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
        await addFriend({
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        });
      }
      setEditorTarget(null);
    },
    [addFriend, updateFriend]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await removeFriend(id);
      if (selectedId === id) {
        handleClearSelection();
      }
      setEditorTarget(null);
    },
    [handleClearSelection, removeFriend, selectedId]
  );

  const handleOpenSyncModal = useCallback(async () => {
    setOpeningSyncModal(true);
    try {
      await openReview();
    } finally {
      setOpeningSyncModal(false);
    }
  }, [openReview]);

  const toggleFilter = useCallback((filter: FriendOverviewFilter) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }, []);

  const handleSidebarDragStart = useCallback((event: React.MouseEvent) => {
    if (isMobile) return;
    event.preventDefault();
    isDraggingSidebar.current = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth - (moveEvent.clientX - startX))
      );
      setDragWidth(next);
    };
    const onUp = (upEvent: MouseEvent) => {
      isDraggingSidebar.current = false;
      const finalWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth - (upEvent.clientX - startX))
      );
      setDragWidth(null);
      void updatePreferences({ display: { friendsSidebarWidth: finalWidth } } as Parameters<typeof updatePreferences>[0]);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [isMobile, sidebarWidth, updatePreferences]);

  const renderOverviewSidebar = () => (
    <div className="flex h-full flex-col bg-[#0f0f0f]">
      <div className="border-b border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(51,33,76,0.16),rgba(15,14,22,0.94))] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Friends</h2>
            <p className="mt-1 text-xs text-[#71717a]">
              {friendList.length.toLocaleString()} total, {reconnectCount.toLocaleString()} due to reconnect
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenSyncModal}
              disabled={openingSyncModal}
              className={BUTTON_CHROME}
            >
              {openingSyncModal ? "Syncing..." : "Import Contacts"}
              {pendingMatchCount > 0 && (
                <span className="ml-2 rounded-full bg-[#8b5cf6]/30 px-1.5 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">
                  {pendingMatchCount.toLocaleString()}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setEditorTarget("new")}
              className="rounded-lg bg-[#8b5cf6] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#7c3aed]"
            >
              Add friend
            </button>
          </div>
        </div>

        <div className="mt-3">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#52525b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search friends"
              className="w-full rounded-xl border border-[#8b5cf6]/14 bg-[linear-gradient(180deg,rgba(17,15,25,0.94),rgba(12,11,18,0.98))] py-2 pl-9 pr-3 text-sm text-white placeholder:text-[#5d566f] focus:border-[#8b5cf6]/34 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="border-b border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(24,20,34,0.98),rgba(15,14,22,0.98))] px-4 py-3">
        <div className="rounded-2xl border border-[#f59e0b]/18 bg-[linear-gradient(180deg,rgba(70,44,8,0.14),rgba(29,22,10,0.46))] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#fbbf24]">Reconnect</p>
              <p className="mt-1 text-sm font-medium text-white">
                {reconnectCount.toLocaleString()} friend{reconnectCount === 1 ? "" : "s"} waiting on a follow-up
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveFilters(new Set(["need_outreach"]));
                setSortBy("last_contact");
              }}
              className="rounded-lg border border-[#f59e0b]/20 px-3 py-1.5 text-xs text-[#fcd34d] transition-colors hover:bg-[#f59e0b]/10"
            >
              Review
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => toggleFilter(filter.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                activeFilters.has(filter.id)
                  ? "border-[#8b5cf6]/24 bg-[linear-gradient(180deg,rgba(91,33,182,0.18),rgba(31,18,53,0.72))] text-[#d8b4fe]"
                  : "border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(19,17,27,0.92),rgba(12,11,18,0.98))] text-[#8a8a93] hover:border-[#8b5cf6]/18 hover:text-white"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[#71717a]">
            Showing {filteredOverviewEntries.length.toLocaleString()} of {friendList.length.toLocaleString()}
          </p>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as FriendOverviewSort)}
            className="rounded-lg border border-[#8b5cf6]/14 bg-[linear-gradient(180deg,rgba(19,17,27,0.92),rgba(12,11,18,0.98))] px-2.5 py-1.5 text-xs text-white focus:border-[#8b5cf6]/34 focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {filteredOverviewEntries.length === 0 ? (
          <div className="rounded-2xl border border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(19,17,27,0.96),rgba(12,11,18,0.98))] px-4 py-6 text-center">
            <p className="text-sm font-medium text-white">No friends match those filters</p>
            <p className="mt-1 text-xs text-[#71717a]">Try clearing a filter or changing the search query.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOverviewEntries.map((entry) => (
              <FriendListRow
                key={entry.friend.id}
                entry={entry}
                selected={entry.friend.id === selectedId}
                onSelect={() => handleSelectFriend(entry.friend, true)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderSelectedSidebar = () => (
    <div className="flex h-full flex-col bg-[#0f0f0f]">
      <div className="flex items-center justify-between gap-3 border-b border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(51,33,76,0.16),rgba(15,14,22,0.94))] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleClearSelection}
            className="rounded-lg border border-[#6f56a8]/20 bg-[linear-gradient(180deg,rgba(52,33,76,0.2),rgba(15,14,22,0.88))] p-1.5 text-[#b8afcc] transition-colors hover:border-[#8b5cf6]/24 hover:bg-[linear-gradient(180deg,rgba(73,42,112,0.34),rgba(19,17,27,0.94))] hover:text-white"
            aria-label="Back to all friends"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
              <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{selectedFriend?.name}</h2>
            <p className="mt-1 text-xs text-[#71717a]">Back to all friends</p>
          </div>
        </div>

        {selectedFriend && (
          <button
            type="button"
            onClick={() => setEditorTarget(selectedFriend)}
            className={BUTTON_CHROME}
          >
            Edit
          </button>
        )}
      </div>

      {selectedFriend && (
        <FriendDetailPanel
          friend={selectedFriend}
          feedItems={feedItems}
          onLogReachOut={handleLogReachOut}
          onOpenMap={() => {
            setSelectedFriend(selectedFriend.id);
            setActiveView("map");
          }}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0b0b0d]">
      <ContentHeader title="Friends" />

      <div className={`flex min-h-0 flex-1 ${isMobile ? "flex-col" : "flex-row"}`}>
        <div className="relative min-h-0 min-w-0 flex-1">
          {friendList.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(91,33,182,0.12),rgba(17,17,24,0.36))]">
                  <UsersIcon className="h-8 w-8 text-[#71717a]" />
                </div>
              <div>
                <p className="font-medium text-white">No friends yet</p>
                <p className="mt-1 max-w-xs text-sm text-[#71717a]">
                  Add friends to see their posts across all social channels in one place.
                </p>
              </div>
              <button
                className="rounded-lg bg-[#8b5cf6] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7c3aed]"
                onClick={() => setEditorTarget("new")}
              >
                Add your first friend
              </button>
            </div>
          ) : (
            <FriendGraph
              ref={graphRef}
              friends={friendList}
              feedItems={feedItems}
              onSelectFriend={(friend) => handleSelectFriend(friend, false)}
              selectedFriendId={selectedId}
              avatarTint={avatarTint}
            />
          )}
        </div>

        {!isMobile && (
          <div
            className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[#8b5cf6]/24 active:bg-[#8b5cf6]/34"
            onMouseDown={handleSidebarDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize friends sidebar"
          />
        )}

        <aside
          data-testid="friends-sidebar"
          className={`${isMobile ? "h-[46dvh] w-full border-t" : "shrink-0 border-l"} border-[#8b5cf6]/10 bg-[linear-gradient(180deg,rgba(15,14,22,0.98),rgba(11,10,16,0.98))] overflow-hidden`}
          style={isMobile ? undefined : { width: `${sidebarWidth}px` }}
        >
          {selectedFriend ? renderSelectedSidebar() : renderOverviewSidebar()}
        </aside>
      </div>

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
