import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
  IdentityGraphAtlasQuality,
} from "./identity-graph-atlas.js";

export const IDENTITY_GALAXY_SCENE_VERSION = 1 as const;

export const IdentityGalaxyNodeKindCode = {
  FriendPerson: 0,
  ConnectionPerson: 1,
  Account: 2,
  Feed: 3,
  ProviderCluster: 4,
} as const;

export type IdentityGalaxyNodeKindCode =
  (typeof IdentityGalaxyNodeKindCode)[keyof typeof IdentityGalaxyNodeKindCode];

export const IdentityGalaxyColorRole = {
  Friend: 0,
  Connection: 1,
  Account: 2,
  Feed: 3,
  Provider: 4,
} as const;

export type IdentityGalaxyColorRole =
  (typeof IdentityGalaxyColorRole)[keyof typeof IdentityGalaxyColorRole];

export const IdentityGalaxyNodeFlag = {
  Selected: 1 << 0,
  Hovered: 1 << 1,
  LinkedToSelection: 1 << 2,
  Pinned: 1 << 3,
  SuggestedHigh: 1 << 4,
  SuggestedMedium: 1 << 5,
} as const;

export interface IdentityGalaxySceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface IdentityGalaxyScene {
  version: typeof IDENTITY_GALAXY_SCENE_VERSION;
  nodeIds: readonly string[];
  providers: readonly (string | null)[];
  kinds: Uint8Array;
  colorRoles: Uint8Array;
  flags: Uint16Array;
  positions: Float32Array;
  radii: Float32Array;
  pointSizes: Float32Array;
  prominence: Float32Array;
  brightness: Float32Array;
  emphasis: Float32Array;
  edgeIndices: Uint32Array;
  bounds: IdentityGalaxySceneBounds;
}

export interface CompileIdentityGalaxySceneOptions {
  quality: IdentityGraphAtlasQuality;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  hoveredNodeId?: string | null;
  now?: number;
}

const GALAXY_FAR_DEPTH = -220;
const GALAXY_DEPTH_SPAN = 440;
const LINKED_ACCOUNT_DEPTH_GAP = 44;
const DAY_MS = 86_400_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function nodeKindCode(node: IdentityGraphAtlasNode): IdentityGalaxyNodeKindCode {
  if (node.kind === "friend_person") return IdentityGalaxyNodeKindCode.FriendPerson;
  if (node.kind === "connection_person") return IdentityGalaxyNodeKindCode.ConnectionPerson;
  if (node.kind === "account") return IdentityGalaxyNodeKindCode.Account;
  if (node.kind === "feed") return IdentityGalaxyNodeKindCode.Feed;
  return IdentityGalaxyNodeKindCode.ProviderCluster;
}

function colorRole(node: IdentityGraphAtlasNode): IdentityGalaxyColorRole {
  if (node.kind === "friend_person") return IdentityGalaxyColorRole.Friend;
  if (node.kind === "connection_person") return IdentityGalaxyColorRole.Connection;
  if (node.kind === "feed") return IdentityGalaxyColorRole.Feed;
  if (node.kind === "provider_cluster") return IdentityGalaxyColorRole.Provider;
  return IdentityGalaxyColorRole.Account;
}

function activitySignal(activityCount: number): number {
  return clamp(Math.log2(Math.max(0, activityCount) + 1) / 10, 0, 1);
}

function semanticProminence(node: IdentityGraphAtlasNode): number {
  const activity = activitySignal(node.activityCount);
  if (node.kind === "friend_person") {
    const careLevel = node.careLevel ?? clamp(Math.round((node.priority - 900) / 40), 1, 5);
    return clamp(0.62 + (careLevel - 1) * 0.085 + activity * 0.035, 0, 1);
  }
  if (node.kind === "connection_person") {
    return clamp(0.34 + activity * 0.07, 0, 0.5);
  }
  if (node.kind === "provider_cluster") {
    return clamp(0.22 + Math.log2((node.aggregateCount ?? 0) + 1) * 0.018, 0, 0.38);
  }
  if (node.kind === "account") {
    return clamp((node.linkedPersonId ? 0.2 : 0.12) + activity * 0.045, 0, 0.3);
  }
  return clamp(0.08 + activity * 0.035, 0, 0.2);
}

function pointSize(
  node: IdentityGraphAtlasNode,
  selected: boolean,
  hovered: boolean,
  quality: IdentityGraphAtlasQuality,
): number {
  const roleSize = node.kind === "friend_person"
    ? 34
    : node.kind === "connection_person"
      ? 28
      : node.kind === "provider_cluster"
        ? 40
        : node.kind === "feed"
          ? 20
          : 22;
  const size = roleSize + node.radius * 1.05 + (selected ? 22 : hovered ? 12 : 0);
  return Math.max(8, size * (quality === "interactive" ? 0.78 : 1));
}

function recencySignal(latestActivityAt: number | undefined, now: number): number {
  if (!latestActivityAt || latestActivityAt <= 0) return 0;
  const ageDays = Math.max(0, now - latestActivityAt) / DAY_MS;
  return 1 - clamp(ageDays / 120, 0, 1);
}

function nodeFlags(
  node: IdentityGraphAtlasNode,
  options: CompileIdentityGalaxySceneOptions,
): number {
  const selected =
    (!!node.personId && node.personId === options.selectedPersonId) ||
    (!!node.accountId && node.accountId === options.selectedAccountId);
  let flags = selected ? IdentityGalaxyNodeFlag.Selected : 0;
  if (node.id === options.hoveredNodeId) flags |= IdentityGalaxyNodeFlag.Hovered;
  if (options.selectedPersonId && node.linkedPersonId === options.selectedPersonId) {
    flags |= IdentityGalaxyNodeFlag.LinkedToSelection;
  }
  if (node.graphPinned) flags |= IdentityGalaxyNodeFlag.Pinned;
  if (node.friendSuggestionConfidence === "high") flags |= IdentityGalaxyNodeFlag.SuggestedHigh;
  if (node.friendSuggestionConfidence === "medium") flags |= IdentityGalaxyNodeFlag.SuggestedMedium;
  return flags;
}

function boundsForPositions(positions: Float32Array): IdentityGalaxySceneBounds {
  if (positions.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset]!;
    const y = positions[offset + 1]!;
    const z = positions[offset + 2]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function compileIdentityGalaxyScene(
  atlas: IdentityGraphAtlas,
  options: CompileIdentityGalaxySceneOptions,
): IdentityGalaxyScene {
  const nodeCount = atlas.nodes.length;
  const nodeIds = new Array<string>(nodeCount);
  const providers = new Array<string | null>(nodeCount);
  const kinds = new Uint8Array(nodeCount);
  const colorRoles = new Uint8Array(nodeCount);
  const flags = new Uint16Array(nodeCount);
  const positions = new Float32Array(nodeCount * 3);
  const radii = new Float32Array(nodeCount);
  const pointSizes = new Float32Array(nodeCount);
  const prominence = new Float32Array(nodeCount);
  const brightness = new Float32Array(nodeCount);
  const emphasis = new Float32Array(nodeCount);
  const nodeIndexById = new Map<string, number>();
  const personDepthById = new Map<string, number>();
  const now = options.now ?? Date.now();
  const hasSelection = !!options.selectedPersonId || !!options.selectedAccountId;

  for (let index = 0; index < nodeCount; index += 1) {
    const node = atlas.nodes[index]!;
    const nodeProminence = semanticProminence(node);
    const jitter = (seededUnit(`${node.id}:galaxy-depth`) - 0.5) * 8;
    const depth = GALAXY_FAR_DEPTH + nodeProminence * GALAXY_DEPTH_SPAN + jitter;
    nodeIds[index] = node.id;
    providers[index] = node.provider ?? null;
    kinds[index] = nodeKindCode(node);
    colorRoles[index] = colorRole(node);
    flags[index] = nodeFlags(node, options);
    positions[index * 3] = node.x;
    positions[index * 3 + 1] = -node.y;
    positions[index * 3 + 2] = depth;
    radii[index] = node.radius;
    prominence[index] = nodeProminence;
    nodeIndexById.set(node.id, index);
    if (node.personId) personDepthById.set(node.personId, depth);
  }

  for (let index = 0; index < nodeCount; index += 1) {
    const node = atlas.nodes[index]!;
    if (!node.linkedPersonId) continue;
    const personDepth = personDepthById.get(node.linkedPersonId);
    if (personDepth === undefined) continue;
    const orbitOffset = seededUnit(`${node.id}:orbit-depth`) * 22;
    positions[index * 3 + 2] = Math.min(
      positions[index * 3 + 2]!,
      personDepth - LINKED_ACCOUNT_DEPTH_GAP - orbitOffset,
    );
  }

  for (let index = 0; index < nodeCount; index += 1) {
    const node = atlas.nodes[index]!;
    const nodeFlagBits = flags[index]!;
    const selected = (nodeFlagBits & IdentityGalaxyNodeFlag.Selected) !== 0;
    const hovered = (nodeFlagBits & IdentityGalaxyNodeFlag.Hovered) !== 0;
    const linked = (nodeFlagBits & IdentityGalaxyNodeFlag.LinkedToSelection) !== 0;
    pointSizes[index] = pointSize(node, selected, hovered, options.quality);
    brightness[index] = clamp(
      0.76 + activitySignal(node.activityCount) * 0.14 + recencySignal(node.latestActivityAt, now) * 0.1,
      0.76,
      1,
    );
    emphasis[index] = hasSelection && !selected && !hovered && !linked ? 0.34 : 1;
  }

  const edgeIndices = new Uint32Array(atlas.edges.length * 2);
  let edgeOffset = 0;
  for (const edge of atlas.edges) {
    const sourceIndex = nodeIndexById.get(edge.sourceId);
    const targetIndex = nodeIndexById.get(edge.targetId);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    edgeIndices[edgeOffset] = sourceIndex;
    edgeIndices[edgeOffset + 1] = targetIndex;
    edgeOffset += 2;
  }

  return {
    version: IDENTITY_GALAXY_SCENE_VERSION,
    nodeIds,
    providers,
    kinds,
    colorRoles,
    flags,
    positions,
    radii,
    pointSizes,
    prominence,
    brightness,
    emphasis,
    edgeIndices: edgeOffset === edgeIndices.length ? edgeIndices : edgeIndices.slice(0, edgeOffset),
    bounds: boundsForPositions(positions),
  };
}
