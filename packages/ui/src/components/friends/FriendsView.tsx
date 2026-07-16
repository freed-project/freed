import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  Account,
  DeviceContact,
  FeedItem,
  Friend,
  FriendCandidateSuggestion,
  FriendCandidateConfidence,
  FriendSource,
  Person,
  ReachOutLog,
} from "@freed/shared";
import { formatDistanceToNow } from "date-fns";
import { buildFriendCandidateSuggestions, isInReconnectZone } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { FriendGraphHandle } from "./FriendGraph.js";
import { FriendAvatar } from "./FriendAvatar.js";
import { FriendGraph } from "./FriendGraph.js";
import { FriendDetailPanel } from "./FriendDetailPanel.js";
import { AccountDetailPanel } from "./AccountDetailPanel.js";
import { FriendEditor } from "./FriendEditor.js";
import { ChannelAvatar } from "../ChannelAvatar.js";
import { SearchField } from "../SearchField.js";
import { toast } from "../Toast.js";
import { UsersIcon, MapPinIcon } from "../icons.js";
import {
  buildFriendOverviewEntries,
  buildFriendsById,
  buildFriendsWorkspaceIndexes,
  friendFromPersonWithIndexes,
  filterAndSortFriendOverview,
  type FriendOverviewEntry,
  type FriendOverviewFilter,
  type FriendOverviewSort,
} from "../../lib/friends-workspace.js";
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";
import {
  buildAccountLinkSuggestionGroups,
  type AccountLinkSuggestion,
} from "../../lib/account-link-suggestions.js";
import { accountSubtitle, accountTitle, providerLabel } from "../../lib/account-labels.js";
import { buildIdentityGraphActivitySummaries } from "../../lib/identity-graph-activity-summary.js";
import { px } from "../layout/layoutConstants.js";
import { useDeviceDisplayPreferences } from "../../lib/device-display-preferences.js";
import {
  applyDeviceGraphLayout,
  setDeviceAccountGraphPosition,
  setDevicePersonGraphPosition,
  useDeviceGraphLayout,
} from "../../lib/device-graph-layout.js";

const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 400;

const FILTER_OPTIONS: Array<{ id: FriendOverviewFilter; label: string }> = [
  { id: "need_outreach", label: "Need outreach" },
  { id: "no_contact", label: "No contact logged" },
  { id: "close_friends", label: "Fam" },
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
const FRIEND_OVERVIEW_ROW_ESTIMATE = 104;
const MAP_SURFACE_COMMIT_RETRY_MS = 150;

type RelationshipTierLevel = 1 | 3 | 5;

const RELATIONSHIP_TIER_OPTIONS: Array<{ level: RelationshipTierLevel; label: string }> = [
  { level: 1, label: "Followed" },
  { level: 3, label: "Friends" },
  { level: 5, label: "Fam" },
];

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function personName(person: Pick<Person, "name"> | null | undefined): string {
  return safeText(person?.name, "Unnamed friend");
}

type EditorState =
  | { kind: "new"; draft?: Partial<Friend> | null }
  | { kind: "edit"; personId: string }
  | null;

interface FriendsViewProps {
  friendsSidebarOpen: boolean;
  onFriendsSidebarOpenChange: (open: boolean) => void;
  mobileSurface: "graph" | "details";
}

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

function relationshipTierLevelForPerson(person: Pick<Person, "relationshipStatus" | "careLevel">): RelationshipTierLevel {
  if (person.relationshipStatus !== "friend") return 1;
  return person.careLevel >= 5 ? 5 : 3;
}

function relationshipTierLabelForPerson(person: Pick<Person, "relationshipStatus" | "careLevel">): string {
  return RELATIONSHIP_TIER_OPTIONS.find((option) => option.level === relationshipTierLevelForPerson(person))?.label ?? "Followed";
}

function relationshipPatchForLevel(level: RelationshipTierLevel): Pick<Person, "relationshipStatus" | "careLevel"> {
  if (level === 1) {
    return { relationshipStatus: "connection", careLevel: 1 };
  }
  return { relationshipStatus: "friend", careLevel: level };
}

function RelationshipTierBadge({ person }: { person: Pick<Person, "relationshipStatus" | "careLevel"> }) {
  return (
    <span className="theme-chip rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
      {relationshipTierLabelForPerson(person)}
    </span>
  );
}

function RelationshipTierControl({
  value,
  onChange,
}: {
  value: RelationshipTierLevel;
  onChange: (level: RelationshipTierLevel) => void;
}) {
  const [dragOverLevel, setDragOverLevel] = useState<RelationshipTierLevel | null>(null);

  useEffect(() => {
    const handleDragOver = (event: Event) => {
      const detail = (event as CustomEvent<{ level: RelationshipTierLevel | null }>).detail;
      setDragOverLevel(detail?.level ?? null);
    };
    window.addEventListener("freed-friend-tier-dragover", handleDragOver);
    return () => window.removeEventListener("freed-friend-tier-dragover", handleDragOver);
  }, []);

  return (
    <div className="theme-dialog-divider border-b px-4 py-4" data-testid="relationship-tier-control">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
          Relationship
        </p>
        <span className="text-xs font-medium text-[color:var(--theme-text-primary)]">
          {RELATIONSHIP_TIER_OPTIONS.find((option) => option.level === value)?.label ?? "Followed"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-[color:var(--theme-bg-muted)] p-1">
        {RELATIONSHIP_TIER_OPTIONS.map((option) => {
          const active = option.level === value;
          const dragTarget = option.level === dragOverLevel;
          return (
            <button
              key={option.level}
              type="button"
              data-friend-tier-drop-value={option.level}
              onClick={() => onChange(option.level)}
              className={`rounded-xl px-2 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "bg-[color:var(--theme-bg-card)] text-[color:var(--theme-text-primary)] shadow-[var(--theme-glow-sm)]"
                  : "text-[color:var(--theme-text-muted)] hover:bg-[color:var(--theme-bg-card-hover)] hover:text-[color:var(--theme-text-primary)]"
              } ${dragTarget ? "ring-2 ring-[color:var(--theme-accent-secondary)]" : ""}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
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
          name={safeText(entry.friend.name, "Unnamed friend")}
          avatarUrl={avatarUrl}
          size={40}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
              {safeText(entry.friend.name, "Unnamed friend")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <RelationshipTierBadge person={entry.friend} />
              <CareDots level={entry.friend.careLevel} />
            </div>
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

function CompactDetailCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-end px-4">
      <div
        data-testid="friends-collapsed-selection-card"
        className="pointer-events-auto theme-floating-panel w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl px-4 py-3 shadow-2xl shadow-black/30"
      >
        {children}
      </div>
    </div>
  );
}

function evidenceIdLabel(itemId: string): string {
  return `...${itemId.slice(-8)}`;
}

function friendSuggestionSignalLabel(suggestion: FriendCandidateSuggestion): string {
  const entries = Object.entries(suggestion.signalCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 4);
  if (entries.length === 0) return "No classified signals yet";
  return entries
    .map(([signal, count]) => `${signal.replace(/_/g, " ")} ${Number(count).toLocaleString()}`)
    .join(", ");
}

function FriendSuggestionEvidence({
  suggestion,
  onPromoteToFriend,
  onPromoteToFam,
  onDismiss,
}: {
  suggestion: FriendCandidateSuggestion;
  onPromoteToFriend?: () => void;
  onPromoteToFam?: () => void;
  onDismiss: (suggestionId: string) => void;
}) {
  return (
    <div className="theme-dialog-divider border-b px-4 py-4" data-testid="friend-candidate-detail">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
            Suggested friend
          </p>
          <p className="mt-1 text-sm font-medium text-[color:var(--theme-text-primary)]">
            Score {suggestion.score.toLocaleString()}, {suggestion.confidence} confidence
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onDismiss(suggestion.id)}
            className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
          >
            Dismiss
          </button>
          {onPromoteToFriend ? (
            <button
              type="button"
              onClick={onPromoteToFriend}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Promote to friend
            </button>
          ) : null}
          {onPromoteToFam ? (
            <button
              type="button"
              onClick={onPromoteToFam}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Promote to Fam
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestion.reasons.map((reason) => (
          <span
            key={reason.code}
            className="theme-chip rounded-full px-2 py-0.5 text-[11px]"
          >
            {reason.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-[color:var(--theme-text-muted)]">
        {friendSuggestionSignalLabel(suggestion)}
      </p>
      {suggestion.sampleItemIds.length > 0 ? (
        <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
          Evidence {suggestion.sampleItemIds.map(evidenceIdLabel).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FriendCandidateRow({
  suggestion,
  selected,
  onSelect,
  onDismiss,
  onPromoteToFriend,
  onPromoteToFam,
}: {
  suggestion: FriendCandidateSuggestion;
  selected: boolean;
  onSelect: () => void;
  onDismiss: (suggestionId: string) => void;
  onPromoteToFriend: () => void;
  onPromoteToFam: () => void;
}) {
  const lastActivity = suggestion.lastActivityAt
    ? formatDistanceToNow(suggestion.lastActivityAt, { addSuffix: true })
    : "No recent posts";
  return (
    <div
      data-testid="friend-candidate-suggestion"
      className={`theme-card-soft rounded-2xl px-3 py-3 transition-colors ${
        selected
          ? "border-[color:var(--theme-border-strong)] bg-[color:var(--theme-bg-card-hover)]"
          : ""
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
              {suggestion.displayName}
            </p>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              Score {suggestion.score.toLocaleString()}, {lastActivity}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
            suggestion.confidence === "high"
              ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
              : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
          }`}>
            {suggestion.confidence}
          </span>
        </div>
        <p className="mt-2 line-clamp-1 text-xs text-[color:var(--theme-text-muted)]">
          {suggestion.reasons.map((reason) => reason.label).join(", ")}
        </p>
      </button>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onPromoteToFriend}
          className="btn-primary rounded-lg px-3 py-1.5 text-xs"
        >
          Promote to friend
        </button>
        <button
          type="button"
          onClick={onPromoteToFam}
          className="btn-primary rounded-lg px-3 py-1.5 text-xs"
        >
          Promote to Fam
        </button>
      </div>
    </div>
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

function friendDraftFromAccount(account: Account, careLevel: 3 | 5 = 3): Partial<Friend> {
  return {
    name: account.displayName ?? account.handle ?? account.externalId,
    avatarUrl: account.avatarUrl,
    relationshipStatus: "friend",
    careLevel,
    sources: account.kind === "social" ? [accountToFriendSource(account)] : [],
  };
}

export function FriendsView({
  friendsSidebarOpen,
  onFriendsSidebarOpenChange,
  mobileSurface,
}: FriendsViewProps) {
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const feeds = useAppStore((s) => s.feeds);
  const items = useAppStore((s) => s.items);
  const addPerson = useAppStore((s) => s.addPerson);
  const updatePerson = useAppStore((s) => s.updatePerson);
  const removePerson = useAppStore((s) => s.removePerson);
  const addAccount = useAppStore((s) => s.addAccount);
  const updateAccount = useAppStore((s) => s.updateAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const linkAccountToPerson = useAppStore((s) => s.linkAccountToPerson);
  const logReachOut = useAppStore((s) => s.logReachOut);
  const selectedPersonId = useAppStore((s) => s.selectedPersonId);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openMapForPerson = useAppStore((s) => s.openMapForPerson);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const display = useAppStore((s) => s.preferences.display);
  const [deviceDisplay, setDeviceDisplay] = useDeviceDisplayPreferences();
  const deviceGraphLayout = useDeviceGraphLayout();
  const friendSuggestionPreferences = useAppStore((s) => s.preferences.friendSuggestions);
  const savedSidebarWidth = Math.min(
    MAX_SIDEBAR_WIDTH,
    deviceDisplay.friendsSidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
  );
  const themeId = display.themeId;
  const effectiveMode = deviceDisplay.friendsMode;
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [editorState, setEditorState] = useState<EditorState>(null);
  const [openingSyncModal, setOpeningSyncModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FriendOverviewFilter>>(new Set());
  const [sortBy, setSortBy] = useState<FriendOverviewSort>("recent_activity");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedSidebarWidth, setCommittedSidebarWidth] = useState(savedSidebarWidth);

  const graphRef = useRef<FriendGraphHandle>(null);
  const friendOverviewScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef(false);
  const sidebarDragCleanup = useRef<(() => void) | null>(null);
  const isMobile = useIsMobile();

  const { googleContacts } = usePlatform();
  const contactSync = useContactSyncContext();

  const feedItems = useMemo(() => {
    const map: Record<string, FeedItem> = {};
    for (const item of items) map[item.globalId] = item;
    return map;
  }, [items]);
  const graphActivitySummaries = useMemo(
    () => buildIdentityGraphActivitySummaries(feedItems),
    [feedItems],
  );
  const friendsWorkspaceIndexes = useMemo(
    () => buildFriendsWorkspaceIndexes(accounts, feedItems),
    [accounts, feedItems],
  );
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
        .sort((left, right) => personName(left).localeCompare(personName(right))),
    [persons],
  );
  const allPersons = useMemo(
    () => Object.values(persons).sort((left, right) => personName(left).localeCompare(personName(right))),
    [persons],
  );
  const graphEntities = useMemo(
    () => applyDeviceGraphLayout(persons, accounts, deviceGraphLayout),
    [accounts, deviceGraphLayout, persons],
  );
  const graphPersons = useMemo(
    () => Object.values(graphEntities.persons)
      .sort((left, right) => personName(left).localeCompare(personName(right))),
    [graphEntities.persons],
  );
  const friendsById = useMemo<Record<string, Friend>>(
    () => buildFriendsById(friendPersons, friendsWorkspaceIndexes),
    [friendPersons, friendsWorkspaceIndexes],
  );
  const friendList = useMemo(() => Object.values(friendsById), [friendsById]);
  const socialAccountCount = useMemo(
    () => Object.values(accounts).filter((account) => account.kind === "social").length,
    [accounts],
  );

  const selectedPerson = selectedPersonId ? persons[selectedPersonId] ?? null : null;
  const selectedFriend = selectedPerson ? friendFromPersonWithIndexes(selectedPerson, friendsWorkspaceIndexes) : null;
  const selectedAccount = selectedAccountId ? accounts[selectedAccountId] ?? null : null;

  const reconnectCount = useMemo(
    () => friendPersons.filter((person) => isInReconnectZone(person)).length,
    [friendPersons]
  );

  const accountLinkSuggestionGroups = useMemo(
    () => buildAccountLinkSuggestionGroups(persons, accounts),
    [accounts, persons],
  );
  const suggestionsByAccount = useMemo(
    () => accountLinkSuggestionGroups.byAccount,
    [accountLinkSuggestionGroups],
  );
  const suggestionsByPerson = useMemo(
    () => accountLinkSuggestionGroups.byPerson,
    [accountLinkSuggestionGroups],
  );
  const friendCandidateSuggestions = useMemo(
    () =>
      buildFriendCandidateSuggestions({
        persons: allPersons,
        accounts,
        feedItems: items,
        contactSuggestions: contactSync.syncState.pendingSuggestions,
        preferences: friendSuggestionPreferences,
        limit: 10,
      }),
    [accounts, allPersons, contactSync.syncState.pendingSuggestions, friendSuggestionPreferences, items],
  );
  const friendCandidateByPerson = useMemo(() => {
    const next = new Map<string, FriendCandidateSuggestion>();
    for (const suggestion of friendCandidateSuggestions) {
      if (suggestion.personId && !next.has(suggestion.personId)) {
        next.set(suggestion.personId, suggestion);
      }
    }
    return next;
  }, [friendCandidateSuggestions]);
  const friendCandidateByAccount = useMemo(() => {
    const next = new Map<string, FriendCandidateSuggestion>();
    for (const suggestion of friendCandidateSuggestions) {
      for (const accountId of suggestion.accountIds) {
        if (!next.has(accountId)) {
          next.set(accountId, suggestion);
        }
      }
    }
    return next;
  }, [friendCandidateSuggestions]);
  const friendSuggestionStrengthByPerson = useMemo(() => {
    const next = new Map<string, FriendCandidateConfidence>();
    for (const suggestion of friendCandidateSuggestions) {
      if (suggestion.personId) {
        next.set(suggestion.personId, suggestion.confidence);
      }
    }
    return next;
  }, [friendCandidateSuggestions]);
  const friendSuggestionStrengthByAccount = useMemo(() => {
    const next = new Map<string, FriendCandidateConfidence>();
    for (const suggestion of friendCandidateSuggestions) {
      for (const accountId of suggestion.accountIds) {
        next.set(accountId, suggestion.confidence);
      }
    }
    return next;
  }, [friendCandidateSuggestions]);

  const overviewEntries = useMemo(
    () => buildFriendOverviewEntries(friendsById, feedItems, { indexes: friendsWorkspaceIndexes }),
    [feedItems, friendsById, friendsWorkspaceIndexes]
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
  const selectedPersonFriendSuggestion = selectedPerson
    ? friendCandidateByPerson.get(selectedPerson.id) ?? null
    : null;
  const selectedAccountFriendSuggestion = selectedAccount
    ? friendCandidateByAccount.get(selectedAccount.id) ?? null
    : null;
  const selectedOverviewEntry = useMemo(
    () =>
      selectedPerson
        ? overviewEntries.find((entry) => entry.friend.id === selectedPerson.id) ?? null
        : null,
    [overviewEntries, selectedPerson],
  );
  const friendOverviewVirtualizer = useVirtualizer({
    count: filteredOverviewEntries.length,
    getScrollElement: () => friendOverviewScrollRef.current,
    estimateSize: () => FRIEND_OVERVIEW_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => filteredOverviewEntries[index]?.friend.id ?? index,
  });

  useEffect(() => {
    friendOverviewVirtualizer.measure();
  }, [filteredOverviewEntries.length, friendOverviewVirtualizer, searchQuery, sortBy]);

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
    setCommittedSidebarWidth(savedSidebarWidth);
  }, [dragWidth, savedSidebarWidth]);

  const sidebarWidth = dragWidth ?? committedSidebarWidth;
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

  const handleOpenMapForPerson = useCallback((personId: string) => {
    flushSync(() => {
      openMapForPerson(personId);
    });

    window.setTimeout(() => {
      if (document.querySelector('[data-testid="map-surface"]')) return;
      if (!document.querySelector('[data-testid="friends-sidebar"]')) return;

      setActiveView("friends");
      window.requestAnimationFrame(() => {
        openMapForPerson(personId);
      });
    }, MAP_SURFACE_COMMIT_RETRY_MS);
  }, [openMapForPerson, setActiveView]);

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
      await linkAccountToPerson(accountId, personId);
      setSelectedPerson(personId);
    },
    [linkAccountToPerson, setSelectedPerson],
  );

  const handlePinPersonPosition = useCallback(
    (personId: string, x: number, y: number) => {
      if (!setDevicePersonGraphPosition(personId, Math.round(x), Math.round(y))) {
        toast.error("Freed could not save this graph position on this device.");
      }
    },
    [],
  );

  const handlePinAccountPosition = useCallback(
    (accountId: string, x: number, y: number) => {
      if (!setDeviceAccountGraphPosition(accountId, Math.round(x), Math.round(y))) {
        toast.error("Freed could not save this graph position on this device.");
      }
    },
    [],
  );

  const handleSetPersonRelationshipLevel = useCallback(async (person: Person, level: RelationshipTierLevel) => {
    await updatePerson(person.id, {
      ...relationshipPatchForLevel(level),
      updatedAt: Date.now(),
    });
    setSelectedPerson(person.id);
  }, [setSelectedPerson, updatePerson]);

  const handlePromoteSelectedAccount = useCallback(async (level: 3 | 5 = 3) => {
    if (!selectedAccount) return;
    const linkedPerson = selectedAccount.personId ? persons[selectedAccount.personId] ?? null : null;
    if (linkedPerson) {
      await handleSetPersonRelationshipLevel(linkedPerson, level);
      return;
    }
    setEditorState({ kind: "new", draft: friendDraftFromAccount(selectedAccount, level) });
  }, [handleSetPersonRelationshipLevel, persons, selectedAccount]);

  const handlePromoteSelectedPerson = useCallback(async (level: 3 | 5 = 3) => {
    if (!selectedPerson) return;
    await handleSetPersonRelationshipLevel(selectedPerson, level);
  }, [handleSetPersonRelationshipLevel, selectedPerson]);

  const handlePromoteFriendSuggestion = useCallback(async (
    suggestion: FriendCandidateSuggestion,
    level: 3 | 5,
  ) => {
    if (suggestion.personId) {
      const person = persons[suggestion.personId];
      if (person) {
        await handleSetPersonRelationshipLevel(person, level);
        return;
      }
    }
    const account = suggestion.accountIds.map((accountId) => accounts[accountId]).find(Boolean);
    if (!account) return;
    const linkedPerson = account.personId ? persons[account.personId] ?? null : null;
    if (linkedPerson) {
      await handleSetPersonRelationshipLevel(linkedPerson, level);
      return;
    }
    setSelectedAccount(account.id);
    setEditorState({ kind: "new", draft: friendDraftFromAccount(account, level) });
  }, [accounts, handleSetPersonRelationshipLevel, persons, setSelectedAccount]);

  const handleDropGraphNodeToRelationshipTier = useCallback(async ({
    personId,
    accountId,
    level,
  }: {
    personId?: string;
    accountId?: string;
    level: RelationshipTierLevel;
  }) => {
    if (personId) {
      const person = persons[personId];
      if (person) {
        await handleSetPersonRelationshipLevel(person, level);
      }
      return;
    }

    if (!accountId || level === 1) return;
    const account = accounts[accountId];
    if (!account) return;
    const linkedPerson = account.personId ? persons[account.personId] ?? null : null;
    if (linkedPerson) {
      await handleSetPersonRelationshipLevel(linkedPerson, level);
      return;
    }
    setSelectedAccount(account.id);
    setEditorState({ kind: "new", draft: friendDraftFromAccount(account, level) });
  }, [accounts, handleSetPersonRelationshipLevel, persons, setSelectedAccount]);

  const handleDismissFriendSuggestion = useCallback((suggestionId: string) => {
    const current = friendSuggestionPreferences?.dismissedSuggestionIds ?? [];
    if (current.includes(suggestionId)) return;
    void updatePreferences({
      friendSuggestions: {
        dismissedSuggestionIds: [...current, suggestionId],
      },
    } as Parameters<typeof updatePreferences>[0]).catch(() => {
      toast.error("Freed could not dismiss that suggestion.");
    });
  }, [friendSuggestionPreferences, updatePreferences]);

  const handleSelectFriendCandidate = useCallback((suggestion: FriendCandidateSuggestion) => {
    if (suggestion.personId) {
      const person = persons[suggestion.personId];
      if (person) {
        handleSelectPerson(person, true);
        return;
      }
    }
    const account = suggestion.accountIds.map((accountId) => accounts[accountId]).find(Boolean);
    if (account) {
      handleSelectAccount(account, true);
    }
  }, [accounts, handleSelectAccount, handleSelectPerson, persons]);

  const handleOpenSyncModal = useCallback(async () => {
    setOpeningSyncModal(true);
    try {
      await contactSync.openReview();
    } finally {
      setOpeningSyncModal(false);
    }
  }, [contactSync]);

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

  useEffect(() => () => {
    sidebarDragCleanup.current?.();
    sidebarDragCleanup.current = null;
  }, []);

  const handleSidebarDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    sidebarDragCleanup.current?.();
    isDraggingSidebar.current = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let latestWidth = startWidth;
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizeHandle.setPointerCapture?.(pointerId);

    const nextWidthFromClientX = (clientX: number) =>
      Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth - (clientX - startX)),
      );

    const cleanup = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      try {
        resizeHandle.releasePointerCapture?.(pointerId);
      } catch {
        // The browser may already have released capture after pointerup.
      }
      if (sidebarDragCleanup.current === cleanup) {
        sidebarDragCleanup.current = null;
      }
    };

    const finishDrag = (finalWidth: number) => {
      isDraggingSidebar.current = false;
      setDragWidth(null);
      if (setDeviceDisplay({ friendsSidebarWidth: finalWidth })) {
        setCommittedSidebarWidth(finalWidth);
      } else {
        toast.error("Freed could not save the sidebar width on this device.");
      }
      cleanup();
    };

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!isDraggingSidebar.current) return;
      latestWidth = nextWidthFromClientX(moveEvent.clientX);
      setDragWidth(latestWidth);
    }

    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      finishDrag(nextWidthFromClientX(upEvent.clientX));
    }

    function onCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      finishDrag(latestWidth);
    }

    function onBlur() {
      isDraggingSidebar.current = false;
      setDragWidth(null);
      cleanup();
    }

    sidebarDragCleanup.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
  }, [isMobile, setDeviceDisplay, sidebarWidth]);

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
            {googleContacts ? (
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
            ) : pendingMatchCount > 0 ? (
              <span className="rounded-full bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.18)] px-2 py-1 text-[10px] font-semibold text-[color:var(--theme-text-primary)]">
                {pendingMatchCount.toLocaleString()} contact review
              </span>
            ) : null}
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
            className="theme-input theme-select min-w-[10.75rem] rounded-lg py-1.5 pl-2.5 pr-8 text-xs"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        ref={friendOverviewScrollRef}
        data-testid="friends-overview-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {friendCandidateSuggestions.length > 0 ? (
          <div className="mb-5" data-testid="friend-candidate-suggestions">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
                  Suggested friends
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {friendCandidateSuggestions.map((suggestion) => (
                <FriendCandidateRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  selected={
                    (suggestion.personId !== undefined && suggestion.personId === selectedPerson?.id) ||
                    (selectedAccount?.id !== undefined && suggestion.accountIds.includes(selectedAccount.id))
                  }
                  onSelect={() => handleSelectFriendCandidate(suggestion)}
                  onDismiss={handleDismissFriendSuggestion}
                  onPromoteToFriend={() => void handlePromoteFriendSuggestion(suggestion, 3)}
                  onPromoteToFam={() => void handlePromoteFriendSuggestion(suggestion, 5)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {filteredOverviewEntries.length === 0 ? (
          <div className="theme-panel-muted rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">No friends match those filters</p>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">Try clearing a filter or changing the search query.</p>
          </div>
        ) : (
          <div
            data-testid="friends-overview-list"
            className="relative"
            style={{ height: friendOverviewVirtualizer.getTotalSize() }}
          >
            {friendOverviewVirtualizer.getVirtualItems().map((virtualItem) => {
              const entry = filteredOverviewEntries[virtualItem.index];
              if (!entry) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={friendOverviewVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  data-testid="friend-overview-virtual-row"
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <FriendListRow
                    entry={entry}
                    selected={entry.friend.id === selectedPerson?.id}
                    onSelect={() => handleSelectPerson(persons[entry.friend.id] ?? friendPersons[0], true)}
                  />
                </div>
              );
            })}
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
            <h2 className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">{personName(selectedPerson)}</h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              {selectedPerson ? relationshipTierLabelForPerson(selectedPerson) : "Followed"}
            </p>
          </div>
        </div>

        {selectedPerson && (
          <button
            type="button"
            onClick={() => setEditorState({ kind: "edit", personId: selectedPerson.id })}
            className={BUTTON_CHROME}
          >
            Edit
          </button>
        )}
      </div>

      {selectedPerson ? (
        <RelationshipTierControl
          value={relationshipTierLevelForPerson(selectedPerson)}
          onChange={(level) => void handleSetPersonRelationshipLevel(selectedPerson, level)}
        />
      ) : null}

      {selectedPersonFriendSuggestion ? (
        <FriendSuggestionEvidence
          suggestion={selectedPersonFriendSuggestion}
          onPromoteToFriend={() => void handlePromoteSelectedPerson(3)}
          onPromoteToFam={() => void handlePromoteSelectedPerson(5)}
          onDismiss={handleDismissFriendSuggestion}
        />
      ) : null}

      {selectedPerson && selectedPersonSuggestions.length > 0 ? (
        <div className="theme-dialog-divider border-b px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
                Suggested channels
              </p>
              <p className="mt-1 text-sm text-[color:var(--theme-text-primary)]">
                Link likely accounts to {personName(selectedPerson)}.
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
              handleOpenMapForPerson(selectedPerson.id);
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
        friendSuggestion={selectedAccountFriendSuggestion}
        persons={allPersons}
        feedItems={selectedAccountFeedItems}
        onBack={handleClearSelection}
        onPromoteToFriend={() => void handlePromoteSelectedAccount(3)}
        onPromoteToFam={() => void handlePromoteSelectedAccount(5)}
        onDismissFriendSuggestion={handleDismissFriendSuggestion}
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

  const renderCollapsedSelectionCard = () => {
    if (selectedAccount) {
      const linkedPerson = selectedAccount.personId ? persons[selectedAccount.personId] ?? null : null;
      return (
        <CompactDetailCard>
          <div className="flex items-start gap-3">
            <ChannelAvatar
              name={accountTitle(selectedAccount)}
              avatarUrl={selectedAccount.avatarUrl}
              size={48}
              className="text-lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">
                    {accountTitle(selectedAccount)}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                    {providerLabel(selectedAccount.provider)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="btn-secondary rounded-lg p-1.5"
                  aria-label="Clear selection"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <p className="mt-2 text-sm text-[color:var(--theme-text-secondary)]">
                {accountSubtitle(selectedAccount)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[color:var(--theme-text-muted)]">
                <span>{selectedAccountFeedItems.length.toLocaleString()} captured post{selectedAccountFeedItems.length === 1 ? "" : "s"}</span>
                <span>•</span>
                <span>
                  {linkedPerson ? `Linked to ${personName(linkedPerson)}` : "Not linked yet"}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            {linkedPerson ? (
              <button
                type="button"
                onClick={() => handleSelectPerson(linkedPerson)}
                className={BUTTON_CHROME}
              >
                Open identity
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handlePromoteSelectedAccount(3)}
                className={BUTTON_CHROME}
              >
                Promote to friend
              </button>
            )}
            <button
              type="button"
              onClick={() => onFriendsSidebarOpenChange(true)}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Open details
            </button>
          </div>
        </CompactDetailCard>
      );
    }

    if (selectedPerson && selectedFriend) {
      const avatarUrl = resolveFriendAvatarUrl(
        selectedFriend,
        selectedOverviewEntry?.items.map((item) => item.author.avatarUrl) ?? [],
      );
      const lastPostLabel = selectedOverviewEntry?.lastPostAt
        ? formatDistanceToNow(selectedOverviewEntry.lastPostAt, { addSuffix: true })
        : "No posts yet";
      const lastContactLabel = selectedOverviewEntry?.lastContactAt
        ? formatDistanceToNow(selectedOverviewEntry.lastContactAt, { addSuffix: true })
        : "Never contacted";

      return (
        <CompactDetailCard>
          <div className="flex items-start gap-3">
            <FriendAvatar
              name={selectedFriend.name}
              avatarUrl={avatarUrl}
              size={48}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">
                    {selectedFriend.name}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                    {relationshipTierLabelForPerson(selectedPerson)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="btn-secondary rounded-lg p-1.5"
                  aria-label="Clear selection"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="mt-2">
                <CareDots level={selectedFriend.careLevel} />
              </div>
              {selectedFriend.bio ? (
                <p className="mt-2 line-clamp-2 text-sm text-[color:var(--theme-text-secondary)]">
                  {selectedFriend.bio}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[color:var(--theme-text-muted)]">
                <span>{lastPostLabel}</span>
                <span>•</span>
                <span>{lastContactLabel}</span>
                <span>•</span>
                <span>{selectedFriend.sources.length.toLocaleString()} channel{selectedFriend.sources.length === 1 ? "" : "s"}</span>
                {selectedOverviewEntry?.hasLocation ? (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-[color:var(--theme-accent-secondary)]">
                      <MapPinIcon className="h-3 w-3" />
                      Has location
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditorState({ kind: "edit", personId: selectedPerson.id })}
              className={BUTTON_CHROME}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onFriendsSidebarOpenChange(true)}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Open details
            </button>
          </div>
        </CompactDetailCard>
      );
    }

    return null;
  };

  const activeSidebar = selectedAccount
    ? renderSelectedAccountSidebar()
    : selectedPerson
      ? renderSelectedPersonSidebar()
      : renderOverviewSidebar();
  const showGraphSurface = !isMobile || mobileSurface === "graph";
  const showDesktopSidebar = !isMobile && friendsSidebarOpen;
  const showMobileSidebar = isMobile && mobileSurface === "details";
  const showCollapsedSelectionCard =
    !isMobile && !friendsSidebarOpen && (!!selectedPerson || !!selectedAccount);

  return (
    <div className="app-theme-shell flex h-full flex-col overflow-hidden">
      <div
        className={`relative flex min-h-0 flex-1 ${isMobile ? "flex-col pt-[var(--feed-card-gap,8px)]" : "flex-row"}`}
      >
        {showGraphSurface ? (
          <div className="relative min-h-0 min-w-0 flex-1 overflow-visible">
            {(effectiveMode === "friends" && friendList.length === 0) || (effectiveMode === "all_content" && socialAccountCount === 0 && friendList.length === 0) ? (
              renderGraphEmptyState()
            ) : (
              <FriendGraph
                ref={graphRef}
                persons={graphPersons}
                accounts={graphEntities.accounts}
                feeds={feeds}
                activitySummaries={graphActivitySummaries}
                mode={effectiveMode}
                selectedPersonId={selectedPerson?.id ?? null}
                selectedAccountId={selectedAccount?.id ?? null}
                onSelectPerson={(person) => handleSelectPerson(person, false)}
                onSelectAccount={(account) => handleSelectAccount(account, false)}
                onClearSelection={showCollapsedSelectionCard ? handleClearSelection : undefined}
                onLinkAccountToPerson={handleLinkAccountToPerson}
                onPinPersonPosition={handlePinPersonPosition}
                onPinAccountPosition={handlePinAccountPosition}
                onDropNodeToRelationshipTier={handleDropGraphNodeToRelationshipTier}
                friendSuggestionStrengthByPerson={friendSuggestionStrengthByPerson}
                friendSuggestionStrengthByAccount={friendSuggestionStrengthByAccount}
                themeId={themeId}
              />
            )}
          </div>
        ) : null}

        {showDesktopSidebar && (
          <div
            className="theme-resize-gap-handle w-3 shrink-0 self-stretch"
            onPointerDown={handleSidebarDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize friends sidebar"
          />
        )}

        {showMobileSidebar ? (
          <div
            data-testid="friends-sidebar-shell"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <aside
              data-testid="friends-sidebar"
              className="theme-floating-panel flex h-full min-h-0 w-full flex-col overflow-hidden"
            >
              {activeSidebar}
            </aside>
          </div>
        ) : showDesktopSidebar ? (
          <div
            data-testid="friends-sidebar-shell"
            className="flex shrink-0 overflow-hidden"
            style={{ width: `${sidebarWidth}px` }}
          >
            <aside
              data-testid="friends-sidebar"
              className="theme-floating-panel flex h-full min-h-0 w-full flex-col overflow-hidden"
              style={{ width: px(sidebarWidth) }}
            >
              {activeSidebar}
            </aside>
          </div>
        ) : null}

        {showCollapsedSelectionCard ? renderCollapsedSelectionCard() : null}
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
