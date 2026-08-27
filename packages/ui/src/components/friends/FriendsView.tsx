import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  Account,
  DeviceContact,
  Friend,
  FriendCandidateSuggestion,
  FriendSource,
  MapMode,
  Person,
  ReachOutLog,
} from "@freed/shared";
import { formatDistanceToNow } from "date-fns";
import { compareUtf8Binary } from "@freed/shared";
import {
  readLibraryCoreRssFeedV1,
  type LibraryCoreFriendsDirectoryRowV1,
  type LibraryCoreNormalizedQueryExecutor,
} from "@freed/shared/library-core";
import {
  useAppStore,
  usePlatform,
  type LibraryFriendsSource,
  type LibraryPersonTimelineRequest,
} from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useLibraryFriendsRows } from "../../hooks/useLibraryFriendsRows.js";
import {
  useLibraryAccountDetail,
  useLibraryFriendDetail,
  useLibraryPersonDetail,
} from "../../hooks/useLibraryIdentityDetail.js";
import { useLibraryFacetSummary } from "../../hooks/useLibraryFacetSummary.js";
import { useLibraryFriendsDirectory } from "../../hooks/useLibraryFriendsDirectory.js";
import { useLibraryAccountLinkCandidates } from "../../hooks/useLibraryAccountLinkCandidates.js";
import { useLibraryFriendCandidateReview } from "../../hooks/useLibraryFriendCandidateReview.js";
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
  buildFriendOverviewEntriesFromActivity,
  friendActivitySourceKey,
  type FriendOverviewFilter,
  type FriendOverviewSort,
} from "../../lib/friends-workspace.js";
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";
import {
  accountSubtitle,
  accountTitle,
  providerLabel,
} from "../../lib/account-labels.js";
import {
  buildFriendSourceActivityEvidence,
  buildFriendsActivityReadModel,
  createLibraryFriendsGraphRequest,
  friendSourceAccountProvenance,
  type FriendSourceActivityEvidence,
} from "../../lib/friends-library-read-model.js";
import { px } from "../layout/layoutConstants.js";
import { useDeviceDisplayPreferences } from "../../lib/device-display-preferences.js";
import { useAppliedThemeId } from "../../lib/theme.js";

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

const unavailableLibraryCoreQuery: LibraryCoreNormalizedQueryExecutor =
  async () => {
    throw new Error("The bounded SQLite Library query boundary is unavailable");
  };
const NEED_OUTREACH_DIRECTORY_FILTERS = ["need_outreach"] as const;

type RelationshipTierLevel = 1 | 3 | 5;

const RELATIONSHIP_TIER_OPTIONS: Array<{
  level: RelationshipTierLevel;
  label: string;
}> = [
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

function relationshipTierLevelForPerson(
  person: Pick<Person, "relationshipStatus" | "careLevel">,
): RelationshipTierLevel {
  if (person.relationshipStatus !== "friend") return 1;
  return person.careLevel >= 5 ? 5 : 3;
}

function relationshipTierLabelForPerson(
  person: Pick<Person, "relationshipStatus" | "careLevel">,
): string {
  return (
    RELATIONSHIP_TIER_OPTIONS.find(
      (option) => option.level === relationshipTierLevelForPerson(person),
    )?.label ?? "Followed"
  );
}

function relationshipPatchForLevel(
  level: RelationshipTierLevel,
): Pick<Person, "relationshipStatus" | "careLevel"> {
  if (level === 1) {
    return { relationshipStatus: "connection", careLevel: 1 };
  }
  return { relationshipStatus: "friend", careLevel: level };
}

function RelationshipTierBadge({
  person,
}: {
  person: Pick<Person, "relationshipStatus" | "careLevel">;
}) {
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
  const [dragOverLevel, setDragOverLevel] =
    useState<RelationshipTierLevel | null>(null);

  useEffect(() => {
    const handleDragOver = (event: Event) => {
      const detail = (
        event as CustomEvent<{ level: RelationshipTierLevel | null }>
      ).detail;
      setDragOverLevel(detail?.level ?? null);
    };
    window.addEventListener("freed-friend-tier-dragover", handleDragOver);
    return () =>
      window.removeEventListener("freed-friend-tier-dragover", handleDragOver);
  }, []);

  return (
    <div
      className="theme-dialog-divider border-b px-4 py-4"
      data-testid="relationship-tier-control"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
          Relationship
        </p>
        <span className="text-xs font-medium text-[color:var(--theme-text-primary)]">
          {RELATIONSHIP_TIER_OPTIONS.find((option) => option.level === value)
            ?.label ?? "Followed"}
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
  row,
  selected,
  onSelect,
}: {
  row: LibraryCoreFriendsDirectoryRowV1;
  selected: boolean;
  onSelect: () => void;
}) {
  const lastPost = row.latestActivityAt
    ? formatDistanceToNow(row.latestActivityAt, { addSuffix: true })
    : "No posts yet";
  const lastContact = row.lastContactAt
    ? formatDistanceToNow(row.lastContactAt, { addSuffix: true })
    : "Never contacted";
  const avatarUrl = row.latestAvatarUrl ?? row.avatarUrl;

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
          name={safeText(row.name, "Unnamed friend")}
          avatarUrl={avatarUrl}
          size={40}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
              {safeText(row.name, "Unnamed friend")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <RelationshipTierBadge person={row} />
              <CareDots level={row.careLevel as 1 | 2 | 3 | 4 | 5} />
            </div>
          </div>
          {row.bio && (
            <p className="mt-1 line-clamp-2 text-xs text-[color:var(--theme-text-muted)]">
              {row.bio}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--theme-text-muted)]">
            <span>{lastPost}</span>
            <span className="text-[color:var(--theme-text-soft)]">•</span>
            <span>{lastContact}</span>
            {row.hasLocation && (
              <>
                <span className="text-[color:var(--theme-text-soft)]">•</span>
                <span className="inline-flex items-center gap-1 text-[color:var(--theme-accent-secondary)]">
                  <MapPinIcon className="h-3 w-3" />
                  Has location
                </span>
              </>
            )}
            {row.needsOutreach && (
              <>
                <span className="text-[color:var(--theme-text-soft)]">•</span>
                <span className="theme-feedback-text-warning">
                  Needs outreach
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function CompactDetailCard({ children }: { children: ReactNode }) {
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

function friendSuggestionSignalLabel(
  suggestion: FriendCandidateSuggestion,
): string {
  const entries = Object.entries(suggestion.signalCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 4);
  if (entries.length === 0) return "No classified signals yet";
  return entries
    .map(
      ([signal, count]) =>
        `${signal.replace(/_/g, " ")} ${Number(count).toLocaleString()}`,
    )
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
    <div
      className="theme-dialog-divider border-b px-4 py-4"
      data-testid="friend-candidate-detail"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
            Suggested friend
          </p>
          <p className="mt-1 text-sm font-medium text-[color:var(--theme-text-primary)]">
            Score {suggestion.score.toLocaleString()}, {suggestion.confidence}{" "}
            confidence
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
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              suggestion.confidence === "high"
                ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
                : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
            }`}
          >
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
  activity: FriendSourceActivityEvidence | null,
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
    ...friendSourceAccountProvenance(activity, now),
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

function friendDraftFromAccount(
  account: Account,
  careLevel: 3 | 5 = 3,
): Partial<Friend> {
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
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const selectedPersonId = useAppStore((s) => s.selectedPersonId);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openMapForPerson = useAppStore((s) => s.openMapForPerson);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const [deviceDisplay, setDeviceDisplay] = useDeviceDisplayPreferences();
  const themeId = useAppliedThemeId();
  const friendSuggestionPreferences = useAppStore(
    (s) => s.preferences.friendSuggestions,
  );
  const savedSidebarWidth = Math.min(
    MAX_SIDEBAR_WIDTH,
    deviceDisplay.friendsSidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
  );
  const effectiveMode = deviceDisplay.friendsMode;
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [editorState, setEditorState] = useState<EditorState>(null);
  const [libraryMutationNonce, setLibraryMutationNonce] = useState(0);
  const [openingSyncModal, setOpeningSyncModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FriendOverviewFilter>>(
    new Set(),
  );
  const [sortBy, setSortBy] = useState<FriendOverviewSort>("recent_activity");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedSidebarWidth, setCommittedSidebarWidth] =
    useState(savedSidebarWidth);
  const [graphSourceCounts, setGraphSourceCounts] = useState<Readonly<{
    channelCount: number;
    linkedAccountCount: number;
    mode: MapMode;
    personCount: number;
  }> | null>(null);

  const graphRef = useRef<FriendGraphHandle>(null);
  const friendOverviewScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef(false);
  const sidebarDragCleanup = useRef<(() => void) | null>(null);
  const isMobile = useIsMobile();
  const friendsReadVersion = searchCorpusVersion + libraryMutationNonce;
  const directoryFilters = useMemo(
    () => [...activeFilters].sort(),
    [activeFilters],
  );
  const friendsDirectory = useLibraryFriendsDirectory({
    filters: directoryFilters,
    search: searchQuery,
    sort: sortBy,
    sourceVersion: friendsReadVersion,
  });
  const reconnectDirectory = useLibraryFriendsDirectory({
    filters: NEED_OUTREACH_DIRECTORY_FILTERS,
    limit: 1,
    search: "",
    sort: "last_contact",
    sourceVersion: friendsReadVersion,
  });
  const libraryFacets = useLibraryFacetSummary(friendsReadVersion);

  const {
    appendLibraryPersonReachOut,
    assignLibraryAccountToPerson,
    googleContacts,
    mutateDeviceGraphLayout,
    queryLibraryCore,
    readLibraryAccountDetail,
    readLibraryFriendDetail,
    readLibraryPersonDetail,
    removeLibraryPerson,
    replaceLibraryFriend,
    upsertLibraryPerson,
  } = usePlatform();
  const graphSqliteQuery = queryLibraryCore ?? unavailableLibraryCoreQuery;
  const contactSync = useContactSyncContext();
  const friendCount = libraryFacets.friendPersonCount;
  const socialAccountCount = libraryFacets.socialAccountCount;

  const selectedFriendDetail = useLibraryFriendDetail(
    selectedPersonId,
    friendsReadVersion,
  );
  const selectedAccountDetail = useLibraryAccountDetail(
    selectedAccountId,
    friendsReadVersion,
  );
  const selectedFriend = selectedFriendDetail.value;
  const selectedPerson = selectedFriend;
  const selectedAccount = selectedAccountDetail.value;
  const selectedAccountLinkedPersonDetail = useLibraryPersonDetail(
    selectedAccount?.personId ?? null,
    friendsReadVersion,
  );

  const timelineSources = useMemo<LibraryFriendsSource[]>(() => {
    const sources = selectedFriend
      ? selectedFriend.sources.map((source) => ({
          platform: source.platform,
          authorId: source.authorId,
        }))
      : selectedAccount?.kind === "social"
        ? [
            {
              platform: selectedAccount.provider,
              authorId: selectedAccount.externalId,
            },
          ]
        : [];
    const unique = new Map<string, LibraryFriendsSource>();
    for (const source of sources) {
      const key = friendActivitySourceKey(source.platform, source.authorId);
      if (!unique.has(key)) unique.set(key, source);
    }
    return [...unique.values()].sort(
      (left, right) =>
        compareUtf8Binary(left.platform, right.platform) ||
        compareUtf8Binary(left.authorId, right.authorId),
    );
  }, [selectedAccount?.id, selectedAccount?.personId, selectedFriend?.id]);
  const friendsGraphRequest = useMemo(
    () => createLibraryFriendsGraphRequest(timelineSources),
    [timelineSources],
  );
  const locationSources = useMemo<LibraryFriendsSource[]>(
    () => (selectedFriend ? timelineSources : []),
    [selectedFriend, timelineSources],
  );
  const timelineIdentity = useMemo<LibraryPersonTimelineRequest | null>(() => {
    if (selectedFriend) return { personId: selectedFriend.id };
    if (!selectedAccount) return null;
    return selectedAccount.personId
      ? { personId: selectedAccount.personId }
      : { accountId: selectedAccount.id };
  }, [selectedAccount, selectedFriend]);
  const friendsRows = useLibraryFriendsRows({
    graphRequest: friendsGraphRequest,
    locationSources,
    timelineIdentity,
    timelineSources,
    sourceVersion: friendsReadVersion,
  });
  const nativeActivity = useMemo(
    () =>
      friendsRows.graph
        ? buildFriendsActivityReadModel(friendsRows.graph)
        : null,
    [friendsRows.graph],
  );
  const reconnectCount = reconnectDirectory.totalCount;

  const selectedAccountSuggestions = useLibraryAccountLinkCandidates({
    entityId: selectedAccountId,
    entityKind: "account",
    sourceVersion: friendsReadVersion,
  });
  const selectedPersonSuggestions = useLibraryAccountLinkCandidates({
    entityId: selectedPersonId,
    entityKind: "person",
    sourceVersion: friendsReadVersion,
  });
  const friendCandidateSuggestions = useLibraryFriendCandidateReview({
    contactSuggestions: contactSync.suggestionPage.rows.map(
      (row) => row.suggestion,
    ),
    dismissedSuggestionIds:
      friendSuggestionPreferences?.dismissedSuggestionIds ?? [],
    sourceVersion: friendsReadVersion,
  });
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

  const sourceActivityEvidence = useMemo(
    () =>
      buildFriendSourceActivityEvidence({
        activityBySourceKey: nativeActivity?.socialActivityBySourceKey ?? {},
      }),
    [nativeActivity],
  );
  const selectedPersonFriendSuggestion = selectedPerson
    ? (friendCandidateByPerson.get(selectedPerson.id) ?? null)
    : null;
  const selectedAccountFriendSuggestion = selectedAccount
    ? (friendCandidateByAccount.get(selectedAccount.id) ?? null)
    : null;
  const selectedOverviewEntry = useMemo(() => {
    if (!selectedFriend) return null;
    return (
      buildFriendOverviewEntriesFromActivity(
        { [selectedFriend.id]: selectedFriend },
        nativeActivity?.socialActivityBySourceKey ?? {},
        friendsGraphRequest.recentWindow.endMs,
      )[0] ?? null
    );
  }, [friendsGraphRequest.recentWindow.endMs, nativeActivity, selectedFriend]);
  const friendOverviewVirtualizer = useVirtualizer({
    count: friendsDirectory.rows.length,
    getScrollElement: () => friendOverviewScrollRef.current,
    estimateSize: () => FRIEND_OVERVIEW_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => friendsDirectory.rows[index]?.id ?? index,
  });

  useEffect(() => {
    friendOverviewVirtualizer.measure();
  }, [
    friendsDirectory.rows.length,
    friendOverviewVirtualizer,
    searchQuery,
    sortBy,
  ]);

  useEffect(() => {
    if (
      selectedPersonId &&
      selectedFriendDetail.status === "ready" &&
      selectedFriendDetail.value === null
    ) {
      setSelectedPerson(null);
    }
  }, [selectedFriendDetail, selectedPersonId, setSelectedPerson]);

  useEffect(() => {
    if (
      selectedAccountId &&
      selectedAccountDetail.status === "ready" &&
      selectedAccountDetail.value === null
    ) {
      setSelectedAccount(null);
    }
  }, [selectedAccountDetail, selectedAccountId, setSelectedAccount]);

  useEffect(() => {
    if (dragWidth !== null || isDraggingSidebar.current) return;
    setCommittedSidebarWidth(savedSidebarWidth);
  }, [dragWidth, savedSidebarWidth]);

  const sidebarWidth = dragWidth ?? committedSidebarWidth;
  const focusGraphNode = useCallback((nodeId: string) => {
    graphRef.current?.focusNode(nodeId);
  }, []);

  const handleSelectPerson = useCallback(
    (person: Person, focusGraph: boolean = false) => {
      setSelectedPerson(person.id);
      if (focusGraph) {
        focusGraphNode(`person:${person.id}`);
      }
    },
    [focusGraphNode, setSelectedPerson],
  );

  const handleClearSelection = useCallback(() => {
    setSelectedPerson(null);
    setSelectedAccount(null);
  }, [setSelectedAccount, setSelectedPerson]);

  const handleOpenMapForPerson = useCallback(
    (personId: string) => {
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
    },
    [openMapForPerson, setActiveView],
  );

  const handleLogReachOut = useCallback(
    async (entry: ReachOutLog) => {
      if (!selectedPerson) return;
      if (!appendLibraryPersonReachOut) {
        throw new Error("The Person reach-out SQLite mutation is unavailable.");
      }
      await appendLibraryPersonReachOut(selectedPerson.id, entry);
      setLibraryMutationNonce((value) => value + 1);
    },
    [appendLibraryPersonReachOut, selectedPerson],
  );

  const persistFriend = useCallback(
    async (
      data: Omit<Friend, "id" | "createdAt" | "updatedAt">,
      personId?: string,
      editorSourceActivity?: ReadonlyMap<string, FriendSourceActivityEvidence>,
    ) => {
      const now = Date.now();
      const existingFriend = personId
        ? selectedFriend?.id === personId
          ? selectedFriend
          : readLibraryFriendDetail
            ? await readLibraryFriendDetail(personId)
            : null
        : null;
      if (personId && !existingFriend) {
        throw new Error("The selected Friend SQLite detail is unavailable.");
      }
      const existingPerson = existingFriend;
      const nextPersonId = existingPerson?.id ?? crypto.randomUUID();

      const nextPerson: Person = {
        id: nextPersonId,
        name: data.name.trim(),
        avatarUrl: data.avatarUrl?.trim() || undefined,
        bio: data.bio?.trim() || undefined,
        relationshipStatus: "friend",
        careLevel: data.careLevel,
        reachOutIntervalDays: data.reachOutIntervalDays,
        tags: data.tags,
        notes: data.notes?.trim() || undefined,
        createdAt: existingPerson?.createdAt ?? now,
        updatedAt: now,
      };

      if (!replaceLibraryFriend) {
        throw new Error("The atomic Friend SQLite mutation is unavailable.");
      }
      const desiredAccounts = data.sources.map((source) => {
        const activity =
          editorSourceActivity?.get(
            friendActivitySourceKey(source.platform, source.authorId),
          ) ??
          sourceActivityEvidence.get(
            friendActivitySourceKey(source.platform, source.authorId),
          ) ??
          null;
        return socialAccountDraftFromSource(
          source,
          nextPersonId,
          activity,
          now,
        );
      });
      if (data.contact) {
        desiredAccounts.push(
          contactAccountDraft(nextPersonId, data.contact, now),
        );
      }
      await replaceLibraryFriend(nextPerson, desiredAccounts);
      setLibraryMutationNonce((value) => value + 1);

      setEditorState(null);
      setSelectedPerson(nextPersonId);
    },
    [
      readLibraryFriendDetail,
      replaceLibraryFriend,
      selectedFriend,
      setSelectedPerson,
      sourceActivityEvidence,
    ],
  );

  const handleSave = useCallback(
    async (
      data: Omit<Friend, "id" | "createdAt" | "updatedAt">,
      _id?: string,
      editorSourceActivity?: ReadonlyMap<string, FriendSourceActivityEvidence>,
    ) => {
      const personId =
        editorState?.kind === "edit" ? editorState.personId : undefined;
      await persistFriend(data, personId, editorSourceActivity);
    },
    [editorState, persistFriend],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!removeLibraryPerson) {
        throw new Error("The Person removal SQLite mutation is unavailable.");
      }
      await removeLibraryPerson(id);
      setLibraryMutationNonce((value) => value + 1);
      if (selectedPersonId === id) {
        handleClearSelection();
      }
      setEditorState(null);
    },
    [handleClearSelection, removeLibraryPerson, selectedPersonId],
  );

  const handleLinkAccountToPerson = useCallback(
    async (accountId: string, personId: string) => {
      if (!assignLibraryAccountToPerson) {
        throw new Error("The Account assignment SQLite mutation is unavailable.");
      }
      await assignLibraryAccountToPerson(accountId, personId);
      setLibraryMutationNonce((value) => value + 1);
      setSelectedPerson(personId);
    },
    [assignLibraryAccountToPerson, setSelectedPerson],
  );

  const handlePinPersonPosition = useCallback(
    async (personId: string, x: number, y: number) => {
      if (!mutateDeviceGraphLayout) {
        toast.error("Freed could not save this graph position on this device.");
        return;
      }
      try {
        const result = await mutateDeviceGraphLayout({
          entityId: personId,
          graphX: Math.round(x),
          graphY: Math.round(y),
          mutationId: "person_graph_position_set_v1",
          schemaVersion: 1,
          updatedAt: Date.now(),
        });
        if (result.changed) setLibraryMutationNonce((value) => value + 1);
      } catch {
        toast.error("Freed could not save this graph position on this device.");
      }
    },
    [mutateDeviceGraphLayout],
  );

  const handlePinAccountPosition = useCallback(
    async (accountId: string, x: number, y: number) => {
      if (!mutateDeviceGraphLayout) {
        toast.error("Freed could not save this graph position on this device.");
        return;
      }
      try {
        const result = await mutateDeviceGraphLayout({
          entityId: accountId,
          graphX: Math.round(x),
          graphY: Math.round(y),
          mutationId: "account_graph_position_set_v1",
          schemaVersion: 1,
          updatedAt: Date.now(),
        });
        if (result.changed) setLibraryMutationNonce((value) => value + 1);
      } catch {
        toast.error("Freed could not save this graph position on this device.");
      }
    },
    [mutateDeviceGraphLayout],
  );

  const handleSetPersonRelationshipLevel = useCallback(
    async (person: Person, level: RelationshipTierLevel) => {
      if (!upsertLibraryPerson) {
        throw new Error("The Person SQLite mutation is unavailable.");
      }
      await upsertLibraryPerson({
        ...person,
        ...relationshipPatchForLevel(level),
        updatedAt: Date.now(),
      });
      setLibraryMutationNonce((value) => value + 1);
      setSelectedPerson(person.id);
    },
    [setSelectedPerson, upsertLibraryPerson],
  );

  const handlePromoteSelectedAccount = useCallback(
    async (level: 3 | 5 = 3) => {
      if (!selectedAccount) return;
      const linkedPerson = selectedAccount.personId
        ? (selectedAccountLinkedPersonDetail.value ??
          (readLibraryPersonDetail
            ? await readLibraryPersonDetail(selectedAccount.personId)
            : null))
        : null;
      if (linkedPerson) {
        await handleSetPersonRelationshipLevel(linkedPerson, level);
        return;
      }
      if (selectedAccount.personId) {
        toast.error("Freed could not load that person's SQLite record.");
        return;
      }
      setEditorState({
        kind: "new",
        draft: friendDraftFromAccount(selectedAccount, level),
      });
    },
    [
      handleSetPersonRelationshipLevel,
      readLibraryPersonDetail,
      selectedAccount,
      selectedAccountLinkedPersonDetail.value,
    ],
  );

  const handlePromoteSelectedPerson = useCallback(
    async (level: 3 | 5 = 3) => {
      if (!selectedPerson) return;
      await handleSetPersonRelationshipLevel(selectedPerson, level);
    },
    [handleSetPersonRelationshipLevel, selectedPerson],
  );

  const handlePromoteFriendSuggestion = useCallback(
    async (suggestion: FriendCandidateSuggestion, level: 3 | 5) => {
      if (suggestion.personId) {
        const person = readLibraryPersonDetail
          ? await readLibraryPersonDetail(suggestion.personId)
          : null;
        if (person) {
          await handleSetPersonRelationshipLevel(person, level);
          return;
        }
      }
      const accountId = suggestion.accountIds[0];
      const account =
        accountId && readLibraryAccountDetail
          ? await readLibraryAccountDetail(accountId)
          : null;
      if (!account) return;
      const linkedPerson = account.personId
        ? readLibraryPersonDetail
          ? await readLibraryPersonDetail(account.personId)
          : null
        : null;
      if (linkedPerson) {
        await handleSetPersonRelationshipLevel(linkedPerson, level);
        return;
      }
      setSelectedAccount(account.id);
      setEditorState({
        kind: "new",
        draft: friendDraftFromAccount(account, level),
      });
    },
    [
      handleSetPersonRelationshipLevel,
      readLibraryAccountDetail,
      readLibraryPersonDetail,
      setSelectedAccount,
    ],
  );

  const handleDropGraphNodeToRelationshipTier = useCallback(
    async ({
      personId,
      accountId,
      level,
    }: {
      personId?: string;
      accountId?: string;
      level: RelationshipTierLevel;
    }) => {
      if (personId) {
        const person = readLibraryPersonDetail
          ? await readLibraryPersonDetail(personId)
          : null;
        if (person) {
          await handleSetPersonRelationshipLevel(person, level);
        }
        return;
      }

      if (!accountId || level === 1) return;
      const account = readLibraryAccountDetail
        ? await readLibraryAccountDetail(accountId)
        : null;
      if (!account) return;
      const linkedPerson = account.personId
        ? readLibraryPersonDetail
          ? await readLibraryPersonDetail(account.personId)
          : null
        : null;
      if (linkedPerson) {
        await handleSetPersonRelationshipLevel(linkedPerson, level);
        return;
      }
      setSelectedAccount(account.id);
      setEditorState({
        kind: "new",
        draft: friendDraftFromAccount(account, level),
      });
    },
    [
      handleSetPersonRelationshipLevel,
      readLibraryAccountDetail,
      readLibraryPersonDetail,
      setSelectedAccount,
    ],
  );

  const handleDismissFriendSuggestion = useCallback(
    (suggestionId: string) => {
      const current = friendSuggestionPreferences?.dismissedSuggestionIds ?? [];
      if (current.includes(suggestionId)) return;
      void updatePreferences({
        friendSuggestions: {
          dismissedSuggestionIds: [...current, suggestionId],
        },
      } as Parameters<typeof updatePreferences>[0]).catch(() => {
        toast.error("Freed could not dismiss that suggestion.");
      });
    },
    [friendSuggestionPreferences, updatePreferences],
  );

  const handleSelectFriendCandidate = useCallback(
    (suggestion: FriendCandidateSuggestion) => {
      if (suggestion.personId) {
        setSelectedPerson(suggestion.personId);
        focusGraphNode(`person:${suggestion.personId}`);
        return;
      }
      const accountId = suggestion.accountIds[0];
      if (accountId) {
        setSelectedAccount(accountId);
        focusGraphNode(`account:${accountId}`);
      }
    },
    [focusGraphNode, setSelectedAccount, setSelectedPerson],
  );

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

  useEffect(
    () => () => {
      sidebarDragCleanup.current?.();
      sidebarDragCleanup.current = null;
    },
    [],
  );

  const handleSidebarDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [isMobile, setDeviceDisplay, sidebarWidth],
  );

  const renderOverviewSidebar = () => (
    <div className="flex h-full flex-col bg-transparent">
      <div className={FRIENDS_SIDEBAR_SECTION}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--theme-text-primary)]">
              Friends
            </h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              {friendCount.toLocaleString()} total,{" "}
              {socialAccountCount.toLocaleString()} account
              {socialAccountCount === 1 ? "" : "s"},{" "}
              {reconnectCount.toLocaleString()} due to reconnect
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
              <p className="theme-feedback-text-warning text-[11px] font-semibold uppercase tracking-[0.14em]">
                Reconnect
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--theme-text-primary)]">
                {reconnectCount.toLocaleString()} friend
                {reconnectCount === 1 ? "" : "s"} waiting on a follow-up
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
            Showing {friendsDirectory.rows.length.toLocaleString()} of{" "}
            {friendsDirectory.totalCount.toLocaleString()}
          </p>
          <select
            value={sortBy}
            onChange={(event) =>
              setSortBy(event.target.value as FriendOverviewSort)
            }
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
        {friendsDirectory.loading ? (
          <div
            className="theme-panel-muted rounded-xl px-4 py-6 text-center"
            data-testid="friends-activity-loading"
          >
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
              Loading friend activity...
            </p>
          </div>
        ) : !friendsRows.graphLoading &&
          friendCandidateSuggestions.length > 0 ? (
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
                    (suggestion.personId !== undefined &&
                      suggestion.personId === selectedPerson?.id) ||
                    (selectedAccount?.id !== undefined &&
                      suggestion.accountIds.includes(selectedAccount.id))
                  }
                  onSelect={() => handleSelectFriendCandidate(suggestion)}
                  onDismiss={handleDismissFriendSuggestion}
                  onPromoteToFriend={() =>
                    void handlePromoteFriendSuggestion(suggestion, 3)
                  }
                  onPromoteToFam={() =>
                    void handlePromoteFriendSuggestion(suggestion, 5)
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {!friendsDirectory.loading && friendsDirectory.rows.length === 0 ? (
          <div className="theme-panel-muted rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
              No friends match those filters
            </p>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              Try clearing a filter or changing the search query.
            </p>
          </div>
        ) : !friendsDirectory.loading ? (
          <div
            data-testid="friends-overview-list"
            className="relative"
            style={{ height: friendOverviewVirtualizer.getTotalSize() }}
          >
            {friendOverviewVirtualizer.getVirtualItems().map((virtualItem) => {
              const row = friendsDirectory.rows[virtualItem.index];
              if (!row) return null;
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
                    row={row}
                    selected={row.id === selectedPerson?.id}
                    onSelect={() => {
                      setSelectedPerson(row.id);
                      focusGraphNode(`person:${row.id}`);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        {friendsDirectory.hasPrevious || friendsDirectory.hasNext ? (
          <div className="flex items-center justify-between gap-3 py-3">
            <button
              type="button"
              className={BUTTON_CHROME}
              disabled={
                !friendsDirectory.hasPrevious || friendsDirectory.loadingPage
              }
              onClick={() => {
                friendsDirectory.previousPage();
                friendOverviewScrollRef.current?.scrollTo({ top: 0 });
              }}
            >
              Previous
            </button>
            <span className="text-xs text-[color:var(--theme-text-muted)]">
              Page {friendsDirectory.pageNumber.toLocaleString()}
            </span>
            <button
              type="button"
              className={BUTTON_CHROME}
              disabled={
                !friendsDirectory.hasNext || friendsDirectory.loadingPage
              }
              onClick={() => {
                friendsDirectory.nextPage();
                friendOverviewScrollRef.current?.scrollTo({ top: 0 });
              }}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderSelectedPersonSidebar = () => (
    <div className="flex h-full flex-col bg-transparent">
      <div
        className={`${FRIENDS_SIDEBAR_SECTION} flex items-center justify-between gap-3`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleClearSelection}
            className="btn-secondary rounded-lg p-1.5"
            aria-label="Back to all friends"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-4 w-4"
              aria-hidden
            >
              <path
                d="M12.5 4.5L7 10l5.5 5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">
              {personName(selectedPerson)}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              {selectedPerson
                ? relationshipTierLabelForPerson(selectedPerson)
                : "Followed"}
            </p>
          </div>
        </div>

        {selectedPerson && (
          <button
            type="button"
            onClick={() =>
              setEditorState({ kind: "edit", personId: selectedPerson.id })
            }
            className={BUTTON_CHROME}
          >
            Edit
          </button>
        )}
      </div>

      {selectedPerson ? (
        <RelationshipTierControl
          value={relationshipTierLevelForPerson(selectedPerson)}
          onChange={(level) =>
            void handleSetPersonRelationshipLevel(selectedPerson, level)
          }
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
              const accountLabel =
                suggestion.accountDisplayName ??
                suggestion.accountHandle ??
                suggestion.accountExternalId;
              return (
                <button
                  key={`${suggestion.personId}:${suggestion.accountId}`}
                  type="button"
                  onClick={() =>
                    void handleLinkAccountToPerson(
                      suggestion.accountId,
                      selectedPerson.id,
                    )
                  }
                  className="theme-card-soft flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
                      {accountLabel}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                      {suggestion.reason}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      suggestion.confidence === "high"
                        ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
                        : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
                    }`}
                  >
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
            feedItems={friendsRows.timelineItems}
            locationItems={friendsRows.locationItems}
            activityAvatarUrls={
              selectedOverviewEntry?.avatarUrlCandidates ?? []
            }
            latestPostAt={selectedOverviewEntry?.lastPostAt ?? null}
            activityLoading={friendsRows.graphLoading}
            timelineLoading={friendsRows.timelineLoading}
            timelineLoadingMore={friendsRows.timelineLoadingMore}
            timelineHasMore={friendsRows.timelineHasMore}
            timelineAwayFromNewest={friendsRows.timelineAwayFromNewest}
            timelineTotalCount={friendsRows.timelineTotalCount}
            onLoadMoreTimeline={friendsRows.loadMoreTimeline}
            onShowNewestTimeline={friendsRows.showNewestTimeline}
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
    const linkedPerson = selectedAccountLinkedPersonDetail.value;
    return (
      <AccountDetailPanel
        account={selectedAccount}
        linkedPerson={linkedPerson}
        suggestions={selectedAccountSuggestions}
        friendSuggestion={selectedAccountFriendSuggestion}
        sourceVersion={friendsReadVersion}
        feedItems={friendsRows.timelineItems}
        timelineLoading={friendsRows.timelineLoading}
        timelineTotalCount={friendsRows.timelineTotalCount}
        onBack={handleClearSelection}
        onPromoteToFriend={() => void handlePromoteSelectedAccount(3)}
        onPromoteToFam={() => void handlePromoteSelectedAccount(5)}
        onDismissFriendSuggestion={handleDismissFriendSuggestion}
        onLinkToPerson={(personId) =>
          void handleLinkAccountToPerson(selectedAccount.id, personId)
        }
        onOpenPerson={(personId) => {
          setSelectedPerson(personId);
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
              {friendCount === 0
                ? "No friends yet"
                : "No friend graph nodes yet"}
            </p>
            <p className="mt-1 max-w-xs text-sm text-[color:var(--theme-text-muted)]">
              {friendCount === 0
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
          <p className="font-medium text-[color:var(--theme-text-primary)]">
            No captured accounts yet
          </p>
          <p className="mt-1 max-w-xs text-sm text-[color:var(--theme-text-muted)]">
            Accounts with captured content will appear here and can be promoted
            into your friends workspace.
          </p>
        </div>
      </div>
    );
  };

  const renderCollapsedSelectionCard = () => {
    if (selectedAccount) {
      const linkedPerson = selectedAccount.personId
        ? selectedAccountLinkedPersonDetail.value
        : null;
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
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <path
                      d="M5 5l10 10M15 5L5 15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <p className="mt-2 text-sm text-[color:var(--theme-text-secondary)]">
                {accountSubtitle(selectedAccount)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[color:var(--theme-text-muted)]">
                <span>
                  {friendsRows.timelineLoading
                    ? "Loading captured posts..."
                    : `${friendsRows.timelineTotalCount.toLocaleString()} captured post${friendsRows.timelineTotalCount === 1 ? "" : "s"}`}
                </span>
                <span>•</span>
                <span>
                  {linkedPerson
                    ? `Linked to ${personName(linkedPerson)}`
                    : "Not linked yet"}
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
        selectedOverviewEntry?.avatarUrlCandidates ?? [],
      );
      const lastPostLabel = friendsRows.graphLoading
        ? "Loading friend activity..."
        : selectedOverviewEntry?.lastPostAt
          ? formatDistanceToNow(selectedOverviewEntry.lastPostAt, {
              addSuffix: true,
            })
          : "No posts yet";
      const lastContactLabel = selectedOverviewEntry?.lastContactAt
        ? formatDistanceToNow(selectedOverviewEntry.lastContactAt, {
            addSuffix: true,
          })
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
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <path
                      d="M5 5l10 10M15 5L5 15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
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
                <span>
                  {selectedFriend.sources.length.toLocaleString()} channel
                  {selectedFriend.sources.length === 1 ? "" : "s"}
                </span>
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
              onClick={() =>
                setEditorState({ kind: "edit", personId: selectedPerson.id })
              }
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
  const graphIsEmpty =
    graphSourceCounts?.mode === effectiveMode &&
    (effectiveMode === "friends"
      ? graphSourceCounts.personCount === 0
      : graphSourceCounts.channelCount === 0 &&
        graphSourceCounts.personCount === 0);
  const renderGraphLoadingState = (overlay = false) => (
    <div
      className={`${overlay ? "absolute inset-0 z-10 bg-[color:var(--theme-bg-primary)]" : "h-full"} flex items-center justify-center px-6 text-center`}
      data-testid="friends-graph-loading"
    >
      <p className="text-sm text-[color:var(--theme-text-muted)]">
        Loading friend activity...
      </p>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div
        className={`relative flex min-h-0 flex-1 ${isMobile ? "flex-col pt-[var(--feed-card-gap,8px)]" : "flex-row"}`}
      >
        <div
          className={`${
            showGraphSurface
              ? "relative min-h-0 min-w-0 flex-1 overflow-visible"
              : "pointer-events-none absolute inset-0 min-h-0 min-w-0 overflow-hidden opacity-0"
          }`}
        >
          <FriendGraph
            ref={graphRef}
            sqliteGraphQuery={graphSqliteQuery}
            sourceVersion={friendsReadVersion}
            mode={effectiveMode}
            selectedPersonId={selectedPerson?.id ?? null}
            selectedAccountId={selectedAccount?.id ?? null}
            onSelectPersonId={(personId) => setSelectedPerson(personId)}
            onSelectAccountId={(accountId) => setSelectedAccount(accountId)}
            onSourceCounts={(counts) => {
              setGraphSourceCounts({ ...counts, mode: effectiveMode });
            }}
            resolveContextNode={async (target) => {
              if (target.nodeId.startsWith("account:")) {
                const accountId = target.nodeId.slice("account:".length);
                const account = await readLibraryAccountDetail?.(accountId);
                if (!account) return null;
                return {
                  accountId,
                  activityCount: 0,
                  avatarUrl: account.avatarUrl ?? null,
                  graphPinned: account.graphPinned,
                  id: target.nodeId,
                  initials: "",
                  kind: "account",
                  label: accountTitle(account),
                  linkedPersonId: account.personId ?? null,
                  priority: 1,
                  provider: account.provider,
                  radius: 0,
                  x: target.worldX,
                  y: target.worldY,
                };
              }
              if (target.nodeId.startsWith("person:")) {
                const personId = target.nodeId.slice("person:".length);
                const person = await readLibraryPersonDetail?.(personId);
                if (!person) return null;
                return {
                  activityCount: 0,
                  avatarUrl: person.avatarUrl ?? null,
                  careLevel: person.careLevel,
                  graphPinned: person.graphPinned,
                  id: target.nodeId,
                  initials: "",
                  kind:
                    person.relationshipStatus === "friend"
                      ? "friend_person"
                      : "connection_person",
                  label: personName(person),
                  personId,
                  priority: 1,
                  radius: 0,
                  x: target.worldX,
                  y: target.worldY,
                };
              }
              if (target.nodeId.startsWith("feed:")) {
                const feedUrl = target.nodeId.slice("feed:".length);
                const feed = await readLibraryCoreRssFeedV1(
                  graphSqliteQuery,
                  feedUrl,
                );
                if (!feed) return null;
                return {
                  activityCount: 0,
                  avatarUrl: feed.imageUrl ?? null,
                  feedUrl,
                  id: target.nodeId,
                  initials: "",
                  kind: "feed",
                  label: feed.title || feed.url,
                  priority: 1,
                  provider: "rss",
                  radius: 0,
                  x: target.worldX,
                  y: target.worldY,
                };
              }
              return null;
            }}
            onClearSelection={
              showCollapsedSelectionCard ? handleClearSelection : undefined
            }
            onLinkAccountToPerson={handleLinkAccountToPerson}
            onPinPersonPosition={handlePinPersonPosition}
            onPinAccountPosition={handlePinAccountPosition}
            onDropNodeToRelationshipTier={handleDropGraphNodeToRelationshipTier}
            themeId={themeId}
            presentationVisible={showGraphSurface}
            controlsAdjacentToSidebar={showDesktopSidebar}
          />
          {graphIsEmpty && !friendsRows.graphLoading ? (
            <div className="absolute inset-0 z-10 bg-[color:var(--theme-bg-primary)]">
              {renderGraphEmptyState()}
            </div>
          ) : friendsRows.graphLoading ? (
            renderGraphLoadingState(true)
          ) : null}
        </div>

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
            className="flex shrink-0 overflow-hidden py-[var(--feed-card-gap,8px)]"
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
          existing={
            editorState.kind === "edit"
              ? selectedFriend?.id === editorState.personId
                ? selectedFriend
                : null
              : null
          }
          draft={
            editorState.kind === "new" ? (editorState.draft ?? null) : null
          }
          onSave={handleSave}
          onDelete={editorState.kind === "edit" ? handleDelete : undefined}
          onCancel={() => setEditorState(null)}
        />
      ) : null}
    </div>
  );
}
