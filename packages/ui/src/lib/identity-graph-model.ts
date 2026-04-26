import type { Account, FeedItem, Person, RssFeed } from "@freed/shared";

export type IdentityGraphMode = "friends" | "all_content";

export type IdentityGraphNodeKind =
  | "friend_person"
  | "connection_person"
  | "account"
  | "feed";

export interface IdentityGraphNode {
  id: string;
  kind: IdentityGraphNodeKind;
  label: string;
  radius: number;
  labelPriority: number;
  personId?: string;
  accountId?: string;
  feedUrl?: string;
  linkedPersonId?: string | null;
  provider?: string;
  ring: 0 | 1 | 2 | 3;
  weight: number;
  initials?: string;
  interactive: boolean;
  graphX?: number;
  graphY?: number;
  graphPinned?: boolean;
  activityCount?: number;
  lastActivityAt?: number;
}

export interface IdentityGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface IdentityGraphModel {
  nodes: IdentityGraphNode[];
  edges: IdentityGraphEdge[];
  signature: string;
  buildMs: number;
}

export interface IdentityGraphActivityIndex {
  socialCounts: Map<string, number>;
  socialLastActivity: Map<string, number>;
  rssCounts: Map<string, number>;
  rssLastActivity: Map<string, number>;
  linkedAccountCounts: Map<string, number>;
  personActivityCounts: Map<string, number>;
  personLastActivity: Map<string, number>;
}

interface BuildIdentityGraphModelArgs {
  persons: Person[];
  accounts: Record<string, Account>;
  feeds: Record<string, RssFeed>;
  feedItems: Record<string, FeedItem>;
  mode: IdentityGraphMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return hash | 0;
}

function mixHash(current: number, value: string | number): number {
  const nextValue = typeof value === "number" ? value | 0 : hashValue(value);
  return Math.imul(current ^ nextValue, 16777619) | 0;
}

function socialActivityKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

function initialsForLabel(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function buildIdentityGraphActivityIndex(
  accounts: Record<string, Account>,
  feedItems: Record<string, FeedItem>,
): IdentityGraphActivityIndex {
  const socialCounts = new Map<string, number>();
  const socialLastActivity = new Map<string, number>();
  const rssCounts = new Map<string, number>();
  const rssLastActivity = new Map<string, number>();
  const linkedAccountCounts = new Map<string, number>();
  const personBySocialKey = new Map<string, string>();
  const personActivityCounts = new Map<string, number>();
  const personLastActivity = new Map<string, number>();

  for (const account of Object.values(accounts)) {
    if (account.kind === "social" && account.personId) {
      linkedAccountCounts.set(
        account.personId,
        (linkedAccountCounts.get(account.personId) ?? 0) + 1,
      );
      personBySocialKey.set(
        socialActivityKey(account.provider, account.externalId),
        account.personId,
      );
    }
  }

  for (const item of Object.values(feedItems)) {
    const authorId = item.author?.id;
    if (authorId) {
      const socialKey = socialActivityKey(item.platform, authorId);
      const personId = personBySocialKey.get(socialKey);
      if (personId) {
        socialCounts.set(socialKey, (socialCounts.get(socialKey) ?? 0) + 1);
        socialLastActivity.set(
          socialKey,
          Math.max(socialLastActivity.get(socialKey) ?? 0, item.publishedAt),
        );
        personActivityCounts.set(personId, (personActivityCounts.get(personId) ?? 0) + 1);
        personLastActivity.set(
          personId,
          Math.max(personLastActivity.get(personId) ?? 0, item.publishedAt),
        );
      }
    }

    if (item.platform === "rss") {
      const feedUrl = item.rssSource?.feedUrl;
      if (feedUrl) {
        rssCounts.set(feedUrl, (rssCounts.get(feedUrl) ?? 0) + 1);
        rssLastActivity.set(
          feedUrl,
          Math.max(rssLastActivity.get(feedUrl) ?? 0, item.publishedAt),
        );
      }
      continue;
    }

    if (!authorId) continue;
    const key = socialActivityKey(item.platform, authorId);
    if (personBySocialKey.has(key)) continue;
    socialCounts.set(key, (socialCounts.get(key) ?? 0) + 1);
    socialLastActivity.set(
      key,
      Math.max(socialLastActivity.get(key) ?? 0, item.publishedAt),
    );
    const personId = personBySocialKey.get(key);
    if (personId) {
      personActivityCounts.set(personId, (personActivityCounts.get(personId) ?? 0) + 1);
      personLastActivity.set(
        personId,
        Math.max(personLastActivity.get(personId) ?? 0, item.publishedAt),
      );
    }
  }

  return {
    socialCounts,
    socialLastActivity,
    rssCounts,
    rssLastActivity,
    linkedAccountCounts,
    personActivityCounts,
    personLastActivity,
  };
}

function accountLabel(account: Account): string {
  return account.displayName?.trim() || account.handle?.trim() || account.externalId;
}

function personRadius(person: Person, linkedAccountCount: number): number {
  if (person.relationshipStatus === "friend") {
    return clamp(36 + person.careLevel * 3 + linkedAccountCount * 1.25, 38, 58);
  }
  return clamp(24 + linkedAccountCount * 1.5, 24, 36);
}

function accountRadius(activityCount: number, linkedPersonId?: string): number {
  const base = linkedPersonId ? 10 : 9;
  return clamp(base + Math.log2(activityCount + 1.5) * 1.8, 8, linkedPersonId ? 16 : 13);
}

function feedRadius(itemCount: number): number {
  return clamp(7 + Math.log2(itemCount + 1.5) * 1.35, 6, 12);
}

export function buildIdentityGraphModel({
  persons,
  accounts,
  feeds,
  feedItems,
  mode,
}: BuildIdentityGraphModelArgs): IdentityGraphModel {
  const buildStart = nowMs();
  const nodes: IdentityGraphNode[] = [];
  const edges: IdentityGraphEdge[] = [];
  const activityIndex = buildIdentityGraphActivityIndex(accounts, feedItems);
  let signatureHash = mixHash(2166136261, mode);

  const visiblePersons = persons
    .filter((person) => mode === "all_content" || person.relationshipStatus === "friend")
    .sort((left, right) =>
      right.careLevel - left.careLevel ||
      left.relationshipStatus.localeCompare(right.relationshipStatus) ||
      left.name.localeCompare(right.name),
    );
  const visiblePersonIds = new Set(visiblePersons.map((person) => person.id));

  for (const person of visiblePersons) {
    const linkedCount = activityIndex.linkedAccountCounts.get(person.id) ?? 0;
    const activityCount = activityIndex.personActivityCounts.get(person.id) ?? 0;
    const lastActivityAt = activityIndex.personLastActivity.get(person.id) ?? 0;
    const isFriend = person.relationshipStatus === "friend";
    const node: IdentityGraphNode = {
      id: `person:${person.id}`,
      kind: isFriend ? "friend_person" : "connection_person",
      label: person.name,
      radius: personRadius(person, linkedCount),
      labelPriority: isFriend ? 100 : 82,
      personId: person.id,
      ring: isFriend ? 0 : 1,
      weight: isFriend ? 100 + person.careLevel * 10 + linkedCount * 2 : 60 + linkedCount * 3,
      initials: initialsForLabel(person.name),
      interactive: true,
      graphX: person.graphX,
      graphY: person.graphY,
      graphPinned: person.graphPinned,
      activityCount,
      lastActivityAt: lastActivityAt > 0 ? lastActivityAt : undefined,
    };
    nodes.push(node);
    signatureHash = mixHash(signatureHash, node.id);
    signatureHash = mixHash(signatureHash, node.kind);
    signatureHash = mixHash(signatureHash, node.ring);
    signatureHash = mixHash(signatureHash, Math.round(node.radius * 10));
    signatureHash = mixHash(signatureHash, node.weight);
    signatureHash = mixHash(signatureHash, person.graphPinned ? 1 : 0);
    if (person.graphPinned && typeof person.graphX === "number" && typeof person.graphY === "number") {
      signatureHash = mixHash(signatureHash, Math.round(person.graphX));
      signatureHash = mixHash(signatureHash, Math.round(person.graphY));
    }
  }

  const visibleAccounts = Object.values(accounts)
    .filter((account) => account.kind === "social")
    .filter((account) => {
      if (mode === "all_content") return true;
      return !!account.personId && visiblePersonIds.has(account.personId);
    })
    .sort((left, right) =>
      (left.personId ? 0 : 1) - (right.personId ? 0 : 1) ||
      (left.personId ?? "").localeCompare(right.personId ?? "") ||
      left.provider.localeCompare(right.provider) ||
      accountLabel(left).localeCompare(accountLabel(right)),
    );

  for (const account of visibleAccounts) {
    const linkedPersonId = account.personId && visiblePersonIds.has(account.personId) ? account.personId : null;
    const itemCount =
      activityIndex.socialCounts.get(
        socialActivityKey(account.provider, account.externalId),
      ) ?? 0;
    const lastActivityAt =
      activityIndex.socialLastActivity.get(
        socialActivityKey(account.provider, account.externalId),
      ) ?? 0;
    const nodeId = `account:${account.id}`;
    const node: IdentityGraphNode = {
      id: nodeId,
      kind: "account",
      label: accountLabel(account),
      radius: accountRadius(itemCount, linkedPersonId ?? undefined),
      labelPriority: linkedPersonId ? 58 : 44,
      accountId: account.id,
      linkedPersonId,
      provider: account.provider,
      ring: linkedPersonId ? 2 : 3,
      weight: (linkedPersonId ? 46 : 28) + itemCount,
      interactive: true,
      graphX: account.graphX,
      graphY: account.graphY,
      graphPinned: account.graphPinned,
      activityCount: itemCount,
      lastActivityAt: lastActivityAt > 0 ? lastActivityAt : undefined,
    };
    nodes.push(node);
    signatureHash = mixHash(signatureHash, node.id);
    signatureHash = mixHash(signatureHash, linkedPersonId ?? "");
    signatureHash = mixHash(signatureHash, node.provider ?? "");
    signatureHash = mixHash(signatureHash, Math.round(node.radius * 10));
    signatureHash = mixHash(signatureHash, node.weight);
    signatureHash = mixHash(signatureHash, account.graphPinned ? 1 : 0);
    if (account.graphPinned && typeof account.graphX === "number" && typeof account.graphY === "number") {
      signatureHash = mixHash(signatureHash, Math.round(account.graphX));
      signatureHash = mixHash(signatureHash, Math.round(account.graphY));
    }

    if (linkedPersonId) {
      const edge: IdentityGraphEdge = {
        id: `edge:person:${linkedPersonId}:${nodeId}`,
        sourceId: `person:${linkedPersonId}`,
        targetId: nodeId,
      };
      edges.push(edge);
      signatureHash = mixHash(signatureHash, edge.sourceId);
      signatureHash = mixHash(signatureHash, edge.targetId);
    }
  }

  if (mode === "all_content") {
    for (const feed of Object.values(feeds).filter((entry) => entry.enabled !== false)) {
      const itemCount = activityIndex.rssCounts.get(feed.url) ?? 0;
      const lastActivityAt = activityIndex.rssLastActivity.get(feed.url) ?? 0;
      const node: IdentityGraphNode = {
        id: `feed:${feed.url}`,
        kind: "feed",
        label: feed.title || feed.url,
        radius: feedRadius(itemCount),
        labelPriority: 24,
        feedUrl: feed.url,
        provider: "rss",
        ring: 3,
        weight: 16 + itemCount,
        interactive: false,
        activityCount: itemCount,
        lastActivityAt: lastActivityAt > 0 ? lastActivityAt : undefined,
      };
      nodes.push(node);
      signatureHash = mixHash(signatureHash, node.id);
      signatureHash = mixHash(signatureHash, Math.round(node.radius * 10));
      signatureHash = mixHash(signatureHash, node.weight);
    }
  }

  const buildMs = nowMs() - buildStart;
  return {
    nodes,
    edges,
    signature: `${nodes.length.toString(36)}:${edges.length.toString(36)}:${(signatureHash >>> 0).toString(36)}`,
    buildMs,
  };
}

export function createIdentityGraphModelSignature(model: IdentityGraphModel): string {
  return model.signature;
}
