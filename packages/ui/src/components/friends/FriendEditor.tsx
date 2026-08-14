/**
 * FriendEditor — modal for creating or editing a Friend record.
 *
 * Sections:
 *   1. Basic info: name, avatar URL, bio, care level, reach-out interval
 *   2. Contact import: "Import from Contacts" button (injected via PlatformContext)
 *      or a manual phone/email/address form fallback
 *   3. Social sources: link/unlink platform profiles seen in the feed
 *   4. Tags and notes
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FeedItem,
  Friend,
  FriendSource,
  DeviceContact,
  Platform,
} from "@freed/shared";
import { compareUtf8Binary } from "@freed/shared";
import { usePlatform, useAppStore } from "../../context/PlatformContext.js";
import {
  FacebookIcon,
  InstagramIcon,
  MediumIcon,
  RssIcon,
  SubstackIcon,
  XIcon,
  YoutubeIcon,
  RedditIcon,
  GithubIcon,
  MastodonIcon,
  BookmarkIcon,
} from "../icons.js";
import type { ReactNode } from "react";
import { ChannelAvatar } from "../ChannelAvatar.js";
import { SearchField } from "../SearchField.js";
import { useLegacyLibraryItems } from "../../hooks/useLegacyLibraryItems.js";
import type { FriendSourceActivityEvidence } from "../../lib/friends-library-read-model.js";

// ---------------------------------------------------------------------------
// Platform icon map
// ---------------------------------------------------------------------------

const cls = "w-3.5 h-3.5";
const platformIcons: Record<string, ReactNode> = {
  x: <XIcon className={cls} />,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  substack: <SubstackIcon className={cls} />,
  medium: <MediumIcon className={cls} />,
  saved: <BookmarkIcon className={cls} />,
};

// ---------------------------------------------------------------------------
// Care level labels
// ---------------------------------------------------------------------------

const CARE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: "Fam, nudge weekly",
  4: "High friend, nudge every 2 weeks",
  3: "Friend, nudge monthly",
  2: "Acquaintance, nudge quarterly",
  1: "Followed, no nudges",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditorFriend = Omit<Friend, "id" | "createdAt" | "updatedAt">;

interface FriendEditorProps {
  /** When editing, pass the existing friend. When creating, pass null. */
  existing?: Friend | null;
  /** Optional seed values for a new friend flow. */
  draft?: Partial<Friend> | null;
  onSave: (
    data: EditorFriend,
    id?: string,
    sourceActivity?: ReadonlyMap<string, FriendSourceActivityEvidence>,
  ) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Collect all unique authors from the feed as linkable profile candidates
// ---------------------------------------------------------------------------

interface AuthorCandidate {
  platform: Platform;
  authorId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
}

interface SelectedAuthorActivityAccumulator extends FriendSourceActivityEvidence {
  discoveryItemId: string;
}

const FRIEND_EDITOR_AUTHOR_CANDIDATE_LIMIT = 50;
const FRIEND_EDITOR_SCAN_PAGE_LIMIT = 64;
const FRIEND_EDITOR_SEARCH_DEBOUNCE_MS = 150;
const FRIEND_EDITOR_AUTHOR_ID_BYTE_LIMIT = 4_096;
const FRIEND_EDITOR_AUTHOR_TEXT_BYTE_LIMIT = 4_096;
const FRIEND_EDITOR_AVATAR_URL_BYTE_LIMIT = 16_384;
const FRIEND_EDITOR_READER_DISABLED_KEY =
  "freed.libraryCore.friendEditorReaderV1.disabled";
const UTF8_ENCODER = new TextEncoder();

interface VersionedAuthorCandidates {
  candidates: AuthorCandidate[];
  linked: ReadonlySet<string>;
  query: string;
  sourceVersion: number;
}

interface VersionedAuthorCandidateFailure {
  linked: ReadonlySet<string>;
  query: string;
  sourceVersion: number;
}

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function authorCandidateKey(
  candidate: Pick<AuthorCandidate, "authorId" | "platform">,
): string {
  return `${candidate.platform}:${candidate.authorId}`;
}

function compareAuthorCandidates(
  left: AuthorCandidate,
  right: AuthorCandidate,
): number {
  return (
    safeText(left.displayName).localeCompare(safeText(right.displayName)) ||
    safeText(left.handle).localeCompare(safeText(right.handle)) ||
    left.platform.localeCompare(right.platform) ||
    left.authorId.localeCompare(right.authorId)
  );
}

function authorCandidateMatches(
  candidate: AuthorCandidate,
  normalizedQuery: string,
): boolean {
  return (
    !normalizedQuery ||
    candidate.displayName.toLowerCase().includes(normalizedQuery) ||
    candidate.handle.toLowerCase().includes(normalizedQuery) ||
    candidate.platform.includes(normalizedQuery)
  );
}

function authorCandidateFromItem(item: FeedItem): AuthorCandidate {
  return {
    platform: item.platform,
    authorId: item.author.id,
    handle: item.author.handle,
    displayName: item.author.displayName,
    avatarUrl: item.author.avatarUrl,
  };
}

function assertCompactNativeAuthorCandidate(item: FeedItem): void {
  if (
    UTF8_ENCODER.encode(item.author.id).length >
      FRIEND_EDITOR_AUTHOR_ID_BYTE_LIMIT ||
    UTF8_ENCODER.encode(item.author.handle).length >
      FRIEND_EDITOR_AUTHOR_TEXT_BYTE_LIMIT ||
    UTF8_ENCODER.encode(item.author.displayName).length >
      FRIEND_EDITOR_AUTHOR_TEXT_BYTE_LIMIT ||
    (item.author.avatarUrl !== undefined &&
      UTF8_ENCODER.encode(item.author.avatarUrl).length >
        FRIEND_EDITOR_AVATAR_URL_BYTE_LIMIT)
  ) {
    throw new Error("Friend author candidate exceeds its compact byte bound");
  }
}

function mergeSelectedAuthorActivity(
  current: SelectedAuthorActivityAccumulator | undefined,
  item: FeedItem,
): SelectedAuthorActivityAccumulator {
  if (!current) {
    return {
      firstSeenAt: item.publishedAt,
      lastSeenAt: item.publishedAt,
      discoveredFrom:
        item.contentType === "story" ? "story_author" : "captured_item",
      discoveryItemId: item.globalId,
    };
  }
  const replacesDiscovery =
    item.publishedAt < current.firstSeenAt ||
    (item.publishedAt === current.firstSeenAt &&
      compareUtf8Binary(item.globalId, current.discoveryItemId) < 0);
  return {
    firstSeenAt: Math.min(current.firstSeenAt, item.publishedAt),
    lastSeenAt: Math.max(current.lastSeenAt, item.publishedAt),
    discoveredFrom: replacesDiscovery
      ? item.contentType === "story"
        ? "story_author"
        : "captured_item"
      : current.discoveredFrom,
    discoveryItemId: replacesDiscovery
      ? item.globalId
      : current.discoveryItemId,
  };
}

function selectedAuthorActivityEvidence(
  activity: ReadonlyMap<string, SelectedAuthorActivityAccumulator>,
  selectedKeys: ReadonlySet<string>,
): ReadonlyMap<string, FriendSourceActivityEvidence> {
  for (const key of selectedKeys) {
    if (!activity.has(key)) {
      throw new Error(
        "Selected Friend author is absent from the current source",
      );
    }
  }
  return new Map(
    Array.from(activity, ([key, value]) => [
      key,
      {
        firstSeenAt: value.firstSeenAt,
        lastSeenAt: value.lastSeenAt,
        discoveredFrom: value.discoveredFrom,
      },
    ]),
  );
}

function collectLegacyAuthorCandidates(
  items: readonly FeedItem[],
  linked: ReadonlySet<string>,
): AuthorCandidate[] {
  const seen = new Map<string, AuthorCandidate>();
  for (const item of items) {
    const candidate = authorCandidateFromItem(item);
    const key = authorCandidateKey(candidate);
    if (linked.has(key) || seen.has(key)) continue;
    seen.set(key, candidate);
  }
  return Array.from(seen.values()).sort((left, right) =>
    safeText(left.displayName).localeCompare(safeText(right.displayName)),
  );
}

async function readBoundedAuthorCandidates(
  scanItems: NonNullable<ReturnType<typeof usePlatform>["scanLibraryItems"]>,
  linked: ReadonlySet<string>,
  normalizedQuery: string,
  signal: AbortSignal,
): Promise<AuthorCandidate[]> {
  const candidates: AuthorCandidate[] = [];
  const assertActive = (): void => {
    if (signal.aborted) {
      throw new Error("Friend author candidate scan was cancelled");
    }
  };

  assertActive();
  await scanItems((page) => {
    assertActive();
    if (page.length > FRIEND_EDITOR_SCAN_PAGE_LIMIT) {
      throw new Error("Friend author candidate page exceeds 64 rows");
    }
    for (const item of page) {
      assertActive();
      if (item.userState.hidden) continue;
      assertCompactNativeAuthorCandidate(item);
      const candidate = authorCandidateFromItem(item);
      const key = authorCandidateKey(candidate);
      const currentIndex = candidates.findIndex(
        (current) => authorCandidateKey(current) === key,
      );
      if (currentIndex >= 0) continue;
      if (
        linked.has(key) ||
        !authorCandidateMatches(candidate, normalizedQuery)
      ) {
        continue;
      }
      candidates.push(candidate);
      candidates.sort(compareAuthorCandidates);
      if (candidates.length > FRIEND_EDITOR_AUTHOR_CANDIDATE_LIMIT) {
        candidates.pop();
      }
    }
    return "continue";
  });
  assertActive();
  return candidates;
}

async function readSelectedAuthorActivity(
  scanItems: NonNullable<ReturnType<typeof usePlatform>["scanLibraryItems"]>,
  selectedKeys: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, FriendSourceActivityEvidence>> {
  const activity = new Map<string, SelectedAuthorActivityAccumulator>();
  const assertActive = (): void => {
    if (signal.aborted) {
      throw new Error("Friend author activity scan was cancelled");
    }
  };

  assertActive();
  await scanItems((page) => {
    assertActive();
    if (page.length > FRIEND_EDITOR_SCAN_PAGE_LIMIT) {
      throw new Error("Friend author activity page exceeds 64 rows");
    }
    for (const item of page) {
      assertActive();
      if (item.userState.hidden) continue;
      const key = `${item.platform}:${item.author.id}`;
      if (!selectedKeys.has(key)) continue;
      activity.set(key, mergeSelectedAuthorActivity(activity.get(key), item));
    }
    return "continue";
  });
  assertActive();
  return selectedAuthorActivityEvidence(activity, selectedKeys);
}

async function readLegacySelectedAuthorActivity(
  items: readonly FeedItem[],
  selectedKeys: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, FriendSourceActivityEvidence>> {
  // Yield before the compatibility-only O(n) pass. Normal Freed Desktop uses
  // the asynchronous source-fenced SQLite scanner above.
  await Promise.resolve();
  const activity = new Map<string, SelectedAuthorActivityAccumulator>();
  for (const item of items) {
    if (signal.aborted) {
      throw new Error("Friend author activity scan was cancelled");
    }
    const key = `${item.platform}:${item.author.id}`;
    if (!selectedKeys.has(key)) continue;
    activity.set(key, mergeSelectedAuthorActivity(activity.get(key), item));
  }
  return selectedAuthorActivityEvidence(activity, selectedKeys);
}

function friendEditorReaderDisabled(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(FRIEND_EDITOR_READER_DISABLED_KEY) === "1"
  );
}

function useAuthorCandidates(
  existingSources: FriendSource[],
  allFriends: Record<string, Friend>,
  sourceSearch: string,
): {
  candidates: AuthorCandidate[];
  failed: boolean;
  ready: boolean;
  resolveSelectedActivity: (
    selectedKeys: ReadonlySet<string>,
    signal: AbortSignal,
  ) => Promise<ReadonlyMap<string, FriendSourceActivityEvidence>>;
} {
  const { acquireLegacyLibraryItems, scanLibraryItems } = usePlatform();
  const items = useAppStore((s) => s.items);
  const sourceVersion = useAppStore((s) => s.searchCorpusVersion);
  const usingBoundedReader = Boolean(
    acquireLegacyLibraryItems &&
    scanLibraryItems &&
    !friendEditorReaderDisabled(),
  );
  const legacyItemsReady = useLegacyLibraryItems(!usingBoundedReader);
  const normalizedQuery = sourceSearch.toLowerCase();

  const linked = useMemo(() => {
    const next = new Set<string>();
    for (const friend of Object.values(allFriends)) {
      for (const source of friend.sources) {
        next.add(authorCandidateKey(source));
      }
    }
    for (const source of existingSources) {
      next.delete(authorCandidateKey(source));
    }
    return next;
  }, [allFriends, existingSources]);

  const legacyCandidates = useMemo(
    () =>
      usingBoundedReader ? [] : collectLegacyAuthorCandidates(items, linked),
    [items, linked, usingBoundedReader],
  );
  const [versionedCandidates, setVersionedCandidates] =
    useState<VersionedAuthorCandidates | null>(null);
  const [failedAttempt, setFailedAttempt] =
    useState<VersionedAuthorCandidateFailure | null>(null);

  useEffect(() => {
    if (!usingBoundedReader || !scanLibraryItems) {
      setVersionedCandidates(null);
      setFailedAttempt(null);
      return;
    }

    const controller = new AbortController();
    setFailedAttempt(null);
    const startRead = (): void => {
      void readBoundedAuthorCandidates(
        scanLibraryItems,
        linked,
        normalizedQuery,
        controller.signal,
      )
        .then((candidates) => {
          if (!controller.signal.aborted) {
            setVersionedCandidates({
              candidates,
              linked,
              query: normalizedQuery,
              sourceVersion,
            });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailedAttempt({
              linked,
              query: normalizedQuery,
              sourceVersion,
            });
          }
        });
    };
    const debounceId = normalizedQuery
      ? setTimeout(startRead, FRIEND_EDITOR_SEARCH_DEBOUNCE_MS)
      : null;
    if (debounceId === null) {
      startRead();
    }
    return () => {
      if (debounceId !== null) clearTimeout(debounceId);
      controller.abort();
    };
  }, [
    linked,
    normalizedQuery,
    scanLibraryItems,
    sourceVersion,
    usingBoundedReader,
  ]);

  const currentRead =
    versionedCandidates?.linked === linked &&
    versionedCandidates.query === normalizedQuery &&
    versionedCandidates.sourceVersion === sourceVersion
      ? versionedCandidates
      : null;
  const failed =
    failedAttempt?.linked === linked &&
    failedAttempt.query === normalizedQuery &&
    failedAttempt.sourceVersion === sourceVersion;
  const resolveSelectedActivity = (
    selectedKeys: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, FriendSourceActivityEvidence>> =>
    usingBoundedReader && scanLibraryItems
      ? readSelectedAuthorActivity(scanLibraryItems, selectedKeys, signal)
      : readLegacySelectedAuthorActivity(items, selectedKeys, signal);

  if (!usingBoundedReader) {
    return {
      candidates: legacyCandidates,
      failed: false,
      ready: legacyItemsReady,
      resolveSelectedActivity,
    };
  }

  return {
    candidates: currentRead?.candidates ?? [],
    failed,
    ready: currentRead !== null || failed,
    resolveSelectedActivity,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendEditor({
  existing,
  draft,
  onSave,
  onDelete,
  onCancel,
}: FriendEditorProps) {
  const platform = usePlatform();
  const allFriends = useAppStore((s) => s.friends);
  const seed = existing ?? draft ?? null;

  // Form state
  const [name, setName] = useState(seed?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(seed?.avatarUrl ?? "");
  const [bio, setBio] = useState(seed?.bio ?? "");
  const [careLevel, setCareLevel] = useState<1 | 2 | 3 | 4 | 5>(
    seed?.careLevel ?? 3,
  );
  const [reachOutDays, setReachOutDays] = useState(
    seed?.reachOutIntervalDays?.toString() ?? "",
  );
  const [sources, setSources] = useState<FriendSource[]>(seed?.sources ?? []);
  const [contact, setContact] = useState<DeviceContact | undefined>(
    seed?.contact,
  );
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactPhone, setContactPhone] = useState(contact?.phone ?? "");
  const [contactEmail, setContactEmail] = useState(contact?.email ?? "");
  const [contactAddress, setContactAddress] = useState(contact?.address ?? "");
  const [tags, setTags] = useState(seed?.tags?.join(", ") ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState(
    () => new Set<string>(),
  );
  const [sourceActivitySaving, setSourceActivitySaving] = useState(false);
  const [sourceActivityError, setSourceActivityError] = useState(false);
  const sourceActivityRead = useRef<AbortController | null>(null);
  const [contactImporting, setContactImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(
    () => () => {
      sourceActivityRead.current?.abort();
    },
    [],
  );

  const authorCandidates = useAuthorCandidates(
    sources,
    allFriends,
    sourceSearch,
  );
  const candidates = authorCandidates.candidates;
  const selectedProfilesReady =
    selectedCandidateKeys.size === 0 ||
    (authorCandidates.ready && !authorCandidates.failed);
  const filteredCandidates = candidates.filter((c) => {
    const q = sourceSearch.toLowerCase();
    return (
      !q ||
      c.displayName.toLowerCase().includes(q) ||
      c.handle.toLowerCase().includes(q) ||
      c.platform.includes(q)
    );
  });

  const isSourceLinked = (c: AuthorCandidate) =>
    sources.some((s) => s.platform === c.platform && s.authorId === c.authorId);

  const toggleSource = (c: AuthorCandidate) => {
    setSourceActivityError(false);
    if (isSourceLinked(c)) {
      setSources((prev) =>
        prev.filter(
          (s) => !(s.platform === c.platform && s.authorId === c.authorId),
        ),
      );
      setSelectedCandidateKeys((current) => {
        const next = new Set(current);
        next.delete(authorCandidateKey(c));
        return next;
      });
    } else {
      setSources((prev) => [
        ...prev,
        {
          platform: c.platform,
          authorId: c.authorId,
          handle: c.handle,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
        },
      ]);
      setSelectedCandidateKeys((current) => {
        const next = new Set(current);
        next.add(authorCandidateKey(c));
        return next;
      });
    }
  };

  const handleImportContact = async () => {
    if (!platform.pickContact) {
      setShowContactForm(true);
      return;
    }
    setContactImporting(true);
    try {
      const result = await platform.pickContact();
      if (result) {
        if (!name) setName(result.name);
        setContact({
          importedFrom: "web",
          name: result.name,
          phone: result.phone,
          email: result.email,
          address: result.address,
          nativeId: result.nativeId,
          importedAt: Date.now(),
        });
        setContactPhone(result.phone ?? "");
        setContactEmail(result.email ?? "");
        setContactAddress(result.address ?? "");
      }
    } finally {
      setContactImporting(false);
    }
  };

  const handleSaveContactForm = () => {
    if (!contactPhone && !contactEmail && !contactAddress) {
      setContact(undefined);
    } else {
      setContact({
        importedFrom: "web",
        name: name || "Unknown",
        phone: contactPhone || undefined,
        email: contactEmail || undefined,
        address: contactAddress || undefined,
        importedAt: Date.now(),
      });
    }
    setShowContactForm(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !selectedProfilesReady || sourceActivitySaving) return;

    const parsedDays = parseInt(reachOutDays, 10);
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const data: EditorFriend = {
      name: name.trim(),
      avatarUrl: avatarUrl.trim() || undefined,
      bio: bio.trim() || undefined,
      relationshipStatus: existing?.relationshipStatus ?? "friend",
      sources,
      contact,
      careLevel,
      reachOutIntervalDays: isNaN(parsedDays) ? undefined : parsedDays,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      notes: notes.trim() || undefined,
    };

    if (selectedCandidateKeys.size === 0) {
      onSave(data, existing?.id);
      return;
    }

    const controller = new AbortController();
    sourceActivityRead.current?.abort();
    sourceActivityRead.current = controller;
    setSourceActivityError(false);
    setSourceActivitySaving(true);
    let sourceActivity: ReadonlyMap<string, FriendSourceActivityEvidence>;
    try {
      sourceActivity = await authorCandidates.resolveSelectedActivity(
        selectedCandidateKeys,
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) {
        sourceActivityRead.current = null;
        setSourceActivityError(true);
        setSourceActivitySaving(false);
      }
      return;
    }
    if (controller.signal.aborted) return;
    sourceActivityRead.current = null;
    setSourceActivitySaving(false);
    onSave(data, existing?.id, sourceActivity);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/60 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="theme-dialog-shell my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col sm:max-h-[90vh]">
        {/* Header */}
        <div className="theme-dialog-divider flex shrink-0 items-center gap-2 border-b px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary flex-1">
            {existing ? "Edit friend" : "Add friend"}
          </h2>
          <button
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="w-5 h-5"
              aria-hidden
            >
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <fieldset
          disabled={sourceActivitySaving}
          className="m-0 min-w-0 flex-1 space-y-5 overflow-y-auto border-0 px-5 py-4"
        >
          {/* Section 1: Basic info */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Basic info
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Avatar URL
                </label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Bio
                </label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Optional short bio"
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Section 2: Care level */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Relationship
            </h3>
            <div className="space-y-2">
              {([5, 4, 3, 2, 1] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setCareLevel(level)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                    careLevel === level ? "theme-chip-active" : "theme-chip"
                  }`}
                >
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <svg
                        key={i}
                        viewBox="0 0 12 12"
                        className={`w-3 h-3 ${i <= level ? "text-amber-400" : "text-white/15"}`}
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M6 1l1.5 3H11L8.5 6l1 3L6 7.5 2.5 9l1-3L1 4h3.5z" />
                      </svg>
                    ))}
                  </div>
                  <span className="text-xs text-text-secondary">
                    {CARE_LABELS[level]}
                  </span>
                </button>
              ))}
              <div className="mt-2">
                <label className="text-xs text-text-secondary mb-1 block">
                  Custom interval (days), overrides the default above
                </label>
                <input
                  type="number"
                  min={1}
                  value={reachOutDays}
                  onChange={(e) => setReachOutDays(e.target.value)}
                  placeholder="e.g. 21"
                  className="theme-input w-32 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Contact info */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Contact info
            </h3>
            {contact ? (
              <div className="theme-card-soft rounded-lg px-3 py-2.5 text-xs text-text-secondary space-y-0.5">
                {contact.phone && <p>Phone: {contact.phone}</p>}
                {contact.email && <p>Email: {contact.email}</p>}
                {contact.address && <p>Address: {contact.address}</p>}
                <button
                  className="theme-link mt-1 transition-colors"
                  onClick={() => {
                    setContact(undefined);
                    setContactPhone("");
                    setContactEmail("");
                    setContactAddress("");
                  }}
                >
                  Remove contact info
                </button>
              </div>
            ) : showContactForm ? (
              <div className="space-y-2">
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone"
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Email"
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  placeholder="Address"
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setShowContactForm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="theme-chip-active rounded-lg px-3 py-1.5 text-xs font-medium"
                    onClick={handleSaveContactForm}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleImportContact}
                disabled={contactImporting}
                className="btn-secondary flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {contactImporting ? (
                  <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="w-3.5 h-3.5"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-6-3a3 3 0 11-6 0 3 3 0 016 0zM2 17a6 6 0 0112 0"
                    />
                  </svg>
                )}
                {platform.pickContact
                  ? "Import from Contacts"
                  : "Enter contact info manually"}
              </button>
            )}
          </section>

          {/* Section 4: Social sources */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Social profiles
            </h3>

            {/* Currently linked */}
            {sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {sources.map((src) => (
                  <span
                    key={`${src.platform}-${src.authorId}`}
                    className="theme-chip-active inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1 text-xs"
                  >
                    {platformIcons[src.platform]}
                    <span className="truncate max-w-[80px]">
                      {src.handle ?? src.displayName}
                    </span>
                    <button
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[color:var(--theme-text-secondary)] transition-colors hover:bg-[color:var(--theme-bg-card)] hover:text-[color:var(--theme-text-primary)]"
                      onClick={() =>
                        toggleSource({ ...src } as AuthorCandidate)
                      }
                      aria-label={`Unlink ${src.handle}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search + candidates */}
            <SearchField
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              onClear={() => setSourceSearch("")}
              placeholder="Search profiles in your feed..."
              aria-label="Search profiles in your feed"
              containerClassName="mb-2"
            />

            {filteredCandidates.length === 0 && (
              <p className="text-xs text-text-tertiary py-2">
                {authorCandidates.failed
                  ? "Captured profiles are temporarily unavailable."
                  : !authorCandidates.ready
                    ? "Loading captured profiles..."
                    : sourceSearch || candidates.length > 0
                      ? "No matches."
                      : "No unlinked profiles in your feed yet."}
              </p>
            )}

            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {filteredCandidates
                .slice(0, FRIEND_EDITOR_AUTHOR_CANDIDATE_LIMIT)
                .map((c) => (
                  <button
                    key={`${c.platform}-${c.authorId}`}
                    data-testid="friend-author-candidate"
                    onClick={() => toggleSource(c)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left"
                  >
                    <ChannelAvatar
                      name={c.displayName}
                      avatarUrl={c.avatarUrl}
                      size={24}
                      className="text-xs"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-xs text-text-primary truncate block">
                        {c.displayName}
                      </span>
                      <span className="text-xs text-text-tertiary truncate block">
                        {platformIcons[c.platform]} {c.handle}
                      </span>
                    </span>
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSourceLinked(c)
                          ? "border-[color:var(--theme-border-strong)] bg-[color:var(--theme-accent-secondary)] text-white"
                          : "border-[color:var(--theme-border-subtle)]"
                      }`}
                      aria-hidden
                    >
                      {isSourceLinked(c) && (
                        <svg
                          viewBox="0 0 10 8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          className="w-2.5 h-2.5"
                          aria-hidden
                        >
                          <path d="M1 4l3 3 5-6" />
                        </svg>
                      )}
                    </span>
                  </button>
                ))}
            </div>
            {sourceActivityError && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                Profile history could not be verified. Try saving again.
              </p>
            )}
          </section>

          {/* Section 5: Tags & notes */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Tags &amp; notes
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="work, college, hiking..."
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you want to remember..."
                  rows={3}
                  className="theme-input w-full resize-none rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Danger: delete */}
          {existing && onDelete && (
            <section className="border-t border-white/10 pt-4">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-red-400 flex-1">
                    Remove {existing.name} from your friends?
                  </p>
                  <button
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    onClick={() => onDelete(existing.id)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove friend
                </button>
              )}
            </section>
          )}
        </fieldset>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 shrink-0">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1 rounded-lg px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={
              !name.trim() || !selectedProfilesReady || sourceActivitySaving
            }
            className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sourceActivitySaving
              ? "Verifying profiles..."
              : existing
                ? "Save changes"
                : "Add friend"}
          </button>
        </div>
      </div>
    </div>
  );
}
