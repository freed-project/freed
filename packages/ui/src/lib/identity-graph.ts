import {
  isInReconnectZone,
  nodeOpacity,
  nodeRadius,
  recentPostCount,
  socialAccountsForPerson,
  type Account,
  type FeedItem,
  type MapMode,
  type Person,
} from "@freed/shared";
import { resolveFriendAvatarUrl } from "./friend-avatar.js";

export type IdentityGraphNodeKind = "person" | "linked_account" | "unlinked_account";

export interface IdentityGraphNode {
  id: string;
  kind: IdentityGraphNodeKind;
  label: string;
  radius: number;
  x: number;
  y: number;
  avatarUrl: string | null;
  provider?: Account["provider"];
  opacity: number;
  personId?: string;
  accountId?: string;
  inReconnectZone?: boolean;
  suggestionConfidence?: "high" | "medium";
}

export interface IdentityGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface IdentityGraphRegion {
  provider: Account["provider"];
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  nodeIds: string[];
}

export interface IdentityGraphLayout {
  nodes: IdentityGraphNode[];
  edges: IdentityGraphEdge[];
  regions: IdentityGraphRegion[];
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export const FRIEND_GRAPH_DEFAULT_TRANSFORM: ViewTransform = {
  x: 0,
  y: 0,
  scale: 1,
};

const SOCIAL_GRAPH_PROVIDERS: Array<Account["provider"]> = [
  "instagram",
  "facebook",
  "x",
  "linkedin",
];

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function truncateLabel(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function accountDisplayLabel(account: Account): string {
  if (account.displayName?.trim()) return truncateLabel(account.displayName.trim(), 16);
  if (account.handle?.trim()) return truncateLabel(account.handle.trim(), 16);
  return truncateLabel(account.externalId, 16);
}

function accountAvatarUrl(account: Account): string | null {
  return resolveFriendAvatarUrl({ avatarUrl: account.avatarUrl }, null);
}

function socialFeedItemsForAccount(
  feedItems: Record<string, FeedItem>,
  account: Account
): FeedItem[] {
  return Object.values(feedItems).filter(
    (item) =>
      item.platform === account.provider &&
      item.author.id === account.externalId
  );
}

function accountActivityCount(
  feedItems: Record<string, FeedItem>,
  account: Account
): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return socialFeedItemsForAccount(feedItems, account).filter((item) => item.publishedAt >= cutoff).length;
}

function accountOpacity(
  feedItems: Record<string, FeedItem>,
  account: Account
): number {
  const items = socialFeedItemsForAccount(feedItems, account);
  if (items.length === 0) return 0.56;
  const last = Math.max(...items.map((item) => item.publishedAt));
  const hours = (Date.now() - last) / (1000 * 60 * 60);
  if (hours < 24) return 0.94;
  if (hours < 24 * 7) return 0.82;
  if (hours < 24 * 30) return 0.72;
  return 0.58;
}

function accountRadius(
  feedItems: Record<string, FeedItem>,
  account: Account,
  linked: boolean
): number {
  const activity = accountActivityCount(feedItems, account);
  const base = linked ? 13 : 15;
  return Math.min(base + Math.log2(activity + 2) * 3.2, linked ? 20 : 22);
}

function comparePersons(
  feedItems: Record<string, FeedItem>,
  accounts: Record<string, Account>
) {
  return (left: Person, right: Person) =>
    right.careLevel - left.careLevel ||
    recentPostCount(feedItems, accounts, right) - recentPostCount(feedItems, accounts, left) ||
    left.name.localeCompare(right.name);
}

function providerLabelOrder(provider: Account["provider"]): number {
  const index = SOCIAL_GRAPH_PROVIDERS.indexOf(provider);
  return index === -1 ? SOCIAL_GRAPH_PROVIDERS.length : index;
}

function providerRegionCenters(width: number, height: number, providers: Account["provider"][]) {
  const centerX = width / 2;
  const centerY = height / 2;
  const orbitX = Math.max(180, width * 0.36);
  const orbitY = Math.max(140, height * 0.3);

  return providers.map((provider, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(1, providers.length);
    return {
      provider,
      x: centerX + Math.cos(angle) * orbitX,
      y: centerY + Math.sin(angle) * orbitY,
    };
  });
}

function layoutPersonHubs(
  persons: Person[],
  accounts: Record<string, Account>,
  feedItems: Record<string, FeedItem>,
  width: number,
  height: number
): IdentityGraphNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const major = Math.max(110, width * 0.16);
  const minor = Math.max(80, height * 0.12);

  return persons.map((person, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, persons.length);
    const reconnectLift = isInReconnectZone(person) ? -height * 0.14 : 0;
    const x = centerX + Math.cos(angle) * (major + (index % 3) * 24);
    const y = centerY + reconnectLift + Math.sin(angle) * (minor + (index % 2) * 18);
    return {
      id: `person:${person.id}`,
      kind: "person" as const,
      label: truncateLabel(person.name, 18),
      radius: nodeRadius(person, feedItems, accounts) + 4,
      x,
      y,
      avatarUrl: resolveFriendAvatarUrl(person, null),
      opacity: nodeOpacity(person, feedItems, accounts),
      personId: person.id,
      inReconnectZone: isInReconnectZone(person),
    };
  });
}

function layoutLinkedAccounts(
  personNodes: IdentityGraphNode[],
  accounts: Record<string, Account>,
  feedItems: Record<string, FeedItem>
) {
  const nodes: IdentityGraphNode[] = [];
  const edges: IdentityGraphEdge[] = [];

  for (const personNode of personNodes) {
    if (!personNode.personId) continue;
    const linkedAccounts = socialAccountsForPerson(accounts, personNode.personId)
      .sort((left, right) =>
        providerLabelOrder(left.provider) - providerLabelOrder(right.provider) ||
        accountDisplayLabel(left).localeCompare(accountDisplayLabel(right))
      );

    linkedAccounts.forEach((account, index) => {
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(1, linkedAccounts.length);
      const orbit = personNode.radius + 34 + ((index % 2) * 8);
      const nodeId = `account:${account.id}`;
      nodes.push({
        id: nodeId,
        kind: "linked_account",
        label: accountDisplayLabel(account),
        radius: accountRadius(feedItems, account, true),
        x: personNode.x + Math.cos(angle) * orbit,
        y: personNode.y + Math.sin(angle) * orbit,
        avatarUrl: accountAvatarUrl(account),
        opacity: accountOpacity(feedItems, account),
        provider: account.provider,
        personId: personNode.personId,
        accountId: account.id,
      });
      edges.push({
        id: `edge:${personNode.id}:${nodeId}`,
        sourceId: personNode.id,
        targetId: nodeId,
      });
    });
  }

  return { nodes, edges };
}

function layoutUnlinkedAccounts(
  accounts: Account[],
  feedItems: Record<string, FeedItem>,
  width: number,
  height: number,
  suggestions: Map<string, "high" | "medium">
) {
  const grouped = new Map<Account["provider"], Account[]>();

  for (const account of accounts) {
    if (!grouped.has(account.provider)) {
      grouped.set(account.provider, []);
    }
    grouped.get(account.provider)?.push(account);
  }

  const providers = Array.from(grouped.keys()).sort((left, right) =>
    providerLabelOrder(left) - providerLabelOrder(right) || left.localeCompare(right)
  );
  const centers = providerRegionCenters(width, height, providers);
  const nodes: IdentityGraphNode[] = [];
  const regions: IdentityGraphRegion[] = [];

  for (const center of centers) {
    const providerAccounts = (grouped.get(center.provider) ?? []).sort((left, right) =>
      accountDisplayLabel(left).localeCompare(accountDisplayLabel(right))
    );
    const regionNodeIds: string[] = [];

    providerAccounts.forEach((account, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, providerAccounts.length);
      const ring = Math.floor(index / 8);
      const orbit = 24 + ring * 34 + (index % 8) * 1.5;
      const jitter = hashValue(account.id) % 13;
      const x = center.x + Math.cos(angle) * (orbit + jitter);
      const y = center.y + Math.sin(angle) * (orbit * 0.74 + jitter);
      const nodeId = `account:${account.id}`;
      regionNodeIds.push(nodeId);
      nodes.push({
        id: nodeId,
        kind: "unlinked_account",
        label: accountDisplayLabel(account),
        radius: accountRadius(feedItems, account, false),
        x,
        y,
        avatarUrl: accountAvatarUrl(account),
        opacity: accountOpacity(feedItems, account),
        provider: account.provider,
        accountId: account.id,
        suggestionConfidence: suggestions.get(account.id),
      });
    });

    regions.push({
      provider: center.provider,
      x: center.x,
      y: center.y,
      radiusX: Math.max(110, 90 + providerAccounts.length * 14),
      radiusY: Math.max(82, 72 + providerAccounts.length * 11),
      nodeIds: regionNodeIds,
    });
  }

  return { nodes, regions };
}

export function createIdentityGraphLayoutSignature(
  persons: Person[],
  accounts: Account[],
  feedItems: Record<string, FeedItem>,
  mode: MapMode,
): string {
  const accountsById = Object.fromEntries(accounts.map((account) => [account.id, account]));
  return [
    mode,
    ...persons
      .map((person) => {
        const reconnect = isInReconnectZone(person) ? "1" : "0";
        const radius = Math.round(nodeRadius(person, feedItems, accountsById));
        return `p:${person.id}:${person.careLevel}:${reconnect}:${radius}`;
      })
      .sort(),
    ...accounts
      .map((account) => {
        const linked = account.personId ? "1" : "0";
        const activity = accountActivityCount(feedItems, account);
        return `a:${account.id}:${linked}:${activity}`;
      })
      .sort(),
  ].join("|");
}

export function buildIdentityGraphLayout(args: {
  persons: Person[];
  accounts: Record<string, Account>;
  feedItems: Record<string, FeedItem>;
  width: number;
  height: number;
  mode: MapMode;
  suggestionsByAccount?: Map<string, "high" | "medium">;
}): IdentityGraphLayout {
  const friendPersons = [...args.persons].sort(comparePersons(args.feedItems, args.accounts));
  const personNodes = layoutPersonHubs(friendPersons, args.accounts, args.feedItems, args.width, args.height);
  const linked = layoutLinkedAccounts(personNodes, args.accounts, args.feedItems);

  if (args.mode === "friends") {
    return {
      nodes: [...personNodes, ...linked.nodes],
      edges: linked.edges,
      regions: [],
    };
  }

  const unlinkedAccounts = Object.values(args.accounts).filter(
    (account) => account.kind === "social" && !account.personId
  );
  const unlinked = layoutUnlinkedAccounts(
    unlinkedAccounts,
    args.feedItems,
    args.width,
    args.height,
    args.suggestionsByAccount ?? new Map(),
  );

  return {
    nodes: [...personNodes, ...linked.nodes, ...unlinked.nodes],
    edges: linked.edges,
    regions: unlinked.regions,
  };
}

export function fitTransformToNodes(
  nodes: Array<{ x: number; y: number; radius: number }>,
  width: number,
  height: number,
  padding: number = 72
): ViewTransform {
  if (nodes.length === 0) return { ...FRIEND_GRAPH_DEFAULT_TRANSFORM };

  const left = Math.min(...nodes.map((node) => node.x - node.radius));
  const right = Math.max(...nodes.map((node) => node.x + node.radius));
  const top = Math.min(...nodes.map((node) => node.y - node.radius));
  const bottom = Math.max(...nodes.map((node) => node.y + node.radius));
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const scale = Math.max(
    0.4,
    Math.min(
      1.35,
      Math.min(
        (width - padding * 2) / contentWidth,
        (height - padding * 2) / contentHeight,
      ),
    ),
  );

  return {
    x: width / 2 - ((left + right) / 2) * scale,
    y: height / 2 - ((top + bottom) / 2) * scale,
    scale,
  };
}
