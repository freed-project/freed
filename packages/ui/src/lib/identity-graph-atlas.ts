import type {
  Account,
  FriendCandidateConfidence,
  MapMode,
  Person,
  RssFeed,
} from "@freed/shared";
import type {
  IdentityGraphActivitySummaries,
  IdentityGraphActivitySummary,
} from "./identity-graph-activity-summary.js";
import { socialActivitySummaryKey } from "./identity-graph-activity-summary.js";
import { providerGalaxyNodePoint } from "./identity-galaxy-provider-field.js";
import type { ViewTransform } from "./identity-graph-layout.js";

export type IdentityGraphAtlasNodeKind =
  | "friend_person"
  | "connection_person"
  | "account"
  | "feed"
  | "provider_cluster";

export type IdentityGraphAtlasQuality = "interactive" | "settled";

export interface IdentityGraphAtlasNode {
  id: string;
  kind: IdentityGraphAtlasNodeKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  priority: number;
  personId?: string;
  accountId?: string;
  feedUrl?: string;
  provider?: string;
  linkedPersonId?: string | null;
  initials?: string;
  avatarUrl?: string | null;
  activityCount: number;
  latestActivityAt?: number;
  aggregateCount?: number;
  graphPinned?: boolean;
  careLevel?: Person["careLevel"];
  friendSuggestionConfidence?: FriendCandidateConfidence;
}

export interface IdentityGraphAtlasEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface IdentityGraphAtlasRegion {
  id: string;
  provider: string;
  label: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  count: number;
  linkedCount: number;
  unlinkedCount: number;
}

export interface IdentityGraphAtlasLabel {
  id: string;
  nodeId: string;
  text: string;
  x: number;
  y: number;
  priority: number;
  kind: IdentityGraphAtlasNodeKind;
}

export interface IdentityGraphAtlasHitBucket {
  key: string;
  nodeIds: string[];
}

export interface IdentityGraphAtlasBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface IdentityGraphAtlasMetrics {
  sourceNodeCount: number;
  visibleNodeCount: number;
  renderedPrimitiveCount: number;
  visibleLabelCount: number;
  clusterNodeCount: number;
  lod: "overview" | "middle" | "detail";
  capped: boolean;
  buildMs: number;
}

export interface IdentityGraphAtlas {
  nodes: IdentityGraphAtlasNode[];
  edges: IdentityGraphAtlasEdge[];
  regions: IdentityGraphAtlasRegion[];
  labels: IdentityGraphAtlasLabel[];
  hitBuckets: IdentityGraphAtlasHitBucket[];
  bounds: IdentityGraphAtlasBounds;
  metrics: IdentityGraphAtlasMetrics;
}

export interface BuildIdentityGraphAtlasInput {
  persons: Person[];
  accounts: Record<string, Account>;
  feeds: Record<string, RssFeed>;
  activitySummaries: IdentityGraphActivitySummaries;
  mode: MapMode;
  transform: ViewTransform;
  width: number;
  height: number;
  quality: IdentityGraphAtlasQuality;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  friendSuggestionStrengthByPerson?: Record<string, FriendCandidateConfidence>;
  friendSuggestionStrengthByAccount?: Record<string, FriendCandidateConfidence>;
}

export type BuildIdentityGraphAtlasModelInput = Omit<
  BuildIdentityGraphAtlasInput,
  "transform" | "quality" | "selectedPersonId" | "selectedAccountId"
>;

export interface IdentityGraphAtlasModel {
  nodes: IdentityGraphAtlasNode[];
  edges: IdentityGraphAtlasEdge[];
  regions: IdentityGraphAtlasRegion[];
  bounds: IdentityGraphAtlasBounds;
}

export interface SliceIdentityGraphAtlasInput {
  model: IdentityGraphAtlasModel;
  transform: ViewTransform;
  width: number;
  height: number;
  quality: IdentityGraphAtlasQuality;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
}

interface ProviderBucket {
  provider: string;
  accounts: IdentityGraphAtlasNode[];
  feeds: IdentityGraphAtlasNode[];
  linkedCount: number;
}

const HIT_CELL_SIZE = 96;
const OVERVIEW_NODE_CAP = 220;
const MIDDLE_NODE_CAP = 520;
const DETAIL_NODE_CAP = 1_100;
const MOBILE_OVERVIEW_NODE_CAP = 150;
const MOBILE_MIDDLE_NODE_CAP = 520;
const MOBILE_DETAIL_NODE_CAP = 520;
const INTERACTIVE_NODE_CAP = 140;
const INTERACTIVE_DESKTOP_NODE_CAP = 240;
const LABEL_CAP = 120;
const MOBILE_LABEL_CAP = 56;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
  return Math.abs(hash);
}

function seededUnit(value: string): number {
  return (hashValue(value) % 10_000) / 10_000;
}

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedProvider(value: unknown): string {
  return safeText(value, "other").toLowerCase();
}

function providerLabel(provider: string): string {
  if (provider === "rss") return "RSS";
  if (provider === "x") return "X";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function initialsForLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function accountLabel(account: Account): string {
  return account.displayName?.trim() ||
    account.handle?.trim() ||
    account.externalId?.trim() ||
    account.provider ||
    "Account";
}

function isPinnedPosition(value: { graphPinned?: boolean; graphX?: number; graphY?: number }): boolean {
  return value.graphPinned === true &&
    typeof value.graphX === "number" &&
    Number.isFinite(value.graphX) &&
    typeof value.graphY === "number" &&
    Number.isFinite(value.graphY);
}

function applyPinnedPosition<T extends { graphPinned?: boolean; graphX?: number; graphY?: number }>(
  source: T,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (isPinnedPosition(source)) {
    return {
      x: source.graphX!,
      y: source.graphY!,
    };
  }
  return fallback;
}

function personActivity(
  personId: string,
  accounts: Account[],
  summaries: Record<string, IdentityGraphActivitySummary>,
): { count: number; latest: number; avatarUrl: string | null } {
  let count = 0;
  let latest = 0;
  let avatarUrl: string | null = null;
  for (const account of accounts) {
    if (account.personId !== personId || account.kind !== "social") continue;
    const summary = summaries[socialActivitySummaryKey(normalizedProvider(account.provider), account.externalId)];
    count += summary?.itemCount ?? 0;
    latest = Math.max(latest, summary?.latestActivityAt ?? 0, account.lastSeenAt ?? 0);
    avatarUrl = avatarUrl ?? account.avatarUrl ?? summary?.avatarUrl ?? null;
  }
  return { count, latest, avatarUrl };
}

function nodeIsNearViewport(
  node: IdentityGraphAtlasNode,
  transform: ViewTransform,
  width: number,
  height: number,
  padding: number,
): boolean {
  const x = node.x * transform.scale + transform.x;
  const y = node.y * transform.scale + transform.y;
  const radius = node.radius * transform.scale;
  return x >= -padding - radius &&
    x <= width + padding + radius &&
    y >= -padding - radius &&
    y <= height + padding + radius;
}

function graphBounds(nodes: IdentityGraphAtlasNode[], regions: IdentityGraphAtlasRegion[]): IdentityGraphAtlasBounds {
  const items = [
    ...nodes.map((node) => ({
      left: node.x - node.radius,
      right: node.x + node.radius,
      top: node.y - node.radius,
      bottom: node.y + node.radius,
    })),
    ...regions.map((region) => ({
      left: region.x - region.radiusX,
      right: region.x + region.radiusX,
      top: region.y - region.radiusY,
      bottom: region.y + region.radiusY,
    })),
  ];
  if (items.length === 0) {
    return { left: 0, right: 1, top: 0, bottom: 1 };
  }
  return {
    left: Math.min(...items.map((item) => item.left)),
    right: Math.max(...items.map((item) => item.right)),
    top: Math.min(...items.map((item) => item.top)),
    bottom: Math.max(...items.map((item) => item.bottom)),
  };
}

function buildHitBuckets(nodes: IdentityGraphAtlasNode[]): IdentityGraphAtlasHitBucket[] {
  const buckets = new Map<string, string[]>();
  for (const node of nodes) {
    const minX = Math.floor((node.x - node.radius) / HIT_CELL_SIZE);
    const maxX = Math.floor((node.x + node.radius) / HIT_CELL_SIZE);
    const minY = Math.floor((node.y - node.radius) / HIT_CELL_SIZE);
    const maxY = Math.floor((node.y + node.radius) / HIT_CELL_SIZE);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(node.id);
        } else {
          buckets.set(key, [node.id]);
        }
      }
    }
  }
  return [...buckets.entries()].map(([key, nodeIds]) => ({ key, nodeIds }));
}

function lodForScale(scale: number): "overview" | "middle" | "detail" {
  if (scale < 0.34) return "overview";
  if (scale < 0.85) return "middle";
  return "detail";
}

function maxNodesForViewport(width: number, quality: IdentityGraphAtlasQuality, lod: "overview" | "middle" | "detail"): number {
  const mobile = width <= 700;
  if (quality === "interactive") {
    return mobile ? INTERACTIVE_NODE_CAP : INTERACTIVE_DESKTOP_NODE_CAP;
  }
  if (lod === "overview") return mobile ? MOBILE_OVERVIEW_NODE_CAP : OVERVIEW_NODE_CAP;
  if (lod === "middle") return mobile ? MOBILE_MIDDLE_NODE_CAP : MIDDLE_NODE_CAP;
  return mobile ? MOBILE_DETAIL_NODE_CAP : DETAIL_NODE_CAP;
}

function nodeSortValue(node: IdentityGraphAtlasNode, selectedPersonId?: string | null, selectedAccountId?: string | null): number {
  let score = node.priority;
  if (node.personId && node.personId === selectedPersonId) score += 10_000;
  if (node.accountId && node.accountId === selectedAccountId) score += 10_000;
  if (node.linkedPersonId && node.linkedPersonId === selectedPersonId) score += 7_500;
  if (node.friendSuggestionConfidence === "high") score += 140;
  if (node.friendSuggestionConfidence === "medium") score += 80;
  score += Math.min(120, node.activityCount * 2);
  score += Math.min(80, (node.latestActivityAt ?? 0) / 86_400_000_000);
  return score;
}

export function buildIdentityGraphAtlasModel({
  persons,
  accounts,
  feeds,
  activitySummaries,
  mode,
  width,
  height,
  friendSuggestionStrengthByPerson = {},
  friendSuggestionStrengthByAccount = {},
}: BuildIdentityGraphAtlasModelInput): IdentityGraphAtlasModel {
  const accountValues = Object.values(accounts);
  const socialAccountsByPersonId = new Map<string, Account[]>();
  for (const account of accountValues) {
    if (account.kind !== "social" || !account.personId) continue;
    const siblings = socialAccountsByPersonId.get(account.personId);
    if (siblings) siblings.push(account);
    else socialAccountsByPersonId.set(account.personId, [account]);
  }
  const visiblePersons = persons
    .filter((person) => mode === "all_content" || person.relationshipStatus === "friend")
    .sort((left, right) =>
      right.careLevel - left.careLevel ||
      safeText(left.relationshipStatus).localeCompare(safeText(right.relationshipStatus)) ||
      hashValue(left.id) - hashValue(right.id) ||
      safeText(left.name).localeCompare(safeText(right.name)),
    );
  const visiblePersonIds = new Set(visiblePersons.map((person) => person.id));
  const centerX = width / 2;
  const centerY = height / 2;
  const minDimension = Math.min(width, height);
  const friendCount = visiblePersons.filter((person) => person.relationshipStatus === "friend").length;
  const connectionCount = visiblePersons.length - friendCount;
  const friendFieldRadius = Math.max(360, minDimension * 0.5, Math.sqrt(Math.max(1, friendCount)) * 82);
  const connectionInnerRadius = friendFieldRadius + 170;
  const connectionFieldWidth = Math.max(220, Math.sqrt(Math.max(1, connectionCount)) * 48);
  const allNodes: IdentityGraphAtlasNode[] = [];
  const edges: IdentityGraphAtlasEdge[] = [];
  const regions: IdentityGraphAtlasRegion[] = [];
  const providerBuckets = new Map<string, ProviderBucket>();

  let friendIndex = 0;
  let connectionIndex = 0;
  for (let index = 0; index < visiblePersons.length; index += 1) {
    const person = visiblePersons[index]!;
    const linkedAccounts = socialAccountsByPersonId.get(person.id) ?? [];
    const activity = personActivity(person.id, linkedAccounts, activitySummaries.social);
    const friend = person.relationshipStatus === "friend";
    const angle = friend
      ? -Math.PI / 2 + friendIndex * GOLDEN_ANGLE + (seededUnit(`person:${person.id}:angle`) - 0.5) * 0.16
      : -Math.PI / 2 + connectionIndex * GOLDEN_ANGLE + (seededUnit(`connection:${person.id}:angle`) - 0.5) * 0.2;
    const carePull = 1 - ((person.careLevel - 1) / 4) * 0.12;
    const radius = friend
      ? Math.sqrt((friendIndex + 0.55) / Math.max(1, friendCount)) * friendFieldRadius * carePull
      : connectionInnerRadius +
        Math.sqrt((connectionIndex + 0.5) / Math.max(1, connectionCount)) * connectionFieldWidth;
    const fallback = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * 0.74,
    };
    if (friend) friendIndex += 1;
    else connectionIndex += 1;
    const position = applyPinnedPosition(person, fallback);
    allNodes.push({
      id: `person:${person.id}`,
      kind: friend ? "friend_person" : "connection_person",
      label: safeText(person.name, "Unnamed friend"),
      x: position.x,
      y: position.y,
      radius: friend
        ? Math.min(70, 44 + person.careLevel * 4 + Math.min(16, linkedAccounts.length * 0.8))
        : Math.min(46, 28 + Math.min(12, linkedAccounts.length * 1.2)),
      priority: friend ? 900 + person.careLevel * 40 : 560 + linkedAccounts.length * 10,
      personId: person.id,
      initials: initialsForLabel(person.name),
      avatarUrl: person.avatarUrl ?? activity.avatarUrl,
      activityCount: activity.count,
      latestActivityAt: activity.latest > 0 ? activity.latest : undefined,
      graphPinned: person.graphPinned,
      careLevel: person.careLevel,
      friendSuggestionConfidence: friendSuggestionStrengthByPerson[person.id],
    });
  }

  const personNodeById = new Map(allNodes.filter((node) => node.personId).map((node) => [node.personId!, node]));
  const visibleSocialAccounts = accountValues
    .filter((account) => account.kind === "social")
    .filter((account) => mode === "all_content" || (!!account.personId && visiblePersonIds.has(account.personId)));

  for (const account of visibleSocialAccounts) {
    const provider = normalizedProvider(account.provider);
    const linkedPersonId = account.personId && visiblePersonIds.has(account.personId) ? account.personId : null;
    const summary = activitySummaries.social[socialActivitySummaryKey(provider, account.externalId)];
    const linkedPerson = linkedPersonId ? personNodeById.get(linkedPersonId) : null;
    const label = accountLabel(account);
    const activityCount = summary?.itemCount ?? 0;
    const radius = Math.min(linkedPerson ? 21 : 15, Math.max(10, (linkedPerson ? 12 : 10) + Math.log2(activityCount + 1.5) * 1.9));
    let fallback: { x: number; y: number };
    if (linkedPerson) {
      const siblings = linkedPersonId ? socialAccountsByPersonId.get(linkedPersonId) ?? [] : [];
      const siblingIndex = Math.max(0, siblings.findIndex((entry) => entry.id === account.id));
      const maximumRingCapacity = linkedPerson.radius >= 60 ? 18 : 14;
      const ringIndex = Math.floor(siblingIndex / maximumRingCapacity);
      const indexInRing = siblingIndex % maximumRingCapacity;
      const ringPopulation = Math.min(
        maximumRingCapacity,
        Math.max(1, siblings.length - ringIndex * maximumRingCapacity),
      );
      const orbit = linkedPerson.radius + 10 + ringIndex * 12;
      const orbitRotation = seededUnit(`person:${linkedPersonId}:orbit`) * Math.PI * 2;
      const angle = orbitRotation + (Math.PI * 2 * (indexInRing + ringIndex * 0.36)) / ringPopulation;
      fallback = {
        x: linkedPerson.x + Math.cos(angle) * orbit,
        y: linkedPerson.y + Math.sin(angle) * orbit * 0.9,
      };
    } else {
      fallback = {
        x: centerX,
        y: centerY,
      };
    }
    const position = applyPinnedPosition(account, fallback);
    const node: IdentityGraphAtlasNode = {
      id: `account:${account.id}`,
      kind: "account",
      label,
      x: position.x,
      y: position.y,
      radius,
      priority: linkedPerson ? 420 + activityCount : 280 + activityCount,
      accountId: account.id,
      provider,
      linkedPersonId,
      initials: initialsForLabel(label),
      avatarUrl: account.avatarUrl ?? summary?.avatarUrl ?? null,
      activityCount,
      latestActivityAt: summary?.latestActivityAt,
      graphPinned: account.graphPinned,
      friendSuggestionConfidence: friendSuggestionStrengthByAccount[account.id],
    };

    if (linkedPerson) {
      allNodes.push(node);
      edges.push({
        id: `edge:${linkedPerson.id}:${node.id}`,
        sourceId: linkedPerson.id,
        targetId: node.id,
      });
    } else {
      const bucket = providerBuckets.get(provider) ?? {
        provider,
        accounts: [],
        feeds: [],
        linkedCount: 0,
      };
      bucket.accounts.push(node);
      providerBuckets.set(provider, bucket);
    }
  }

  for (const account of visibleSocialAccounts) {
    if (!account.personId) continue;
    const provider = normalizedProvider(account.provider);
    const bucket = providerBuckets.get(provider) ?? {
      provider,
      accounts: [],
      feeds: [],
      linkedCount: 0,
    };
    bucket.linkedCount += 1;
    providerBuckets.set(provider, bucket);
  }

  if (mode === "all_content") {
    for (const feed of Object.values(feeds).filter((entry) => entry.enabled !== false)) {
      const summary = activitySummaries.rss[feed.url];
      const label = feed.title || feed.url;
      const node: IdentityGraphAtlasNode = {
        id: `feed:${feed.url}`,
        kind: "feed",
        label,
        x: centerX,
        y: centerY,
        radius: Math.min(12, Math.max(6, 7 + Math.log2((summary?.itemCount ?? 0) + 1.5) * 1.35)),
        priority: 180 + (summary?.itemCount ?? 0),
        provider: "rss",
        feedUrl: feed.url,
        initials: initialsForLabel(label),
        avatarUrl: feed.imageUrl ?? summary?.avatarUrl ?? null,
        activityCount: summary?.itemCount ?? 0,
        latestActivityAt: summary?.latestActivityAt,
      };
      const bucket = providerBuckets.get("rss") ?? {
        provider: "rss",
        accounts: [],
        feeds: [],
        linkedCount: 0,
      };
      bucket.feeds.push(node);
      providerBuckets.set("rss", bucket);
    }
  }

  const providers = [...providerBuckets.values()].sort((left, right) =>
    safeText(left.provider, "other").localeCompare(safeText(right.provider, "other")),
  );
  const outerRadius = Math.max(560, friendFieldRadius + connectionFieldWidth + 170);
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const bucket = providers[providerIndex]!;
    const unlinked = [...bucket.accounts, ...bucket.feeds].sort((left, right) =>
      nodeSortValue(right) - nodeSortValue(left) ||
      safeText(left.label).localeCompare(safeText(right.label)),
    );
    const angle = -Math.PI / 2 + (Math.PI * 2 * providerIndex) / Math.max(1, providers.length);
    const islandRing = Math.floor(providerIndex / 8);
    const islandRadius = outerRadius + islandRing * 140;
    const islandX = centerX + Math.cos(angle) * islandRadius;
    const islandY = centerY + Math.sin(angle) * islandRadius * 0.82;
    const islandSize = Math.max(96, Math.ceil(Math.sqrt(unlinked.length)) * 20);
    const regionRadiusX = islandSize + 48;
    const regionRadiusY = islandSize * 0.78 + 38;
    regions.push({
      id: `region:${bucket.provider}`,
      provider: bucket.provider,
      label: providerLabel(bucket.provider),
      x: islandX,
      y: islandY,
      radiusX: regionRadiusX,
      radiusY: regionRadiusY,
      count: bucket.linkedCount + unlinked.length,
      linkedCount: bucket.linkedCount,
      unlinkedCount: unlinked.length,
    });

    if (unlinked.length > 0) {
      allNodes.push({
        id: `provider:${bucket.provider}`,
        kind: "provider_cluster",
        label: `${providerLabel(bucket.provider)} ${unlinked.length.toLocaleString()}`,
        x: islandX,
        y: islandY,
        radius: Math.min(54, Math.max(28, 18 + Math.sqrt(unlinked.length) * 3)),
        priority: 640 + unlinked.length,
        provider: bucket.provider,
        initials: providerLabel(bucket.provider).slice(0, 2).toUpperCase(),
        activityCount: unlinked.reduce((sum, node) => sum + node.activityCount, 0),
        aggregateCount: unlinked.length,
      });
    }

    unlinked.forEach((node, index) => {
      const localPoint = providerGalaxyNodePoint(
        bucket.provider,
        index,
        unlinked.length,
        regionRadiusX,
        regionRadiusY,
      );
      const fallback = {
        x: islandX + localPoint.x,
        y: islandY + localPoint.y,
      };
      if (node.accountId) {
        const account = accounts[node.accountId];
        if (account) {
          const position = applyPinnedPosition(account, fallback);
          node.x = position.x;
          node.y = position.y;
        }
      } else {
        node.x = fallback.x;
        node.y = fallback.y;
      }
      allNodes.push(node);
    });
  }

  return {
    nodes: allNodes,
    edges,
    regions,
    bounds: graphBounds(allNodes, regions),
  };
}

export function sliceIdentityGraphAtlas({
  model,
  transform,
  width,
  height,
  quality,
  selectedPersonId,
  selectedAccountId,
}: SliceIdentityGraphAtlasInput): IdentityGraphAtlas {
  const startedAt = nowMs();
  const allNodes = model.nodes;
  const edges = model.edges;
  const regions = model.regions;

  const lod = lodForScale(transform.scale);
  const maxNodes = maxNodesForViewport(width, quality, lod);
  const viewportPadding = quality === "interactive" ? 120 : 260;
  const selectedNodeIds = new Set<string>();
  if (selectedPersonId) {
    selectedNodeIds.add(`person:${selectedPersonId}`);
  }
  if (selectedAccountId) {
    selectedNodeIds.add(`account:${selectedAccountId}`);
  }
  const sourceNodeCount = allNodes.length;
  const nearViewportNodes = allNodes.filter((node) =>
    selectedNodeIds.has(node.id) ||
    nodeIsNearViewport(node, transform, width, height, viewportPadding),
  );
  const tierFiltered = nearViewportNodes.filter((node) => {
    if (selectedNodeIds.has(node.id)) return true;
    if (node.kind === "provider_cluster") return lod !== "detail" || node.aggregateCount! > 24;
    if (quality === "interactive") {
      return node.kind === "friend_person" ||
        node.kind === "connection_person" ||
        (node.kind === "account" && !!node.linkedPersonId && node.priority > 430);
    }
    if (lod === "overview") {
      return node.kind === "friend_person" ||
        (node.kind === "account" && !!node.linkedPersonId && node.priority > 480);
    }
    if (lod === "middle") {
      return node.kind !== "feed" && (node.kind !== "account" || !!node.linkedPersonId || node.priority > 340);
    }
    return true;
  });
  const sortedVisible = tierFiltered.sort((left, right) =>
    nodeSortValue(right, selectedPersonId, selectedAccountId) - nodeSortValue(left, selectedPersonId, selectedAccountId) ||
    left.id.localeCompare(right.id),
  );
  const visibleNodes = sortedVisible.slice(0, maxNodes);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = quality === "interactive"
    ? []
    : edges.filter((edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId));
  const labelCap = width <= 700 ? MOBILE_LABEL_CAP : LABEL_CAP;
  const regionLabels: IdentityGraphAtlasLabel[] = quality === "interactive"
    ? []
    : regions
      .filter((region) => {
        const pointX = region.x * transform.scale + transform.x;
        const pointY = region.y * transform.scale + transform.y;
        return pointX >= -220 &&
          pointX <= width + 220 &&
          pointY >= -220 &&
          pointY <= height + 220;
      })
      .map((region) => ({
        id: `label:${region.id}`,
        nodeId: `provider:${region.provider}`,
        text: `${region.label} ${region.count.toLocaleString()}`,
        x: region.x,
        y: region.y,
        priority: 1_200 + region.count,
        kind: "provider_cluster",
      }));
  const nodeLabels = quality === "interactive"
    ? []
    : visibleNodes
      .filter((node) =>
        node.kind !== "provider_cluster" && (
          selectedNodeIds.has(node.id) ||
          (lod === "overview" && node.kind === "friend_person" && node.priority >= 980) ||
          (lod === "middle" && (node.kind === "friend_person" || node.priority >= 620)) ||
          (lod === "detail" && node.priority >= 320)
        ),
      )
      .map((node) => ({
        id: `label:${node.id}`,
        nodeId: node.id,
        text: node.label,
        x: node.x,
        y: node.y,
        priority: node.priority + (selectedNodeIds.has(node.id) ? 10_000 : 0),
        kind: node.kind,
      }));
  const labels = [...regionLabels, ...nodeLabels]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, labelCap);
  const clusterNodeCount = visibleNodes.filter((node) => node.kind === "provider_cluster").length;

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    regions,
    labels,
    hitBuckets: buildHitBuckets(visibleNodes),
    bounds: model.bounds,
    metrics: {
      sourceNodeCount,
      visibleNodeCount: visibleNodes.length,
      renderedPrimitiveCount: visibleNodes.length + visibleEdges.length + regions.length + labels.length,
      visibleLabelCount: labels.length,
      clusterNodeCount,
      lod,
      capped: sortedVisible.length > visibleNodes.length,
      buildMs: nowMs() - startedAt,
    },
  };
}

export function buildIdentityGraphAtlas(input: BuildIdentityGraphAtlasInput): IdentityGraphAtlas {
  const model = buildIdentityGraphAtlasModel(input);
  return sliceIdentityGraphAtlas({
    model,
    transform: input.transform,
    width: input.width,
    height: input.height,
    quality: input.quality,
    selectedPersonId: input.selectedPersonId,
    selectedAccountId: input.selectedAccountId,
  });
}

export function fitTransformToAtlasBounds(
  bounds: IdentityGraphAtlasBounds,
  width: number,
  height: number,
  padding: number = 80,
): ViewTransform {
  const contentWidth = Math.max(1, bounds.right - bounds.left);
  const contentHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(1.3, availableWidth / contentWidth, availableHeight / contentHeight);
  return {
    x: width / 2 - ((bounds.left + bounds.right) / 2) * scale,
    y: height / 2 - ((bounds.top + bounds.bottom) / 2) * scale,
    scale,
  };
}
