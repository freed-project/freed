/**
 * @freed/shared - Automerge document schema
 *
 * CRDT-based storage for conflict-free multi-device sync
 */

import * as A from "@automerge/automerge";
import type {
  Account,
  FeedItem,
  Friend,
  LegacyDeviceContact,
  LegacyFriendSource,
  Person,
  ReachOutLog,
  RssFeed,
  UserPreferences,
  DocumentMeta,
  FacebookCapturePreferences,
  ContentSignal,
  ContentSignalBackfillSummary,
  ContentSignals,
} from "./types.js";
import { createDefaultPreferences, createDefaultMeta } from "./types.js";
import { friendForAuthor, personForAuthor } from "./friends.js";
import {
  CONTENT_SIGNAL_KEYS,
  CONTENT_SIGNAL_VERSION,
  hasCurrentContentSignals,
  inferContentSignals,
} from "./content-signals.js";

// =============================================================================
// Document Schema
// =============================================================================

/**
 * Root Freed document structure
 *
 * This is the Automerge document that syncs across all devices.
 * Using Record<string, T> for CRDT-friendly map operations.
 */
export interface FreedDoc {
  /** Feed items indexed by globalId */
  feedItems: Record<string, FeedItem>;

  /** RSS feed subscriptions indexed by URL */
  rssFeeds: Record<string, RssFeed>;

  /** Canonical same-human identities indexed by Person.id */
  persons: Record<string, Person>;

  /** Attached social/contact nodes indexed by Account.id */
  accounts: Record<string, Account>;

  /** User preferences */
  preferences: UserPreferences;

  /** Document metadata */
  meta: DocumentMeta;
}

// =============================================================================
// Document Creation
// =============================================================================

/**
 * Create a new empty Freed document
 */
export function createEmptyDoc(): FreedDoc {
  const doc: FreedDoc = {
    feedItems: {},
    rssFeeds: {},
    persons: {},
    accounts: {},
    preferences: createDefaultPreferences(),
    meta: createDefaultMeta(),
  };
  return A.from(
    doc as unknown as Record<string, unknown>
  ) as unknown as FreedDoc;
}

/**
 * Initialize document from existing data (for migrations)
 */
export function createDocFromData(data: Partial<FreedDoc>): FreedDoc {
  const migrated = migrateLegacyIdentityData(data);
  const doc: FreedDoc = {
    feedItems: migrated.feedItems ?? {},
    rssFeeds: migrated.rssFeeds ?? {},
    persons: migrated.persons ?? {},
    accounts: migrated.accounts ?? {},
    preferences: migrated.preferences ?? createDefaultPreferences(),
    meta: migrated.meta ?? createDefaultMeta(),
  };
  return A.from(
    doc as unknown as Record<string, unknown>
  ) as unknown as FreedDoc;
}

interface LegacyFriend {
  id: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  sources: LegacyFriendSource[];
  contact?: LegacyDeviceContact;
  careLevel: 1 | 2 | 3 | 4 | 5;
  reachOutIntervalDays?: number;
  reachOutLog?: ReachOutLog[];
  tags?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyFreedDoc extends Partial<FreedDoc> {
  friends?: Record<string, LegacyFriend>;
}

function contactProviderForLegacyContact(contact: LegacyDeviceContact): Account["provider"] {
  switch (contact.importedFrom) {
    case "google":
      return "google_contacts";
    case "macos":
      return "macos_contacts";
    case "ios":
      return "ios_contacts";
    case "android":
      return "android_contacts";
    case "web":
    default:
      return "web_contact";
  }
}

function accountIdForLegacySocial(personId: string, source: LegacyFriendSource): string {
  return `${personId}:${source.platform}:${source.authorId}`;
}

function accountIdForLegacyContact(personId: string, contact: LegacyDeviceContact): string {
  return `${personId}:contact:${contact.nativeId ?? contact.name}`;
}

function migrateLegacyIdentityData(data: Partial<FreedDoc>): Partial<FreedDoc> {
  const current = data as LegacyFreedDoc;
  if (current.persons || current.accounts || !current.friends) {
    return data;
  }

  const persons: Record<string, Person> = {};
  const accounts: Record<string, Account> = {};

  for (const legacy of Object.values(current.friends)) {
    persons[legacy.id] = stripUndefined({
      id: legacy.id,
      name: legacy.name,
      avatarUrl: legacy.avatarUrl,
      bio: legacy.bio,
      relationshipStatus: "friend",
      careLevel: legacy.careLevel,
      reachOutIntervalDays: legacy.reachOutIntervalDays,
      reachOutLog: legacy.reachOutLog,
      tags: legacy.tags,
      notes: legacy.notes,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });

    for (const source of legacy.sources ?? []) {
      const accountId = accountIdForLegacySocial(legacy.id, source);
      accounts[accountId] = stripUndefined({
        id: accountId,
        personId: legacy.id,
        kind: "social",
        provider: source.platform,
        externalId: source.authorId,
        handle: source.handle,
        displayName: source.displayName,
        avatarUrl: source.avatarUrl,
        profileUrl: source.profileUrl,
        firstSeenAt: legacy.createdAt,
        lastSeenAt: legacy.updatedAt,
        discoveredFrom: "captured_item",
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      });
    }

    if (legacy.contact) {
      const accountId = accountIdForLegacyContact(legacy.id, legacy.contact);
      accounts[accountId] = stripUndefined({
        id: accountId,
        personId: legacy.id,
        kind: "contact",
        provider: contactProviderForLegacyContact(legacy.contact),
        externalId: legacy.contact.nativeId ?? legacy.contact.name,
        displayName: legacy.contact.name,
        email: legacy.contact.email,
        phone: legacy.contact.phone,
        address: legacy.contact.address,
        importedAt: legacy.contact.importedAt,
        firstSeenAt: legacy.contact.importedAt,
        lastSeenAt: legacy.updatedAt,
        discoveredFrom: "contact_import",
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      });
    }
  }

  return {
    ...data,
    persons,
    accounts,
  };
}

function ensureIdentityGraphRoots(doc: FreedDoc): void {
  const root = doc as FreedDoc & {
    persons?: Record<string, Person>;
    accounts?: Record<string, Account>;
  };

  if (!root.persons) {
    root.persons = {};
  }
  if (!root.accounts) {
    root.accounts = {};
  }
}

function addLegacyFriendToIdentityGraph(doc: FreedDoc, legacy: LegacyFriend): void {
  ensureIdentityGraphRoots(doc);

  if (!doc.persons[legacy.id]) {
    doc.persons[legacy.id] = normalizePerson({
      id: legacy.id,
      name: legacy.name,
      avatarUrl: legacy.avatarUrl,
      bio: legacy.bio,
      relationshipStatus: "friend",
      careLevel: legacy.careLevel,
      reachOutIntervalDays: legacy.reachOutIntervalDays,
      reachOutLog: legacy.reachOutLog,
      tags: legacy.tags,
      notes: legacy.notes,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });
  }

  for (const source of legacy.sources ?? []) {
    const accountId = accountIdForLegacySocial(legacy.id, source);
    if (!doc.accounts[accountId]) {
      doc.accounts[accountId] = stripUndefined({
        id: accountId,
        personId: legacy.id,
        kind: "social",
        provider: source.platform,
        externalId: source.authorId,
        handle: source.handle,
        displayName: source.displayName,
        avatarUrl: source.avatarUrl,
        profileUrl: source.profileUrl,
        firstSeenAt: legacy.createdAt,
        lastSeenAt: legacy.updatedAt,
        discoveredFrom: "captured_item",
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      });
    }
  }

  if (!legacy.contact) return;

  const accountId = accountIdForLegacyContact(legacy.id, legacy.contact);
  if (!doc.accounts[accountId]) {
    doc.accounts[accountId] = stripUndefined({
      id: accountId,
      personId: legacy.id,
      kind: "contact",
      provider: contactProviderForLegacyContact(legacy.contact),
      externalId: legacy.contact.nativeId ?? legacy.contact.name,
      displayName: legacy.contact.name,
      email: legacy.contact.email,
      phone: legacy.contact.phone,
      address: legacy.contact.address,
      importedAt: legacy.contact.importedAt,
      firstSeenAt: legacy.contact.importedAt,
      lastSeenAt: legacy.updatedAt,
      discoveredFrom: "contact_import",
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });
  }
}

export function hasLegacyIdentityGraphData(doc: FreedDoc): boolean {
  const root = doc as FreedDoc & {
    friends?: Record<string, LegacyFriend>;
    persons?: Record<string, Person>;
    accounts?: Record<string, Account>;
  };

  return !root.persons || !root.accounts || !!root.friends;
}

export function migrateLegacyIdentityGraph(doc: FreedDoc): boolean {
  const root = doc as FreedDoc & {
    friends?: Record<string, LegacyFriend>;
  };
  let changed = false;

  if (!(doc as FreedDoc & { persons?: Record<string, Person> }).persons) {
    (doc as FreedDoc & { persons?: Record<string, Person> }).persons = {};
    changed = true;
  }
  if (!(doc as FreedDoc & { accounts?: Record<string, Account> }).accounts) {
    (doc as FreedDoc & { accounts?: Record<string, Account> }).accounts = {};
    changed = true;
  }

  const legacyFriends = root.friends;
  if (!legacyFriends) {
    return changed;
  }

  for (const legacy of Object.values(legacyFriends)) {
    const personExists = !!doc.persons[legacy.id];
    const socialAccountIds = (legacy.sources ?? []).map((source) =>
      accountIdForLegacySocial(legacy.id, source),
    );
    const missingSocialAccount = socialAccountIds.some((id) => !doc.accounts[id]);
    const contactAccountId = legacy.contact
      ? accountIdForLegacyContact(legacy.id, legacy.contact)
      : null;
    const missingContactAccount = contactAccountId
      ? !doc.accounts[contactAccountId]
      : false;

    if (personExists && !missingSocialAccount && !missingContactAccount) {
      continue;
    }

    addLegacyFriendToIdentityGraph(doc, legacy);
    changed = true;
  }

  return changed;
}

// =============================================================================
// Feed Item Operations
// =============================================================================

/**
 * Recursively remove any keys whose value is `undefined` from a plain object.
 *
 * Automerge's CRDT proxy throws on `undefined` assignments. This is a
 * last-resort defensive sanitizer applied before writing to the document —
 * normalizers should already produce clean objects, but this prevents a single
 * bad optional field from crashing the whole capture.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        result[k] = stripUndefined(v);
      }
    }
    return result as T;
  }
  return value;
}

const CROSS_POST_WINDOW_MS = 5 * 60 * 1000;
const CROSS_POST_TEXT_PREFIX_LENGTH = 120;
const CROSS_POST_MIN_TEXT_LENGTH = 24;
const CROSS_POST_PLATFORMS = new Set<FeedItem["platform"]>([
  "facebook",
  "instagram",
]);
const SAME_PLATFORM_STORY_DEDUP_WINDOW_MS = 10 * 60 * 1000;

type LegacyFriendRoot = FreedDoc & {
  friends?: Record<string, Friend>;
};

function dedupLinkPreviewScore(
  preview: FeedItem["content"]["linkPreview"] | undefined,
): number {
  if (!preview) return 0;
  return (preview.url ? 1 : 0) + (preview.title ? 1 : 0) + (preview.description ? 1 : 0);
}

function dedupMediaScore(item: FeedItem): number {
  return (item.content.mediaUrls?.length ?? 0) + (item.content.mediaTypes?.length ?? 0);
}

function dedupUserStateScore(item: FeedItem): number {
  const userState = item.userState;
  return (
    (userState.saved ? 100 : 0) +
    ((userState.tags?.length ?? 0) * 10) +
    ((userState.highlights?.length ?? 0) * 10) +
    (userState.archived ? 5 : 0) +
    (userState.readAt ? 1 : 0) +
    (userState.liked ? 2 : 0)
  );
}

function dedupMetadataScore(item: FeedItem): number {
  return (
    (item.location ? 40 : 0) +
    (item.timeRange ? 35 : 0) +
    (item.preservedContent ? 30 : 0) +
    dedupMediaScore(item) * 3 +
    dedupLinkPreviewScore(item.content.linkPreview) * 5 +
    (item.sourceUrl ? 5 : 0) +
    (item.fbGroup ? 2 : 0) +
    ((item.content.text?.length ?? 0) >= 120 ? 4 : 0)
  );
}

function dedupKeeperScore(item: FeedItem): number {
  return dedupUserStateScore(item) + dedupMetadataScore(item);
}

function normalizedDedupText(item: FeedItem): string | null {
  const raw = item.content.text ?? item.content.linkPreview?.title ?? "";
  const normalized = raw
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/www\.\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < CROSS_POST_MIN_TEXT_LENGTH) return null;
  return normalized.slice(0, CROSS_POST_TEXT_PREFIX_LENGTH).trim();
}

function normalizedStoryDedupText(item: FeedItem): string {
  return (item.content.text ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/www\.\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CROSS_POST_TEXT_PREFIX_LENGTH);
}

function normalizedStoryMediaKey(item: FeedItem): string {
  return item.content.mediaUrls[0] ?? item.sourceUrl ?? "";
}

function samePlatformStoryDedupKey(item: FeedItem): string | null {
  if (!CROSS_POST_PLATFORMS.has(item.platform)) return null;
  if (item.contentType !== "story") return null;

  const mediaKey = normalizedStoryMediaKey(item);
  const textKey = normalizedStoryDedupText(item);
  if (!mediaKey && !textKey) return null;

  const authorKey = item.author.id || item.author.handle || item.author.displayName;
  const publishedBucket = Math.floor(item.publishedAt / SAME_PLATFORM_STORY_DEDUP_WINDOW_MS);
  const locationKey = item.location?.url ?? item.location?.name ?? "";

  return [
    item.platform,
    authorKey,
    publishedBucket.toString(),
    mediaKey,
    locationKey,
    textKey,
  ].join("::");
}

function dedupIdentityKey(doc: FreedDoc, item: FeedItem): string | null {
  const person = personForAuthor(doc.persons ?? {}, doc.accounts ?? {}, item.platform, item.author.id);
  if (person) return `person:${person.id}`;

  const legacyFriends = (doc as LegacyFriendRoot).friends;
  if (!legacyFriends) return null;
  const legacyFriend = friendForAuthor(legacyFriends, item.platform, item.author.id);
  return legacyFriend ? `friend:${legacyFriend.id}` : null;
}

function ensureParent(parent: Map<string, string>, id: string): string {
  const existing = parent.get(id);
  if (existing) return existing;
  parent.set(id, id);
  return id;
}

function findParent(parent: Map<string, string>, id: string): string {
  const root = ensureParent(parent, id);
  if (root === id) return root;
  const resolved = findParent(parent, root);
  parent.set(id, resolved);
  return resolved;
}

function unionParents(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = findParent(parent, left);
  const rightRoot = findParent(parent, right);
  if (leftRoot !== rightRoot) {
    parent.set(rightRoot, leftRoot);
  }
}

function addDedupGroup(parent: Map<string, string>, ids: string[]): void {
  if (ids.length <= 1) return;
  const [first, ...rest] = ids;
  ensureParent(parent, first);
  for (const id of rest) {
    unionParents(parent, first, id);
  }
}

function mergeUniqueStrings(target: string[], source: string[] | undefined): void {
  if (!source || source.length === 0) return;
  const seen = new Set(target);
  for (const value of source) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}

function assignOptionalField(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function mergeHighlights(
  target: FeedItem["userState"],
  source: FeedItem["userState"],
): void {
  if (!source.highlights || source.highlights.length === 0) return;
  if (!target.highlights) {
    target.highlights = [];
  }
  const seen = new Set(target.highlights.map((entry) => JSON.stringify(entry)));
  for (const highlight of source.highlights) {
    const key = JSON.stringify(highlight);
    if (seen.has(key)) continue;
    seen.add(key);
    target.highlights.push(stripUndefined(highlight));
  }
}

function mergeTimestamp(
  left?: number,
  right?: number,
  mode: "min" | "max" = "min",
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return mode === "min" ? Math.min(left, right) : Math.max(left, right);
}

function mergeSyncedTimestamp(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left > 0 || right > 0) {
    if (left <= 0) return right;
    if (right <= 0) return left;
    return Math.max(left, right);
  }
  return Math.min(left, right);
}

function mergeUserState(target: FeedItem["userState"], source: FeedItem["userState"]): void {
  target.hidden = target.hidden || source.hidden;
  target.saved = target.saved || source.saved;
  target.archived = target.archived || source.archived;
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "liked",
    target.liked || source.liked || undefined,
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "readAt",
    mergeTimestamp(target.readAt, source.readAt, "min"),
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "savedAt",
    mergeTimestamp(target.savedAt, source.savedAt, "min"),
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "archivedAt",
    mergeTimestamp(target.archivedAt, source.archivedAt, "min"),
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "likedAt",
    mergeTimestamp(target.likedAt, source.likedAt, "min"),
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "likedSyncedAt",
    mergeSyncedTimestamp(target.likedSyncedAt, source.likedSyncedAt),
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "seenSyncedAt",
    mergeSyncedTimestamp(target.seenSyncedAt, source.seenSyncedAt),
  );
  mergeUniqueStrings(target.tags, source.tags);
  mergeHighlights(target, source);
}

function applyContentSignalsToItem(
  item: FeedItem,
  signals: ContentSignals = inferContentSignals(item),
): void {
  const clean = stripUndefined(signals);
  if (!item.contentSignals) {
    item.contentSignals = clean;
    return;
  }

  const target = item.contentSignals;
  target.version = clean.version;
  target.method = clean.method;
  target.inferredAt = clean.inferredAt;

  if (!target.scores) {
    target.scores = {};
  }
  for (const key of Object.keys(target.scores) as ContentSignal[]) {
    delete target.scores[key];
  }
  for (const signal of CONTENT_SIGNAL_KEYS) {
    const score = clean.scores[signal];
    if (score !== undefined) {
      target.scores[signal] = score;
    }
  }

  if (!target.tags) {
    target.tags = [];
  }
  target.tags.splice(0, target.tags.length, ...clean.tags);
}

function feedItemUpdatesAffectContentSignals(updates: Partial<FeedItem>): boolean {
  return (
    "author" in updates ||
    "content" in updates ||
    "contentType" in updates ||
    "location" in updates ||
    "timeRange" in updates ||
    "preservedContent" in updates ||
    "publishedAt" in updates ||
    "rssSource" in updates ||
    "sourceUrl" in updates ||
    "topics" in updates
  );
}

function mergeEngagement(target: FeedItem, source: FeedItem): void {
  if (!source.engagement) return;
  if (!target.engagement) {
    target.engagement = stripUndefined(source.engagement);
    return;
  }
  assignOptionalField(
    target.engagement as unknown as Record<string, unknown>,
    "likes",
    Math.max(target.engagement.likes ?? 0, source.engagement.likes ?? 0) || undefined,
  );
  assignOptionalField(
    target.engagement as unknown as Record<string, unknown>,
    "reposts",
    Math.max(target.engagement.reposts ?? 0, source.engagement.reposts ?? 0) || undefined,
  );
  assignOptionalField(
    target.engagement as unknown as Record<string, unknown>,
    "comments",
    Math.max(target.engagement.comments ?? 0, source.engagement.comments ?? 0) || undefined,
  );
  assignOptionalField(
    target.engagement as unknown as Record<string, unknown>,
    "views",
    Math.max(target.engagement.views ?? 0, source.engagement.views ?? 0) || undefined,
  );
}

function mergeLinkPreview(target: FeedItem["content"], source: FeedItem["content"]): void {
  if (!source.linkPreview) return;
  if (!target.linkPreview) {
    target.linkPreview = stripUndefined(source.linkPreview);
    return;
  }
  if (!target.linkPreview.url && source.linkPreview.url) {
    target.linkPreview.url = source.linkPreview.url;
  }
  if (
    source.linkPreview.title &&
    (!target.linkPreview.title || source.linkPreview.title.length > target.linkPreview.title.length)
  ) {
    target.linkPreview.title = source.linkPreview.title;
  }
  if (
    source.linkPreview.description &&
    (!target.linkPreview.description || source.linkPreview.description.length > target.linkPreview.description.length)
  ) {
    target.linkPreview.description = source.linkPreview.description;
  }
}

function mergeFeedItemInto(target: FeedItem, source: FeedItem): void {
  target.capturedAt = Math.min(target.capturedAt, source.capturedAt);
  target.publishedAt = Math.min(target.publishedAt, source.publishedAt);

  if ((source.content.text?.length ?? 0) > (target.content.text?.length ?? 0)) {
    target.content.text = source.content.text;
  }
  mergeLinkPreview(target.content, source.content);
  mergeUniqueStrings(target.content.mediaUrls, source.content.mediaUrls);
  mergeUniqueStrings(target.content.mediaTypes, source.content.mediaTypes);

  if (!target.location && source.location) {
    target.location = stripUndefined(source.location);
  } else if (target.location && source.location) {
    if (!target.location.coordinates && source.location.coordinates) {
      target.location.coordinates = stripUndefined(source.location.coordinates);
    }
    if (!target.location.url && source.location.url) {
      target.location.url = source.location.url;
    }
    if ((!target.location.name || target.location.name === "Location") && source.location.name) {
      target.location.name = source.location.name;
    }
  }

  if (!target.timeRange && source.timeRange) {
    target.timeRange = stripUndefined(source.timeRange);
  }
  if (!target.rssSource && source.rssSource) {
    target.rssSource = stripUndefined(source.rssSource);
  }
  if (!target.fbGroup && source.fbGroup) {
    target.fbGroup = stripUndefined(source.fbGroup);
  }
  if (!target.preservedContent && source.preservedContent) {
    target.preservedContent = stripUndefined(source.preservedContent);
  }
  if (!target.sourceUrl && source.sourceUrl) {
    target.sourceUrl = source.sourceUrl;
  }
  if (
    (source.author.avatarUrl?.length ?? 0) > (target.author.avatarUrl?.length ?? 0)
  ) {
    target.author.avatarUrl = source.author.avatarUrl;
  }
  if (
    source.author.displayName &&
    (!target.author.displayName || source.author.displayName.length > target.author.displayName.length)
  ) {
    target.author.displayName = source.author.displayName;
  }
  mergeUniqueStrings(target.topics, source.topics);
  mergeEngagement(target, source);
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "priority",
    Math.max(target.priority ?? 0, source.priority ?? 0) || undefined,
  );
  assignOptionalField(
    target as unknown as Record<string, unknown>,
    "priorityComputedAt",
    mergeTimestamp(
      target.priorityComputedAt,
      source.priorityComputedAt,
      "max",
    ),
  );
  mergeUserState(target.userState, source.userState);
  applyContentSignalsToItem(target);
}

function dedupKeeperId(doc: FreedDoc, ids: string[]): string {
  return [...ids].sort((leftId, rightId) => {
    const left = doc.feedItems[leftId];
    const right = doc.feedItems[rightId];
    return (
      dedupKeeperScore(right) - dedupKeeperScore(left) ||
      right.publishedAt - left.publishedAt ||
      rightId.localeCompare(leftId)
    );
  })[0];
}

export function deduplicateDocFeedItems(doc: FreedDoc): number {
  const unions = new Map<string, string>();
  const exactUrlGroups = new Map<string, string[]>();

  for (const [id, item] of Object.entries(doc.feedItems) as [string, FeedItem][]) {
    const url = item.content.linkPreview?.url;
    if (!url) continue;
    const group = exactUrlGroups.get(url);
    if (group) group.push(id);
    else exactUrlGroups.set(url, [id]);
  }

  for (const ids of exactUrlGroups.values()) {
    addDedupGroup(unions, ids);
  }

  const samePlatformStoryGroups = new Map<string, string[]>();
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    const groupKey = samePlatformStoryDedupKey(item);
    if (!groupKey) continue;
    const group = samePlatformStoryGroups.get(groupKey);
    if (group) group.push(item.globalId);
    else samePlatformStoryGroups.set(groupKey, [item.globalId]);
  }

  for (const ids of samePlatformStoryGroups.values()) {
    addDedupGroup(unions, ids);
  }

  const crossPostGroups = new Map<string, FeedItem[]>();
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (!CROSS_POST_PLATFORMS.has(item.platform)) continue;
    const identityKey = dedupIdentityKey(doc, item);
    const textKey = normalizedDedupText(item);
    if (!identityKey || !textKey) continue;
    const groupKey = `${identityKey}:${item.contentType}:${textKey}`;
    const group = crossPostGroups.get(groupKey);
    if (group) group.push(item);
    else crossPostGroups.set(groupKey, [item]);
  }

  for (const group of crossPostGroups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(
      (left, right) => left.publishedAt - right.publishedAt || left.globalId.localeCompare(right.globalId),
    );
    let cluster: FeedItem[] = [];
    for (const item of sorted) {
      if (
        cluster.length === 0 ||
        item.publishedAt - cluster[0].publishedAt <= CROSS_POST_WINDOW_MS
      ) {
        cluster.push(item);
        continue;
      }
      if (new Set(cluster.map((entry) => entry.platform)).size > 1) {
        addDedupGroup(unions, cluster.map((entry) => entry.globalId));
      }
      cluster = [item];
    }
    if (new Set(cluster.map((entry) => entry.platform)).size > 1) {
      addDedupGroup(unions, cluster.map((entry) => entry.globalId));
    }
  }

  const components = new Map<string, string[]>();
  for (const id of unions.keys()) {
    const root = findParent(unions, id);
    const group = components.get(root);
    if (group) group.push(id);
    else components.set(root, [id]);
  }

  let deleted = 0;
  for (const ids of components.values()) {
    if (ids.length <= 1) continue;
    const keepId = dedupKeeperId(doc, ids);
    const keeper = doc.feedItems[keepId];
    if (!keeper) continue;
    for (const id of ids) {
      if (id === keepId) continue;
      const duplicate = doc.feedItems[id];
      if (!duplicate) continue;
      mergeFeedItemInto(keeper, duplicate);
      delete doc.feedItems[id];
      deleted += 1;
    }
  }

  return deleted;
}

function normalizePerson(person: Person): Person {
  return stripUndefined({
    id: person.id,
    name: person.name,
    avatarUrl: person.avatarUrl,
    bio: person.bio,
    relationshipStatus: person.relationshipStatus,
    careLevel: person.careLevel,
    reachOutIntervalDays: person.reachOutIntervalDays,
    reachOutLog: person.reachOutLog,
    tags: person.tags,
    notes: person.notes,
    graphX: person.graphX,
    graphY: person.graphY,
    graphPinned: person.graphPinned,
    graphUpdatedAt: person.graphUpdatedAt,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  });
}

/**
 * Add a feed item to the document
 *
 * Strips any `undefined` values before writing — Automerge's proxy throws on
 * them, and a single bad optional field would otherwise crash the whole capture.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param item - The feed item to add
 */
export function addFeedItem(doc: FreedDoc, item: FeedItem): void {
  const next = stripUndefined({ ...item }) as FeedItem;
  if (!hasCurrentContentSignals(next)) {
    applyContentSignalsToItem(next);
  }
  doc.feedItems[item.globalId] = stripUndefined(next);
}

/**
 * Update a feed item in the document
 *
 * Strips `undefined` values before writing — callers may produce partial
 * updates where optional fields are `undefined` (e.g. `savedAt` when
 * un-saving, `author` when content extraction yields nothing).
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param updates - Partial updates to apply
 */
export function updateFeedItem(
  doc: FreedDoc,
  globalId: string,
  updates: Partial<FeedItem>
): void {
  const existing = doc.feedItems[globalId];
  if (existing) {
    const cleanUpdates = stripUndefined(updates);
    const nextSignals = cleanUpdates.contentSignals;
    delete cleanUpdates.contentSignals;
    Object.assign(existing, cleanUpdates);
    if (nextSignals) {
      applyContentSignalsToItem(existing, nextSignals);
    } else if (feedItemUpdatesAffectContentSignals(updates)) {
      applyContentSignalsToItem(existing);
    }
  }
}

function createEmptyContentSignalCounts(): Record<ContentSignal, number> {
  return {
    event: 0,
    essay: 0,
    moment: 0,
    life_update: 0,
    announcement: 0,
    recommendation: 0,
    request: 0,
    discussion: 0,
    promotion: 0,
    news: 0,
  };
}

function summarizeContentSignals(
  doc: FreedDoc,
  updated: number,
  scanned: number,
  remaining: number,
): ContentSignalBackfillSummary {
  const counts = createEmptyContentSignalCounts();
  const samples: Partial<Record<ContentSignal, string[]>> = {};
  let multiSignalCount = 0;
  let untaggedCount = 0;
  let total = 0;

  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    total += 1;
    const tags = item.contentSignals?.tags ?? [];
    if (tags.length === 0) {
      untaggedCount += 1;
      continue;
    }
    if (tags.length > 1) {
      multiSignalCount += 1;
    }
    for (const tag of tags) {
      counts[tag] += 1;
      const signalSamples = samples[tag] ?? [];
      if (signalSamples.length < 5) {
        signalSamples.push(`...${item.globalId.slice(-8)}`);
        samples[tag] = signalSamples;
      }
    }
  }

  return {
    version: CONTENT_SIGNAL_VERSION,
    total,
    scanned,
    updated,
    remaining,
    counts,
    multiSignalCount,
    untaggedCount,
    samples,
  };
}

export function summarizeDocContentSignals(doc: FreedDoc): ContentSignalBackfillSummary {
  return summarizeContentSignals(doc, 0, 0, 0);
}

export function countContentSignalBackfillItems(doc: FreedDoc): number {
  return (Object.values(doc.feedItems) as FeedItem[]).filter(
    (item) => !hasCurrentContentSignals(item),
  ).length;
}

export function backfillContentSignals(
  doc: FreedDoc,
  batchSize: number = 200,
): ContentSignalBackfillSummary {
  const staleItems = (Object.values(doc.feedItems) as FeedItem[]).filter(
    (item) => !hasCurrentContentSignals(item),
  );
  const batch = staleItems.slice(0, Math.max(1, batchSize));

  for (const item of batch) {
    applyContentSignalsToItem(item);
  }

  return summarizeContentSignals(
    doc,
    batch.length,
    batch.length,
    Math.max(0, staleItems.length - batch.length),
  );
}

/**
 * Remove a feed item from the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function removeFeedItem(doc: FreedDoc, globalId: string): void {
  delete doc.feedItems[globalId];
}

/**
 * Mark a feed item as read
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function markAsRead(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.readAt = Date.now();
  }
}

/**
 * Mark multiple feed items as read in a single Automerge change.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalIds - The item IDs to mark as read
 */
export function markItemsAsRead(doc: FreedDoc, globalIds: readonly string[]): void {
  const now = Date.now();
  for (const globalId of globalIds) {
    const item = doc.feedItems[globalId];
    if (!item || item.userState.readAt) continue;
    item.userState.readAt = now;
  }
}

/**
 * Toggle archived status for a feed item, maintaining the archivedAt timestamp.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleArchived(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (!item) return;
  // Bookmarked items cannot be archived -- saved always wins.
  if (item.userState.saved) return;
  if (item.userState.archived) {
    item.userState.archived = false;
    delete (item.userState as unknown as Record<string, unknown>).archivedAt;
  } else {
    item.userState.archived = true;
    item.userState.archivedAt = Date.now();
  }
}

/**
 * Archive all read, non-saved items — optionally scoped to a platform or feed.
 * Skips items already archived, hidden, or saved.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param platform - Optional platform filter (e.g. "rss", "x")
 * @param feedUrl - Optional RSS feed URL filter
 */
export function archiveAllReadUnsaved(
  doc: FreedDoc,
  platform?: string,
  feedUrl?: string,
): number {
  const now = Date.now();
  let count = 0;
  for (const item of Object.values(doc.feedItems)) {
    if (item.userState.archived) continue;
    if (item.userState.hidden) continue;
    if (item.userState.saved) continue;
    if (!item.userState.readAt) continue;
    if (platform && item.platform !== platform) continue;
    if (feedUrl && item.rssSource?.feedUrl !== feedUrl) continue;
    item.userState.archived = true;
    item.userState.archivedAt = now;
    count++;
  }
  return count;
}

/**
 * Delete archived items older than maxAgeMs. Saved items are never deleted.
 * Items archived before archivedAt was introduced (no timestamp) are skipped.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param maxAgeMs - Max age in milliseconds (default: 30 days)
 * @returns Number of items deleted
 */
export function pruneArchivedItems(
  doc: FreedDoc,
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): number {
  if (maxAgeMs <= 0) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (!item.userState.archived) continue;
    if (item.userState.saved) continue;
    const { archivedAt } = item.userState;
    if (archivedAt !== undefined && archivedAt < cutoff) {
      delete doc.feedItems[id];
      pruned++;
    }
  }
  return pruned;
}

/**
 * Immediately delete all archived, non-saved items regardless of age.
 * Use when the user explicitly requests "delete now" from the archive toolbar.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @returns Number of items deleted
 */
export function deleteAllArchivedItems(doc: FreedDoc): number {
  let deleted = 0;
  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (!item.userState.archived) continue;
    if (item.userState.saved) continue;
    delete doc.feedItems[id];
    deleted++;
  }
  return deleted;
}

/**
 * Clear stale archived state from any saved items.
 * This repairs legacy or imported states where an item ended up both saved and archived.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @returns Number of items repaired
 */
export function unarchiveSavedItems(doc: FreedDoc): number {
  let repaired = 0;
  for (const item of Object.values(doc.feedItems)) {
    if (!item.userState.saved) continue;
    if (!item.userState.archived) continue;
    item.userState.archived = false;
    delete (item.userState as unknown as Record<string, unknown>).archivedAt;
    repaired++;
  }
  return repaired;
}

/**
 * Toggle bookmark status for a feed item
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleSaved(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.saved = !item.userState.saved;
    if (item.userState.saved) {
      item.userState.savedAt = Date.now();
      // Bookmarking wins -- clear any stale archive state so an item can
      // never be both saved and archived at the same time.
      item.userState.archived = false;
      delete (item.userState as unknown as Record<string, unknown>).archivedAt;
    } else {
      // Automerge forbids assigning `undefined` — use delete instead
      delete (item.userState as unknown as Record<string, unknown>).savedAt;
    }
  }
}

/**
 * Hide a feed item
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function hideItem(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.hidden = true;
  }
}

/**
 * Toggle liked status for a feed item.
 * Sets liked + likedAt on like, clears all three like fields on unlike.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleLiked(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (!item) return;
  const us = item.userState as unknown as Record<string, unknown>;
  if (item.userState.liked) {
    us.liked = false;
    delete us.likedAt;
    delete us.likedSyncedAt;
  } else {
    us.liked = true;
    us.likedAt = Date.now();
    delete us.likedSyncedAt;
  }
}

/**
 * Confirm that the like was successfully synced to the source platform.
 * Called by the outbox processor after a successful platform action.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param syncedAt - Timestamp when the sync completed (or -1 for permanent failure)
 */
export function confirmLikedSynced(
  doc: FreedDoc,
  globalId: string,
  syncedAt: number = Date.now(),
): void {
  const item = doc.feedItems[globalId];
  if (item) {
    (item.userState as unknown as Record<string, unknown>).likedSyncedAt = syncedAt;
  }
}

/**
 * Confirm that the seen-impression was successfully synced to the source platform.
 * Called by the outbox processor after a successful platform action.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param syncedAt - Timestamp when the sync completed (or -1 for permanent failure)
 */
export function confirmSeenSynced(
  doc: FreedDoc,
  globalId: string,
  syncedAt: number = Date.now(),
): void {
  const item = doc.feedItems[globalId];
  if (item) {
    (item.userState as unknown as Record<string, unknown>).seenSyncedAt = syncedAt;
  }
}

// =============================================================================
// RSS Feed Operations
// =============================================================================

/**
 * Add an RSS feed subscription
 *
 * Strips `undefined` values before writing — feed metadata derived from live
 * XML (imageUrl, siteUrl, etc.) is optional and may be undefined for feeds
 * that lack those elements.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param feed - The RSS feed to add
 */
export function addRssFeed(doc: FreedDoc, feed: RssFeed): void {
  doc.rssFeeds[feed.url] = stripUndefined(feed);
}

/**
 * Update an RSS feed
 *
 * Strips `undefined` values before writing for the same reasons as addRssFeed.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 * @param updates - Partial updates to apply
 */
export function updateRssFeed(
  doc: FreedDoc,
  url: string,
  updates: Partial<RssFeed>
): void {
  const existing = doc.rssFeeds[url];
  if (existing) {
    Object.assign(existing, stripUndefined(updates));
  }
}

/**
 * Remove an RSS feed subscription
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function removeRssFeed(
  doc: FreedDoc,
  url: string,
  includeItems: boolean = false,
): void {
  delete doc.rssFeeds[url];
  if (!includeItems) return;
  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (item.rssSource?.feedUrl === url) {
      delete doc.feedItems[id];
    }
  }
}

/**
 * Toggle feed enabled status
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function toggleFeedEnabled(doc: FreedDoc, url: string): void {
  const feed = doc.rssFeeds[url];
  if (feed) {
    feed.enabled = !feed.enabled;
  }
}

/**
 * Remove all RSS feed subscriptions in a single CRDT change.
 *
 * This propagates to all synced devices. When `includeItems` is true,
 * all feedItems are also deleted — equivalent to a full data wipe.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param includeItems - Whether to also delete all feed items
 */
export function removeAllFeeds(doc: FreedDoc, includeItems: boolean): void {
  for (const url of Object.keys(doc.rssFeeds)) {
    delete doc.rssFeeds[url];
  }
  if (includeItems) {
    for (const id of Object.keys(doc.feedItems)) {
      delete doc.feedItems[id];
    }
  }
}

// =============================================================================
// Person Operations
// =============================================================================

/**
 * Add a friend to the document
 *
 * Strips any `undefined` values before writing, matching the feed and RSS
 * helpers and avoiding Automerge errors on optional friend fields.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param friend - The friend to add
 */
export function addPerson(doc: FreedDoc, person: Person): void {
  ensureIdentityGraphRoots(doc);
  doc.persons[person.id] = normalizePerson(person);
}

/**
 * Update a friend's scalar and array fields.
 *
 * Uses field-by-field assignment rather than Object.assign to avoid replacing
 * Automerge Map/List proxies (sources, reachOutLog arrays) with plain objects.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 * @param updates - Partial updates to apply
 */
export function updatePerson(
  doc: FreedDoc,
  id: string,
  updates: Partial<Person>
): void {
  ensureIdentityGraphRoots(doc);
  const existing = doc.persons[id];
  if (!existing) return;

  // Replace reachOutLog array by splicing
  const { reachOutLog, ...scalars } = updates;
  const mutablePerson = existing as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(scalars)) {
    if (value === undefined) {
      delete mutablePerson[key];
      continue;
    }
    mutablePerson[key] = value;
  }

  if (reachOutLog !== undefined) {
    if (!existing.reachOutLog) {
      existing.reachOutLog = reachOutLog;
    } else {
      existing.reachOutLog.splice(
        0,
        existing.reachOutLog.length,
        ...reachOutLog
      );
    }
  }

  existing.updatedAt = Date.now();
}

/**
 * Remove a friend from the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 */
export function removePerson(doc: FreedDoc, id: string): void {
  ensureIdentityGraphRoots(doc);
  delete doc.persons[id];
  for (const [accountId, account] of Object.entries(doc.accounts)) {
    if (account.personId === id) {
      delete doc.accounts[accountId];
    }
  }
}

/**
 * Prepend a reach-out log entry for a friend, capped at 20 entries.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 * @param entry - The reach-out log entry
 */
export function logReachOut(
  doc: FreedDoc,
  id: string,
  entry: ReachOutLog
): void {
  ensureIdentityGraphRoots(doc);
  const person = doc.persons[id];
  if (!person) return;

  if (!person.reachOutLog) {
    person.reachOutLog = [entry];
  } else {
    person.reachOutLog.unshift(entry);
    // Keep the log bounded to 20 entries
    if (person.reachOutLog.length > 20) {
      person.reachOutLog.splice(20);
    }
  }

  person.updatedAt = Date.now();
}

// =============================================================================
// Account Operations
// =============================================================================

export function addAccount(doc: FreedDoc, account: Account): void {
  ensureIdentityGraphRoots(doc);
  doc.accounts[account.id] = stripUndefined(account);
}

export function addAccounts(doc: FreedDoc, accounts: Account[]): void {
  for (const account of accounts) {
    addAccount(doc, account);
  }
}

export function updateAccount(
  doc: FreedDoc,
  id: string,
  updates: Partial<Account>
): void {
  ensureIdentityGraphRoots(doc);
  const existing = doc.accounts[id];
  if (!existing) return;
  const mutableAccount = existing as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete mutableAccount[key];
      continue;
    }
    mutableAccount[key] = value;
  }
  existing.updatedAt = Date.now();
}

export function removeAccount(doc: FreedDoc, id: string): void {
  ensureIdentityGraphRoots(doc);
  delete doc.accounts[id];
}

/** @deprecated Use addPerson. */
export const addFriend = addPerson;

/** @deprecated Use updatePerson. */
export const updateFriend = updatePerson;

/** @deprecated Use removePerson. */
export const removeFriend = removePerson;

// =============================================================================
// Preferences Operations
// =============================================================================

/**
 * Deep-merge scalar values from `source` into the Automerge map `target`.
 *
 * Automerge forbids replacing an existing nested Map with a new object.
 * This helper recurses into nested objects and assigns only scalar leaf values,
 * which allows callers to pass spread objects that may contain Automerge
 * proxy references in their nested sub-objects.
 */
function deepMergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const dstVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof dstVal === "object" &&
      dstVal !== null
    ) {
      // Recurse into nested objects instead of replacing the Automerge Map
      deepMergeInto(
        dstVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      target[key] = srcVal;
    }
  }
}

/**
 * Update user preferences
 *
 * Uses deep merging to avoid replacing Automerge Map objects, which is
 * forbidden. Only scalar leaf values are assigned directly.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param updates - Partial preference updates
 */
export function updatePreferences(
  doc: FreedDoc,
  updates: Partial<UserPreferences>
): void {
  const fbCaptureUpdate = updates.fbCapture;
  if (fbCaptureUpdate) {
    applyFbCapturePreferenceUpdate(
      doc.preferences as UserPreferences,
      fbCaptureUpdate,
    );
    const { fbCapture: _fbCapture, ...remainingUpdates } = updates;
    updates = remainingUpdates;
  }

  deepMergeInto(
    doc.preferences as unknown as Record<string, unknown>,
    updates as unknown as Record<string, unknown>
  );
}

function replaceRecord<T>(
  target: Record<string, T>,
  source: Record<string, T>,
): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function applyFbCapturePreferenceUpdate(
  preferences: UserPreferences,
  updates: Partial<FacebookCapturePreferences>,
): void {
  if (!preferences.fbCapture) {
    preferences.fbCapture = {
      knownGroups: {},
      excludedGroupIds: {},
    };
  }

  if (updates.knownGroups) {
    replaceRecord(preferences.fbCapture.knownGroups, updates.knownGroups);
  }
  if (updates.excludedGroupIds) {
    replaceRecord(
      preferences.fbCapture.excludedGroupIds,
      updates.excludedGroupIds,
    );
  }
}

/**
 * Set author weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param authorId - The author's ID
 * @param weight - Weight value (0-100)
 */
export function setAuthorWeight(
  doc: FreedDoc,
  authorId: string,
  weight: number
): void {
  doc.preferences.weights.authors[authorId] = weight;
}

/**
 * Set topic weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param topic - The topic
 * @param weight - Weight value (0-100)
 */
export function setTopicWeight(
  doc: FreedDoc,
  topic: string,
  weight: number
): void {
  doc.preferences.weights.topics[topic] = weight;
}

/**
 * Set platform weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param platform - The platform
 * @param weight - Weight value (0-100)
 */
export function setPlatformWeight(
  doc: FreedDoc,
  platform: string,
  weight: number
): void {
  doc.preferences.weights.platforms[platform] = weight;
}

// =============================================================================
// Document Metadata Operations
// =============================================================================

/**
 * Update last sync timestamp
 *
 * @param doc - The Automerge document (mutable within A.change)
 */
export function updateLastSync(doc: FreedDoc): void {
  doc.meta.lastSync = Date.now();
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get all feed items sorted by published date (newest first)
 */
export function getFeedItemsSorted(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get feed items by platform
 */
export function getFeedItemsByPlatform(
  doc: FreedDoc,
  platform: string
): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.platform === platform && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get saved items
 */
export function getSavedItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.userState.saved && !item.userState.archived)
    .sort((a, b) => (b.userState.savedAt ?? 0) - (a.userState.savedAt ?? 0));
}

/**
 * Get archived items
 */
export function getArchivedItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.userState.archived)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get unread items
 */
export function getUnreadItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => !item.userState.readAt && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get enabled RSS feeds
 */
export function getEnabledFeeds(doc: FreedDoc): RssFeed[] {
  return Object.values(doc.rssFeeds).filter((feed) => feed.enabled);
}

/**
 * Check if a feed item exists
 */
export function hasFeedItem(doc: FreedDoc, globalId: string): boolean {
  return globalId in doc.feedItems;
}
