import { useState, useCallback, useMemo, useEffect, useRef, type CSSProperties } from "react";
import type {
  Account,
  DeviceContact,
  FeedItem,
  Friend,
  FriendSource,
  Person,
  ReachOutLog,
} from "@freed/shared";
import { formatDistanceToNow } from "date-fns";
import { friendFromPerson, isInReconnectZone } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { FriendGraphHandle } from "./FriendGraph.js";
import { FriendAvatar } from "./FriendAvatar.js";
import { FriendGraph } from "./FriendGraph.js";
import { FriendDetailPanel } from "./FriendDetailPanel.js";
import { AccountDetailPanel } from "./AccountDetailPanel.js";
import { FriendEditor } from "./FriendEditor.js";
import { SearchField } from "../SearchField.js";
import { UsersIcon, MapPinIcon } from "../icons.js";
import {
  buildFriendOverviewEntries,
  filterAndSortFriendOverview,
  type FriendOverviewEntry,
  type FriendOverviewFilter,
  type FriendOverviewSort,
} from "../../lib/friends-workspace.js";
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";
import {
  buildSuggestionsByAccount,
  buildSuggestionsByPerson,
  type AccountLinkSuggestion,
} from "../../lib/account-link-suggestions.js";
import {
  FRIENDS_SIDEBAR_GAP_WIDTH_PX,
  px,
} from "../layout/layoutConstants.js";

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

const BUTTON_CHROME = "btn-secondary rounded-lg px-3 py-1.5 text-xs";
const FRIENDS_SIDEBAR_SECTION = "theme-dialog-divider border-b px-4 py-3";

type EditorState =
  | { kind: "new"; draft?: Partial<Friend> | null }
  | { kind: "edit"; personId: string }
  | null;

function CareDots({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <span
          key={value}
          className={`h-1.5 w-1.5 rounded-full ${value <= level ? "bg-[color:var(--theme-accent-secondary)]" : "bg-[color:var(--theme-border-subtle)]"}`}
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
      className={`theme-card-soft w-full rounded-2xl p-3 text-left transition-colors ${
        selected
          ? "border-[color:var(--theme-border-strong)] bg-[color:var(--theme-bg-card-hover)] shadow-[var(--theme-glow-sm)]"
          : "hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
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
            <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">{entry.friend.name}</p>
            <CareDots level={entry.friend.careLevel} />
          </div>
          {entry.friend.bio && (
            <p className="mt-1 line-clamp-2 text-xs text-[color:var(--theme-text-muted)]">{entry.friend.bio}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--theme-text-muted)]">
            <span>{lastPost}</span>
            <span className="text-[color:var(--theme-text-soft)]">•</span>
            <span>{lastContact}</span>
            {entry.hasLocation && (
              <>
                <span className="text-[color:var(--theme-text-soft)]">•</span>
                <span className="inline-flex items-center gap-1 text-[color:var(--theme-accent-secondary)]">
                  <MapPinIcon className="h-3 w-3" />
                  Has location
                </span>
              </>
            )}
            {entry.needsOutreach && (
              <>
                <span className="text-[color:var(--theme-text-soft)]">•</span>
                <span className="theme-feedback-text-warning">Needs outreach</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function sourceKey(platform: string, authorId: string): string {
  return `${platform}:${authorId}`;
}

function accountToFriendSource(account: Account): FriendSource {
  return {
    platform: account.provider as FriendSource["platform"],
    authorId: account.externalId,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    profileUrl: account.profileUrl,
  };
}

function socialAccountId(source: FriendSource): string {
  return `social:${source.platform}:${source.authorId}`;
}

function contactProvider(contact: DeviceContact): Account["provider"] {
  if (contact.importedFrom === "google") return "google_contacts";
  if (contact.importedFrom === "macos") return "macos_contacts";
  if (contact.importedFrom === "ios") return "ios_contacts";
  if (contact.importedFrom === "android") return "android_contacts";
  return "web_contact";
}

function contactAccountId(personId: string, contact: DeviceContact): string {
  return `contact:${contactProvider(contact)}:${contact.nativeId ?? personId}`;
}

function socialAccountDraftFromSource(
  source: FriendSource,
  personId: string,
  item: FeedItem | null,
  now: number,
): Account {
  return {
    id: socialAccountId(source),
    personId,
    kind: "social",
    provider: source.platform,
    externalId: source.authorId,
    handle: source.handle,
    displayName: source.displayName,
    avatarUrl: source.avatarUrl,
    profileUrl: source.profileUrl,
    firstSeenAt: item?.publishedAt ?? now,
    lastSeenAt: item?.publishedAt ?? now,
    discoveredFrom: item?.contentType === "story" ? "story_author" : item ? "captured_item" : "manual_entry",
    createdAt: now,
    updatedAt: now,
  };
}

function contactAccountDraft(
  personId: string,
  contact: DeviceContact,
  now: number,
): Account {
  return {
    id: contactAccountId(personId, contact),
    personId,
    kind: "contact",
    provider: contactProvider(contact),
    externalId: contact.nativeId ?? contact.name,
    displayName: contact.name,
    email: contact.email,
    phone: contact.phone,
    address: contact.address,
    importedAt: contact.importedAt,
    firstSeenAt: contact.importedAt,
    lastSeenAt: now,
    discoveredFrom: "contact_import",
    createdAt: now,
    updatedAt: now,
  };
}

function friendDraftFromAccount(account: Account): Partial<Friend> {
  return {
    name: account.displayName ?? account.handle ?? account.externalId,
    avatarUrl: account.avatarUrl,
    relationshipStatus: "friend",
    careLevel: 3,
    sources: account.kind === "social" ? [accountToFriendSource(account)] : [],
  };
}

export function FriendsView() {
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const items = useAppStore((s) => s.items);
  const addPerson = useAppStore((s) => s.addPerson);
  const updatePerson = useAppStore((s) => s.updatePerson);
  const removePerson = useAppStore((s) => s.removePerson);
  const addAccount = useAppStore((s) => s.addAccount);
  const updateAccount = useAppStore((s) => s.updateAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const logReachOut = useAppStore((s) => s.logReachOut);
  const selectedPersonId = useAppStore((s) => s.selectedPersonId);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const display = useAppStore((s) => s.preferences.display);
  const savedSidebarWidth = display.friendsSidebarWidth ?? DEFAULT_SIDEBAR_WIDTH;
  const themeId = display.themeId;
  const effectiveMode = display.friendsMode ?? "all_content";
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [editorState, setEditorState] = useState<EditorState>(null);
  const [openingSyncModal, setOpeningSyncModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FriendOverviewFilter>>(new Set());
  const [sortBy, setSortBy] = useState<FriendOverviewSort>("recent_activity");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedSidebarWidth, setCommittedSidebarWidth] = useState(savedSidebarWidth);

  const graphRef = useRef<FriendGraphHandle>(null);
  const isDraggingSidebar = useRef(false);
  const pendingPersistedSidebarWidth = useRef<number | null>(null);
  const isMobile = useIsMobile();

  const { openReview } = useContactSyncContext();

  const feedItems = useMemo(() => {
    const map: Record<string, FeedItem> = {};
    for (const item of items) map[item.globalId] = item;
    return map;
  }, [items]);
  const sourceItems = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) {
      const key = sourceKey(item.platform, item.author.id);
      const current = map.get(key);
      if (!current || item.publishedAt > current.publishedAt) {
        map.set(key, item);
      }
    }
    return map;
  }, [items]);

  const friendPersons = useMemo(
    () =>
      Object.values(persons)
        .filter((person) => person.relationshipStatus === "friend")
        .sort((left, right) => left.name.localeCompare(right.name)),
    [persons],
  );
  const friendsById = useMemo<Record<string, Friend>>(
    () => Object.fromEntries(friendPersons.map((person) => [person.id, friendFromPerson(person, accounts)])),
    [accounts, friendPersons],
  );
  const friendList = useMemo(() => Object.values(friendsById), [friendsById]);
  const socialAccountCount = useMemo(
    () => Object.values(accounts).filter((account) => account.kind === "social").length,
    [accounts],
  );

  const selectedPerson =
    selectedPersonId && persons[selectedPersonId]?.relationshipStatus === "friend"
      ? persons[selectedPersonId]
      : null;
  const selectedFriend = selectedPerson ? friendFromPerson(selectedPerson, accounts) : null;
  const selectedAccount = selectedAccountId ? accounts[selectedAccountId] ?? null : null;

  const reconnectCount = useMemo(
    () => friendPersons.filter((person) => isInReconnectZone(person)).length,
    [friendPersons]
  );

  const suggestionsByAccount = useMemo(
    () => buildSuggestionsByAccount(persons, accounts),
    [accounts, persons],
  );
  const suggestionsByPerson = useMemo(
    () => buildSuggestionsByPerson(persons, accounts),
    [accounts, persons],
  );

  const overviewEntries = useMemo(
    () => buildFriendOverviewEntries(friendsById, feedItems),
    [feedItems, friendsById]
  );
  const filteredOverviewEntries = useMemo(
    () => filterAndSortFriendOverview(overviewEntries, searchQuery, activeFilters, sortBy),
    [activeFilters, overviewEntries, searchQuery, sortBy]
  );
  const selectedAccountFeedItems = useMemo(() => {
    if (!selectedAccount || selectedAccount.kind !== "social") return [];
    return items
      .filter(
        (item) =>
          item.platform === selectedAccount.provider &&
          item.author.id === selectedAccount.externalId,
      )
      .sort((left, right) => right.publishedAt - left.publishedAt);
  }, [items, selectedAccount]);
  const selectedAccountSuggestions = useMemo<AccountLinkSuggestion[]>(
    () => (selectedAccount ? suggestionsByAccount.get(selectedAccount.id) ?? [] : []),
    [selectedAccount, suggestionsByAccount],
  );
  const selectedPersonSuggestions = useMemo<AccountLinkSuggestion[]>(
    () => (selectedPerson ? suggestionsByPerson.get(selectedPerson.id) ?? [] : []),
    [selectedPerson, suggestionsByPerson],
  );

  useEffect(() => {
    if (selectedPersonId && !persons[selectedPersonId]) {
      setSelectedPerson(null);
    }
  }, [persons, selectedPersonId, setSelectedPerson]);

  useEffect(() => {
    if (selectedAccountId && !accounts[selectedAccountId]) {
      setSelectedAccount(null);
    }
  }, [accounts, selectedAccountId, setSelectedAccount]);

  useEffect(() => {
    if (dragWidth !== null || isDraggingSidebar.current) return;
    if (pendingPersistedSidebarWidth.current !== null) {
      if (savedSidebarWidth !== pendingPersistedSidebarWidth.current) return;
      pendingPersistedSidebarWidth.current = null;
    }
    setCommittedSidebarWidth(savedSidebarWidth);
  }, [dragWidth, savedSidebarWidth]);

  const sidebarWidth = dragWidth ?? committedSidebarWidth;
  const graphViewportStyle = isMobile
    ? undefined
    : ({
        "--theme-soft-viewport-extra-comp-right": px(FRIENDS_SIDEBAR_GAP_WIDTH_PX),
      } as CSSProperties);

  const focusGraphNode = useCallback((id: string) => {
    graphRef.current?.focusNode(id);
  }, []);

  const handleSelectPerson = useCallback((person: Person, focusGraph: boolean = false) => {
    setSelectedPerson(person.id);
    if (focusGraph) {
      focusGraphNode(person.id);
    }
  }, [focusGraphNode, setSelectedPerson]);

  const handleSelectAccount = useCallback((account: Account, focusGraph: boolean = false) => {
    setSelectedAccount(account.id);
    if (focusGraph) {
      focusGraphNode(account.id);
    }
  }, [focusGraphNode, setSelectedAccount]);

  const handleClearSelection = useCallback(() => {
    setSelectedPerson(null);
    setSelectedAccount(null);
  }, [setSelectedAccount, setSelectedPerson]);

  const handleLogReachOut = useCallback(
    async (entry: ReachOutLog) => {
      if (!selectedPerson) return;
      await logReachOut(selectedPerson.id, entry);
    },
    [logReachOut, selectedPerson]
  );

  const persistFriend = useCallback(async (
    data: Omit<Friend, "id" | "createdAt" | "updatedAt">,
    personId?: string,
  ) => {
    const now = Date.now();
    const existingPerson = personId ? persons[personId] ?? null : null;
    const nextPersonId = existingPerson?.id ?? crypto.randomUUID();

    const nextPerson: Person = {
      id: nextPersonId,
      name: data.name.trim(),
      avatarUrl: data.avatarUrl?.trim() || undefined,
      bio: data.bio?.trim() || undefined,
      relationshipStatus: "friend",
      careLevel: data.careLevel,
      reachOutIntervalDays: data.reachOutIntervalDays,
      reachOutLog: existingPerson?.reachOutLog,
      tags: data.tags,
      notes: data.notes?.trim() || undefined,
      createdAt: existingPerson?.createdAt ?? now,
      updatedAt: now,
    };

    if (existingPerson) {
      await updatePerson(nextPersonId, {
        name: nextPerson.name,
        avatarUrl: nextPerson.avatarUrl,
        bio: nextPerson.bio,
        relationshipStatus: nextPerson.relationshipStatus,
        careLevel: nextPerson.careLevel,
        reachOutIntervalDays: nextPerson.reachOutIntervalDays,
        tags: nextPerson.tags,
        notes: nextPerson.notes,
      });
    } else {
      await addPerson(nextPerson);
    }

    const desiredSocialIds = new Set(data.sources.map((source) => socialAccountId(source)));
    const existingSocialAccounts = Object.values(accounts).filter(
      (account) => account.kind === "social" && account.personId === nextPersonId,
    );

    await Promise.all(
      existingSocialAccounts
        .filter((account) => !desiredSocialIds.has(account.id))
        .map((account) => updateAccount(account.id, { personId: undefined })),
    );

    await Promise.all(
      data.sources.map(async (source) => {
        const accountId = socialAccountId(source);
        const existingAccount = accounts[accountId];
        const item = sourceItems.get(sourceKey(source.platform, source.authorId)) ?? null;
        if (existingAccount) {
          await updateAccount(accountId, {
            personId: nextPersonId,
            handle: source.handle ?? existingAccount.handle,
            displayName: source.displayName ?? existingAccount.displayName,
            avatarUrl: source.avatarUrl ?? existingAccount.avatarUrl,
            profileUrl: source.profileUrl ?? existingAccount.profileUrl,
            firstSeenAt: item ? Math.min(existingAccount.firstSeenAt, item.publishedAt) : existingAccount.firstSeenAt,
            lastSeenAt: item ? Math.max(existingAccount.lastSeenAt, item.publishedAt) : existingAccount.lastSeenAt,
          });
          return;
        }
        await addAccount(socialAccountDraftFromSource(source, nextPersonId, item, now));
      }),
    );

    const existingContactAccounts = Object.values(accounts).filter(
      (account) => account.kind === "contact" && account.personId === nextPersonId,
    );

    if (!data.contact) {
      await Promise.all(existingContactAccounts.map((account) => removeAccount(account.id)));
    } else {
      const nextContact = contactAccountDraft(nextPersonId, data.contact, now);
      await Promise.all(
        existingContactAccounts
          .filter((account) => account.id !== nextContact.id)
          .map((account) => removeAccount(account.id)),
      );

      if (accounts[nextContact.id]) {
        await updateAccount(nextContact.id, {
          personId: nextPersonId,
          provider: nextContact.provider,
          externalId: nextContact.externalId,
          displayName: nextContact.displayName,
          email: nextContact.email,
          phone: nextContact.phone,
          address: nextContact.address,
          importedAt: nextContact.importedAt,
          firstSeenAt: accounts[nextContact.id]?.firstSeenAt ?? nextContact.firstSeenAt,
          lastSeenAt: nextContact.lastSeenAt,
        });
      } else {
        await addAccount(nextContact);
      }
    }

    setEditorState(null);
    setSelectedPerson(nextPersonId);
  }, [accounts, addAccount, addPerson, persons, removeAccount, setSelectedPerson, sourceItems, updateAccount, updatePerson]);

  const handleSave = useCallback(
    async (data: Omit<Friend, "id" | "createdAt" | "updatedAt">) => {
      const personId = editorState?.kind === "edit" ? editorState.personId : undefined;
      await persistFriend(data, personId);
    },
    [editorState, persistFriend]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await removePerson(id);
      if (selectedPersonId === id) {
        handleClearSelection();
      }
      setEditorState(null);
    },
    [handleClearSelection, removePerson, selectedPersonId]
  );

  const handleLinkAccountToPerson = useCallback(
    async (accountId: string, personId: string) => {
      await updateAccount(accountId, { personId });
      setSelectedPerson(personId);
    },
    [setSelectedPerson, updateAccount],
  );

  const handlePromoteSelectedAccount = useCallback(() => {
    if (!selectedAccount) return;
    setEditorState({ kind: "new", draft: friendDraftFromAccount(selectedAccount) });
  }, [selectedAccount]);

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
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

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
      pendingPersistedSidebarWidth.current = finalWidth;
      setCommittedSidebarWidth(finalWidth);
      setDragWidth(null);
      void updatePreferences({ display: { friendsSidebarWidth: finalWidth } } as Parameters<typeof updatePreferences>[0]).catch(() => {
        if (pendingPersistedSidebarWidth.current === finalWidth) {
          pendingPersistedSidebarWidth.current = null;
        }
      });
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [isMobile, sidebarWidth, updatePreferences]);

  const renderOverviewSidebar = () => (
    <div className="flex h-full flex-col bg-transparent">
      <div className={FRIENDS_SIDEBAR_SECTION}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--theme-text-primary)]">Friends</h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              {friendList.length.toLocaleString()} total, {socialAccountCount.toLocaleString()} account{socialAccountCount === 1 ? "" : "s"}, {reconnectCount.toLocaleString()} due to reconnect
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
                <span className="ml-2 rounded-full bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.24)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--theme-text-primary)]">
                  {pendingMatchCount.toLocaleString()}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setEditorState({ kind: "new" })}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Add friend
            </button>
          </div>
        </div>

        <div className="mt-3">
          <SearchField
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search friends"
            aria-label="Search friends"
            inputClassName="rounded-xl"
          />
        </div>
      </div>

      <div className={FRIENDS_SIDEBAR_SECTION}>
        <div className="theme-panel-muted rounded-xl p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="theme-feedback-text-warning text-[11px] font-semibold uppercase tracking-[0.14em]">Reconnect</p>
              <p className="mt-1 text-sm font-medium text-[var(--theme-text-primary)]">
                {reconnectCount.toLocaleString()} friend{reconnectCount === 1 ? "" : "s"} waiting on a follow-up
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveFilters(new Set(["need_outreach"]));
                setSortBy("last_contact");
              }}
              className={BUTTON_CHROME}
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
                  ? "theme-chip-active"
                  : "theme-chip"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[color:var(--theme-text-muted)]">
            Showing {filteredOverviewEntries.length.toLocaleString()} of {friendList.length.toLocaleString()}
          </p>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as FriendOverviewSort)}
            className="theme-input theme-select rounded-lg px-2.5 py-1.5 text-xs"
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
          <div className="theme-panel-muted rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">No friends match those filters</p>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">Try clearing a filter or changing the search query.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOverviewEntries.map((entry) => (
              <FriendListRow
                key={entry.friend.id}
                entry={entry}
                selected={entry.friend.id === selectedPerson?.id}
                onSelect={() => handleSelectPerson(persons[entry.friend.id] ?? friendPersons[0], true)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderSelectedPersonSidebar = () => (
    <div className="flex h-full flex-col bg-transparent">
      <div className={`${FRIENDS_SIDEBAR_SECTION} flex items-center justify-between gap-3`}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleClearSelection}
            className="btn-secondary rounded-lg p-1.5"
            aria-label="Back to all friends"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
              <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">{selectedPerson?.name}</h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">Back to all friends</p>
          </div>
        </div>

        {selectedFriend && (
          <button
            type="button"
            onClick={() => setEditorState({ kind: "edit", personId: selectedFriend.id })}
            className={BUTTON_CHROME}
          >
            Edit
          </button>
        )}
      </div>

      {selectedPerson && selectedPersonSuggestions.length > 0 ? (
        <div className="theme-dialog-divider border-b px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
                Suggested channels
              </p>
              <p className="mt-1 text-sm text-[color:var(--theme-text-primary)]">
                Link likely accounts to {selectedPerson.name}.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {selectedPersonSuggestions.map((suggestion) => {
              const account = accounts[suggestion.accountId];
              if (!account) return null;
              return (
                <button
                  key={`${suggestion.personId}:${suggestion.accountId}`}
                  type="button"
                  onClick={() => void handleLinkAccountToPerson(account.id, selectedPerson.id)}
                  className="theme-card-soft flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
                      {account.displayName ?? account.handle ?? account.externalId}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                      {suggestion.reason}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    suggestion.confidence === "high"
                      ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
                      : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
                  }`}>
                    {suggestion.confidence}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedFriend && selectedPerson ? (
        <div className="min-h-0 flex-1">
          <FriendDetailPanel
            friend={selectedFriend}
            feedItems={feedItems}
            onLogReachOut={handleLogReachOut}
            onOpenMap={() => {
              setSelectedPerson(selectedPerson.id);
              setActiveView("map");
            }}
          />
        </div>
      ) : null}
    </div>
  );

  const renderSelectedAccountSidebar = () => {
    if (!selectedAccount) return null;
    const linkedPerson = selectedAccount.personId ? persons[selectedAccount.personId] ?? null : null;
    return (
      <AccountDetailPanel
        account={selectedAccount}
        linkedPerson={linkedPerson}
        suggestions={selectedAccountSuggestions}
        persons={friendPersons}
        feedItems={selectedAccountFeedItems}
        onBack={handleClearSelection}
        onPromoteToFriend={handlePromoteSelectedAccount}
        onLinkToPerson={(personId) => void handleLinkAccountToPerson(selectedAccount.id, personId)}
        onOpenPerson={(personId) => {
          const person = persons[personId];
          if (person) {
            handleSelectPerson(person);
          }
        }}
      />
    );
  };

  const renderGraphEmptyState = () => {
    if (effectiveMode === "friends" || socialAccountCount === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="theme-card-soft flex h-16 w-16 items-center justify-center rounded-full">
            <UsersIcon className="h-8 w-8 text-[color:var(--theme-text-muted)]" />
          </div>
          <div>
            <p className="font-medium text-[color:var(--theme-text-primary)]">
              {friendList.length === 0 ? "No friends yet" : "No friend graph nodes yet"}
            </p>
            <p className="mt-1 max-w-xs text-sm text-[color:var(--theme-text-muted)]">
              {friendList.length === 0
                ? "Switch to All content to explore captured accounts, or add your first friend now."
                : "Link more channels or switch to All content to explore captured accounts."}
            </p>
          </div>
          <button
            className="btn-primary rounded-lg px-4 py-2 text-sm"
            onClick={() => setEditorState({ kind: "new" })}
          >
            Add your first friend
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="theme-card-soft flex h-16 w-16 items-center justify-center rounded-full">
          <UsersIcon className="h-8 w-8 text-[color:var(--theme-text-muted)]" />
        </div>
        <div>
          <p className="font-medium text-[color:var(--theme-text-primary)]">No captured accounts yet</p>
          <p className="mt-1 max-w-xs text-sm text-[color:var(--theme-text-muted)]">
            Accounts with captured content will appear here and can be promoted into your friends workspace.
          </p>
        </div>
      </div>
    );
  };

  const activeSidebar = selectedAccount
    ? renderSelectedAccountSidebar()
    : selectedFriend
      ? renderSelectedPersonSidebar()
      : renderOverviewSidebar();

  return (
    <div className="app-theme-shell flex h-full flex-col overflow-hidden">
      <div className={`flex min-h-0 flex-1 ${isMobile ? "flex-col" : "flex-row"}`}>
        <div className="relative min-h-0 min-w-0 flex-1" style={graphViewportStyle}>
          {(effectiveMode === "friends" && friendList.length === 0) || (effectiveMode === "all_content" && socialAccountCount === 0 && friendList.length === 0) ? (
            renderGraphEmptyState()
          ) : (
            <FriendGraph
              ref={graphRef}
              persons={friendPersons}
              accounts={accounts}
              feedItems={feedItems}
              mode={effectiveMode}
              selectedPersonId={selectedPerson?.id ?? null}
              selectedAccountId={selectedAccount?.id ?? null}
              suggestionsByAccount={suggestionsByAccount}
              onSelectPerson={(person) => handleSelectPerson(person, false)}
              onSelectAccount={(account) => handleSelectAccount(account, false)}
              onLinkAccountToPerson={handleLinkAccountToPerson}
              themeId={themeId}
            />
          )}
        </div>

        {!isMobile && (
          <div
            className="theme-resize-gap-handle w-3 shrink-0 self-end"
            style={{ height: "calc(100% - var(--feed-card-gap, 8px))" }}
            onMouseDown={handleSidebarDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize friends sidebar"
          />
        )}

        {isMobile ? (
          <aside
            data-testid="friends-sidebar"
            className="theme-dialog-divider h-[46dvh] w-full overflow-hidden border-t bg-[color:color-mix(in_oklab,var(--theme-bg-deep)_88%,transparent)] backdrop-blur-xl"
          >
            {activeSidebar}
          </aside>
        ) : (
          <div
            data-testid="friends-sidebar-shell"
            className="flex shrink-0 overflow-hidden"
            style={{
              width: `${sidebarWidth}px`,
              paddingTop: "var(--feed-card-gap, 8px)",
            }}
          >
            <aside
              data-testid="friends-sidebar"
              className="theme-floating-panel flex h-full min-h-0 w-full flex-col overflow-hidden"
              style={{ width: px(sidebarWidth) }}
            >
              {activeSidebar}
            </aside>
          </div>
        )}
      </div>

      {editorState ? (
        <FriendEditor
          existing={editorState.kind === "edit" ? friendsById[editorState.personId] ?? null : null}
          draft={editorState.kind === "new" ? editorState.draft ?? null : null}
          onSave={handleSave}
          onDelete={editorState.kind === "edit" ? handleDelete : undefined}
          onCancel={() => setEditorState(null)}
        />
      ) : null}
    </div>
  );
}
