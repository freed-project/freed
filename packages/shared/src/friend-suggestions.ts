import type {
  Account,
  ContentSignal,
  FeedItem,
  FriendCandidateReason,
  FriendCandidateReasonCode,
  FriendCandidateSuggestion,
  FriendCandidateSuggestionKind,
  FriendSuggestionPreferences,
  IdentitySuggestion,
  Person,
} from "./types.js";
import { isValidDiscoveredSocialAccount } from "./social-account-validity.js";

export interface BuildFriendCandidateSuggestionsInput {
  persons: Person[] | Record<string, Person>;
  accounts: Record<string, Account>;
  feedItems: FeedItem[] | Record<string, FeedItem>;
  contactSuggestions?: IdentitySuggestion[];
  preferences?: FriendSuggestionPreferences | null;
  dismissedSuggestionIds?: readonly string[];
  now?: number;
  limit?: number;
}

/**
 * Compact activity evidence for one social account. The native Friends reader
 * produces this directly from SQLite so suggestion scoring does not need a
 * retained renderer copy of the Library corpus.
 */
export interface FriendCandidateActivityAggregate {
  itemCount: number;
  latestActivityAt: number;
  recentCount: number;
  sampleItemIds: string[];
  signalCounts: Partial<Record<ContentSignal, number>>;
}

export interface BuildFriendCandidateSuggestionsFromActivityInput {
  persons: Person[] | Record<string, Person>;
  accounts: Record<string, Account>;
  activityBySourceKey: Readonly<Record<string, FriendCandidateActivityAggregate>>;
  contactSuggestions?: IdentitySuggestion[];
  preferences?: FriendSuggestionPreferences | null;
  dismissedSuggestionIds?: readonly string[];
  limit?: number;
}

const MIN_VISIBLE_SCORE = 60;
const HIGH_CONFIDENCE_SCORE = 80;
const MAX_SAMPLE_ITEMS = 5;
const RECENT_WINDOW_MS = 45 * 24 * 60 * 60 * 1_000;
const SOCIAL_PROVIDERS = new Set(["x", "facebook", "instagram", "linkedin", "substack", "medium"]);
const RSS_PROVIDER = "rss";

const POSITIVE_SIGNAL_WEIGHTS: Partial<Record<ContentSignal, number>> = {
  life_update: 16,
  moment: 10,
  event: 12,
  place: 10,
  request: 12,
  recommendation: 6,
  discussion: 6,
  opportunity: 8,
};

const NEGATIVE_SIGNAL_WEIGHTS: Partial<Record<ContentSignal, number>> = {
  news: 16,
  promotion: 14,
  product_update: 12,
  deal: 12,
  transaction: 16,
};

const REASON_LABELS: Record<FriendCandidateReasonCode, string> = {
  personal_updates: "Personal updates",
  life_events: "Life events",
  direct_requests: "Direct asks",
  places_and_moments: "Places and moments",
  multi_channel_identity: "Multiple linked channels",
  recent_activity: "Recent activity",
  contact_overlap: "Contact overlap",
};

const ORGANIZATION_WORDS = [
  "agency",
  "company",
  "corp",
  "corporation",
  "daily",
  "deal",
  "deals",
  "foundation",
  "inc",
  "journal",
  "labs",
  "media",
  "network",
  "news",
  "official",
  "press",
  "product",
  "shop",
  "store",
  "studio",
  "team",
  "updates",
];

const UTF8_ENCODER = new TextEncoder();

export function compareUtf8Binary(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function friendCandidateActivitySourceKey(
  platform: string,
  authorId: string,
): string {
  return JSON.stringify([platform, authorId]);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toPersonList(persons: Person[] | Record<string, Person>): Person[] {
  return Array.isArray(persons) ? persons : Object.values(persons);
}

function toFeedItemList(feedItems: FeedItem[] | Record<string, FeedItem>): FeedItem[] {
  return Array.isArray(feedItems) ? feedItems : Object.values(feedItems);
}

function accountLabel(account: Account): string {
  return account.displayName?.trim() || account.handle?.trim() || account.externalId;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@_.|/\\()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasOrganizationName(value: string): boolean {
  const normalized = normalizeName(value);
  if (!normalized) return true;
  const words = normalized.split(" ");
  return words.some((word) => ORGANIZATION_WORDS.includes(word));
}

function humanNameConfidence(value: string): number {
  const normalized = normalizeName(value);
  if (!normalized || hasOrganizationName(normalized)) return 0;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length >= 2 && words.length <= 4 && words.every((word) => /^[a-z][a-z'-]{1,}$/.test(word))) {
    return 1;
  }
  if (words.length === 1 && /^[a-z][a-z'-]{2,}$/.test(words[0])) {
    return 0.45;
  }
  return 0.2;
}

function hashValue(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function countSignals(items: FeedItem[]): Partial<Record<ContentSignal, number>> {
  const counts: Partial<Record<ContentSignal, number>> = {};
  for (const item of items) {
    for (const signal of item.contentSignals?.tags ?? []) {
      counts[signal] = (counts[signal] ?? 0) + 1;
    }
  }
  return counts;
}

function activityFromItems(
  items: FeedItem[],
  now: number,
): FriendCandidateActivityAggregate {
  return {
    itemCount: items.length,
    latestActivityAt: Math.max(0, ...items.map((item) => item.publishedAt)),
    recentCount: items.filter(
      (item) => item.publishedAt <= now && now - item.publishedAt <= RECENT_WINDOW_MS,
    ).length,
    sampleItemIds: items.slice(0, MAX_SAMPLE_ITEMS).map((item) => item.globalId),
    signalCounts: countSignals(items),
  };
}

function combinedAccountActivity(
  accounts: readonly Account[],
  activityBySourceKey: Readonly<Record<string, FriendCandidateActivityAggregate>>,
): FriendCandidateActivityAggregate {
  const combined: FriendCandidateActivityAggregate = {
    itemCount: 0,
    latestActivityAt: 0,
    recentCount: 0,
    sampleItemIds: [],
    signalCounts: {},
  };
  for (const account of accounts) {
    const activity = activityBySourceKey[
      friendCandidateActivitySourceKey(account.provider, account.externalId)
    ];
    if (!activity) continue;
    combined.itemCount += activity.itemCount;
    combined.latestActivityAt = Math.max(
      combined.latestActivityAt,
      activity.latestActivityAt,
    );
    combined.recentCount += activity.recentCount;
    for (const itemId of activity.sampleItemIds) {
      if (combined.sampleItemIds.length >= MAX_SAMPLE_ITEMS) break;
      combined.sampleItemIds.push(itemId);
    }
    for (const [signal, count] of Object.entries(activity.signalCounts) as Array<
      [ContentSignal, number]
    >) {
      combined.signalCounts[signal] =
        (combined.signalCounts[signal] ?? 0) + count;
    }
  }
  return combined;
}

function signalCount(counts: Partial<Record<ContentSignal, number>>, signals: ContentSignal[]): number {
  return signals.reduce((total, signal) => total + (counts[signal] ?? 0), 0);
}

function addReason(
  reasons: FriendCandidateReason[],
  code: FriendCandidateReasonCode,
  score: number,
): void {
  if (score <= 0) return;
  reasons.push({
    code,
    label: REASON_LABELS[code],
    score: Math.round(score),
  });
}

function suggestionId(
  kind: FriendCandidateSuggestionKind,
  targetId: string,
  accountIds: string[],
  sampleItemIds: string[],
  signalCounts: Partial<Record<ContentSignal, number>>,
): string {
  const signalSeed = Object.entries(signalCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signal, count]) => `${signal}:${count}`)
    .join(",");
  const evidenceHash = hashValue([
    targetId,
    accountIds.slice().sort().join(","),
    sampleItemIds.slice().sort().join(","),
    signalSeed,
  ].join("|"));
  return `friend-suggestion:${kind}:${targetId}:${evidenceHash}`;
}

function buildItemIndex(feedItems: FeedItem[]): Map<string, FeedItem[]> {
  const byAccountKey = new Map<string, FeedItem[]>();
  for (const item of feedItems) {
    const key = friendCandidateActivitySourceKey(item.platform, item.author.id);
    const existing = byAccountKey.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byAccountKey.set(key, [item]);
    }
  }
  for (const items of byAccountKey.values()) {
    items.sort(
      (left, right) =>
        right.publishedAt - left.publishedAt ||
        compareUtf8Binary(left.globalId, right.globalId),
    );
  }
  return byAccountKey;
}

function scoreCandidate({
  kind,
  targetId,
  displayName,
  accountIds,
  accounts,
  activity,
  contactOverlap,
}: {
  kind: FriendCandidateSuggestionKind;
  targetId: string;
  displayName: string;
  accountIds: string[];
  accounts: Account[];
  activity: FriendCandidateActivityAggregate;
  contactOverlap: boolean;
}): FriendCandidateSuggestion | null {
  if (accountIds.length === 0) return null;

  const signalCounts = activity.signalCounts;
  const reasons: FriendCandidateReason[] = [];
  const lastActivityAt = Math.max(
    activity.latestActivityAt,
    ...accounts.map((account) => account.lastSeenAt),
  );
  const humanConfidence = humanNameConfidence(displayName);
  const rssOnly = accounts.length > 0 && accounts.every((account) => account.provider === RSS_PROVIDER);
  const organizationLike = hasOrganizationName(displayName);

  let score = 0;

  const personalCount = signalCount(signalCounts, ["life_update", "moment"]);
  if (personalCount > 0) {
    const reasonScore = Math.min(36, personalCount * 13);
    score += reasonScore;
    addReason(reasons, "personal_updates", reasonScore);
  }

  const lifeEventCount = signalCount(signalCounts, ["event", "opportunity"]);
  if (lifeEventCount > 0) {
    const reasonScore = Math.min(24, lifeEventCount * 12);
    score += reasonScore;
    addReason(reasons, "life_events", reasonScore);
  }

  const directRequestCount = signalCount(signalCounts, ["request", "recommendation", "discussion"]);
  if (directRequestCount > 0) {
    const reasonScore = Math.min(22, directRequestCount * 9);
    score += reasonScore;
    addReason(reasons, "direct_requests", reasonScore);
  }

  const placeMomentCount = signalCount(signalCounts, ["place", "moment"]);
  if (placeMomentCount > 0) {
    const reasonScore = Math.min(22, placeMomentCount * 8);
    score += reasonScore;
    addReason(reasons, "places_and_moments", reasonScore);
  }

  if (accountIds.length > 1) {
    score += 18;
    addReason(reasons, "multi_channel_identity", 18);
  }

  if (activity.recentCount > 0 || activity.itemCount >= 3) {
    const reasonScore = Math.min(
      18,
      (activity.recentCount > 0 ? 10 : 0) +
        Math.min(8, Math.floor(activity.itemCount / 2) * 4),
    );
    score += reasonScore;
    addReason(reasons, "recent_activity", reasonScore);
  }

  if (contactOverlap) {
    score += 14;
    addReason(reasons, "contact_overlap", 14);
  }

  for (const [signal, weight] of Object.entries(POSITIVE_SIGNAL_WEIGHTS) as Array<[ContentSignal, number]>) {
    if (!["life_update", "moment", "event", "place", "request", "recommendation", "discussion", "opportunity"].includes(signal)) {
      score += (signalCounts[signal] ?? 0) * weight;
    }
  }

  for (const [signal, weight] of Object.entries(NEGATIVE_SIGNAL_WEIGHTS) as Array<[ContentSignal, number]>) {
    score -= (signalCounts[signal] ?? 0) * weight;
  }

  score += Math.round(humanConfidence * 10);

  if (kind === "unlinked_account" && humanConfidence < 0.45) {
    score -= 26;
  }
  if (organizationLike) {
    score -= 34;
  }
  if (rssOnly) {
    score -= 40;
  }

  const finalScore = clampScore(score);
  if (finalScore < MIN_VISIBLE_SCORE || reasons.length === 0) return null;

  const sampleItemIds = activity.sampleItemIds.slice(0, MAX_SAMPLE_ITEMS);
  return {
    id: suggestionId(kind, targetId, accountIds, sampleItemIds, signalCounts),
    kind,
    personId: kind === "connection_person" ? targetId : undefined,
    accountIds,
    displayName,
    score: finalScore,
    confidence: finalScore >= HIGH_CONFIDENCE_SCORE ? "high" : "medium",
    reasons: reasons.sort((left, right) => right.score - left.score || left.code.localeCompare(right.code)).slice(0, 4),
    signalCounts,
    lastActivityAt: lastActivityAt > 0 ? lastActivityAt : undefined,
    sampleItemIds,
  };
}

interface BuildFriendCandidateSuggestionsCoreInput {
  persons: Person[] | Record<string, Person>;
  accounts: Record<string, Account>;
  contactSuggestions: IdentitySuggestion[];
  preferences: FriendSuggestionPreferences | null;
  dismissedSuggestionIds: readonly string[];
  limit: number;
  activityForAccounts: (
    candidateAccounts: readonly Account[],
  ) => FriendCandidateActivityAggregate;
}

function buildFriendCandidateSuggestionsCore({
  persons,
  accounts,
  contactSuggestions,
  preferences,
  dismissedSuggestionIds,
  limit,
  activityForAccounts,
}: BuildFriendCandidateSuggestionsCoreInput): FriendCandidateSuggestion[] {
  const personList = toPersonList(persons);
  const dismissed = new Set([
    ...(preferences?.dismissedSuggestionIds ?? []),
    ...dismissedSuggestionIds,
  ]);
  const contactPersonIds = new Set<string>();
  const contactAccountIds = new Set<string>();

  for (const suggestion of contactSuggestions) {
    if (suggestion.personId) contactPersonIds.add(suggestion.personId);
    for (const accountId of suggestion.accountIds) contactAccountIds.add(accountId);
  }

  const socialAccounts = Object.values(accounts).filter((account) =>
    account.kind === "social" && isValidDiscoveredSocialAccount(account)
  );
  const accountsByPerson = new Map<string, Account[]>();
  for (const account of socialAccounts) {
    if (!account.personId) continue;
    const current = accountsByPerson.get(account.personId);
    if (current) {
      current.push(account);
    } else {
      accountsByPerson.set(account.personId, [account]);
    }
  }

  const candidates: FriendCandidateSuggestion[] = [];

  for (const person of personList) {
    if (person.relationshipStatus !== "connection") continue;
    const personAccounts = (accountsByPerson.get(person.id) ?? []).filter((account) => SOCIAL_PROVIDERS.has(account.provider));
    if (personAccounts.length === 0) continue;
    const suggestion = scoreCandidate({
      kind: "connection_person",
      targetId: person.id,
      displayName: person.name,
      accountIds: personAccounts.map((account) => account.id),
      accounts: personAccounts,
      activity: activityForAccounts(personAccounts),
      contactOverlap: contactPersonIds.has(person.id) || personAccounts.some((account) => contactAccountIds.has(account.id)),
    });
    if (suggestion && !dismissed.has(suggestion.id)) {
      candidates.push(suggestion);
    }
  }

  for (const account of socialAccounts) {
    if (account.personId || !SOCIAL_PROVIDERS.has(account.provider)) continue;
    const displayName = accountLabel(account);
    const suggestion = scoreCandidate({
      kind: "unlinked_account",
      targetId: account.id,
      displayName,
      accountIds: [account.id],
      accounts: [account],
      activity: activityForAccounts([account]),
      contactOverlap: contactAccountIds.has(account.id),
    });
    if (suggestion && !dismissed.has(suggestion.id)) {
      candidates.push(suggestion);
    }
  }

  return candidates
    .sort((left, right) =>
      right.score - left.score ||
      (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0) ||
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

export function buildFriendCandidateSuggestions({
  persons,
  accounts,
  feedItems,
  contactSuggestions = [],
  preferences = null,
  dismissedSuggestionIds = [],
  now = Date.now(),
  limit = 12,
}: BuildFriendCandidateSuggestionsInput): FriendCandidateSuggestion[] {
  const itemIndex = buildItemIndex(toFeedItemList(feedItems));
  return buildFriendCandidateSuggestionsCore({
    persons,
    accounts,
    contactSuggestions,
    preferences,
    dismissedSuggestionIds,
    limit,
    activityForAccounts: (candidateAccounts) => {
      const candidateItems = candidateAccounts.flatMap(
        (account) =>
          itemIndex.get(
            friendCandidateActivitySourceKey(
              account.provider,
              account.externalId,
            ),
          ) ?? [],
      );
      return activityFromItems(candidateItems, now);
    },
  });
}

/** Score the existing Friends suggestions from compact row-store evidence. */
export function buildFriendCandidateSuggestionsFromActivity({
  persons,
  accounts,
  activityBySourceKey,
  contactSuggestions = [],
  preferences = null,
  dismissedSuggestionIds = [],
  limit = 12,
}: BuildFriendCandidateSuggestionsFromActivityInput): FriendCandidateSuggestion[] {
  return buildFriendCandidateSuggestionsCore({
    persons,
    accounts,
    contactSuggestions,
    preferences,
    dismissedSuggestionIds,
    limit,
    activityForAccounts: (candidateAccounts) =>
      combinedAccountActivity(candidateAccounts, activityBySourceKey),
  });
}
