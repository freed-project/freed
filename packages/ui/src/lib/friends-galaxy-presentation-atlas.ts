import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNodeKind,
} from "./identity-graph-atlas.js";
import {
  IdentityGalaxyNodeKindCode,
  type IdentityGalaxyScene,
} from "./identity-galaxy-scene.js";
import {
  findFriendsGalaxySceneNodeIndex,
  type FriendsGalaxySceneInteractionIndex,
} from "./friends-galaxy-scene-interaction-index.js";

export const FRIENDS_GALAXY_PRESENTATION_NODE_CAP = 192;
export const FRIENDS_GALAXY_PRESENTATION_LABEL_CAP = 120;
export const FRIENDS_GALAXY_PRESENTATION_REGION_CAP = 16;

export interface FriendsGalaxyPresentationAtlasAdmission {
  nodeCap?: number;
  labelCap?: number;
  regionCap?: number;
}

const NODE_KINDS = new Set<IdentityGraphAtlasNodeKind>([
  "friend_person",
  "connection_person",
  "account",
  "feed",
  "provider_cluster",
]);

function semanticKind(scene: IdentityGalaxyScene, nodeIndex: number): IdentityGraphAtlasNodeKind {
  const kind = scene.kinds[nodeIndex];
  if (kind === IdentityGalaxyNodeKindCode.FriendPerson) return "friend_person";
  if (kind === IdentityGalaxyNodeKindCode.ConnectionPerson) return "connection_person";
  if (kind === IdentityGalaxyNodeKindCode.Feed) return "feed";
  if (kind === IdentityGalaxyNodeKindCode.Account) return "account";
  return "provider_cluster";
}

function assertPlainArray(
  label: string,
  value: unknown,
  cap: number,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > cap) {
    throw new Error(`Friends Galaxy presentation ${label} exceeds its bounded contract.`);
  }
}

function assertText(label: string, value: unknown, maximumLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error(`Friends Galaxy presentation ${label} is invalid.`);
  }
}

function assertFinite(label: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Friends Galaxy presentation ${label} is not finite.`);
  }
}

function assertNonNegativeInteger(label: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Friends Galaxy presentation ${label} is invalid.`);
  }
}

function safeCap(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(fallback, Math.max(0, Math.floor(value!)))
    : fallback;
}

export function validateFriendsGalaxyPresentationAtlas(
  candidate: unknown,
  scene: IdentityGalaxyScene,
  interactionIndex: FriendsGalaxySceneInteractionIndex,
  admission: FriendsGalaxyPresentationAtlasAdmission = {},
): asserts candidate is IdentityGraphAtlas {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Friends Galaxy worker returned invalid presentation metadata.");
  }
  const atlas = candidate as IdentityGraphAtlas;
  assertPlainArray(
    "nodes",
    atlas.nodes,
    safeCap(admission.nodeCap, FRIENDS_GALAXY_PRESENTATION_NODE_CAP),
  );
  assertPlainArray(
    "labels",
    atlas.labels,
    safeCap(admission.labelCap, FRIENDS_GALAXY_PRESENTATION_LABEL_CAP),
  );
  assertPlainArray(
    "regions",
    atlas.regions,
    safeCap(admission.regionCap, FRIENDS_GALAXY_PRESENTATION_REGION_CAP),
  );
  assertPlainArray("edges", atlas.edges, 0);
  assertPlainArray("hit buckets", atlas.hitBuckets, 0);

  const providerNodeIds = new Set<string>();
  const providers = new Set<string>();
  for (const region of atlas.regions) {
    if (!region || typeof region !== "object") {
      throw new Error("Friends Galaxy presentation region is invalid.");
    }
    assertText("region id", region.id, 256);
    assertText("region provider", region.provider, 64);
    assertText("region label", region.label, 120);
    for (const [label, value] of [
      ["region x", region.x],
      ["region y", region.y],
      ["region radius x", region.radiusX],
      ["region radius y", region.radiusY],
    ] as const) assertFinite(label, value);
    for (const [label, value] of [
      ["region count", region.count],
      ["region linked count", region.linkedCount],
      ["region unlinked count", region.unlinkedCount],
    ] as const) assertNonNegativeInteger(label, value);
    providers.add(region.provider);
    providerNodeIds.add(`provider:${region.provider}`);
    if (region.linkedCount + region.unlinkedCount !== region.count) {
      throw new Error("Friends Galaxy presentation region counts do not balance.");
    }
  }

  const admittedNodeIds = new Set<string>();
  for (const node of atlas.nodes) {
    if (!node || typeof node !== "object") {
      throw new Error("Friends Galaxy presentation node is invalid.");
    }
    assertText("node id", node.id, 512);
    assertText("node label", node.label, 160);
    if (!NODE_KINDS.has(node.kind)) {
      throw new Error("Friends Galaxy presentation node kind is invalid.");
    }
    if (admittedNodeIds.has(node.id)) {
      throw new Error("Friends Galaxy presentation contains a duplicate node.");
    }
    admittedNodeIds.add(node.id);
    const semanticNodeIndex = findFriendsGalaxySceneNodeIndex(
      scene,
      interactionIndex,
      node.id,
    );
    if (semanticNodeIndex === null && !providerNodeIds.has(node.id)) {
      throw new Error("Friends Galaxy presentation node is outside the resident scene.");
    }
    if (semanticNodeIndex === null) {
      if (
        node.kind !== "provider_cluster" ||
        !providers.has(node.provider ?? "") ||
        node.id !== `provider:${node.provider ?? ""}`
      ) {
        throw new Error("Friends Galaxy presentation provider node has no matching region.");
      }
    } else {
      if (node.kind !== semanticKind(scene, semanticNodeIndex)) {
        throw new Error("Friends Galaxy presentation node kind does not match the resident scene.");
      }
      if (
        (node.personId ?? null) !== scene.personIds[semanticNodeIndex] ||
        (node.accountId ?? null) !== scene.accountIds[semanticNodeIndex] ||
        (node.linkedPersonId ?? null) !== scene.linkedPersonIds[semanticNodeIndex]
      ) {
        throw new Error("Friends Galaxy presentation node identity does not match the resident scene.");
      }
    }
    for (const [label, value] of [
      ["node x", node.x],
      ["node y", node.y],
      ["node radius", node.radius],
      ["node priority", node.priority],
    ] as const) assertFinite(label, value);
    assertNonNegativeInteger("node activity count", node.activityCount);
    if (node.initials !== undefined) assertText("node initials", node.initials, 12);
    if (node.avatarUrl !== undefined && node.avatarUrl !== null) {
      assertText("node avatar URL", node.avatarUrl, 4_096);
    }
  }

  const admittedLabelIds = new Set<string>();
  for (const label of atlas.labels) {
    if (!label || typeof label !== "object") {
      throw new Error("Friends Galaxy presentation label is invalid.");
    }
    assertText("label id", label.id, 512);
    assertText("label node id", label.nodeId, 512);
    assertText("label text", label.text, 160);
    if (!NODE_KINDS.has(label.kind)) {
      throw new Error("Friends Galaxy presentation label kind is invalid.");
    }
    if (admittedLabelIds.has(label.id)) {
      throw new Error("Friends Galaxy presentation contains a duplicate label.");
    }
    admittedLabelIds.add(label.id);
    const semanticNodeIndex = findFriendsGalaxySceneNodeIndex(
      scene,
      interactionIndex,
      label.nodeId,
    );
    if (semanticNodeIndex === null && !providerNodeIds.has(label.nodeId)) {
      throw new Error("Friends Galaxy presentation label is outside the resident scene.");
    }
    if (
      (semanticNodeIndex === null && label.kind !== "provider_cluster") ||
      (semanticNodeIndex !== null && label.kind !== semanticKind(scene, semanticNodeIndex))
    ) {
      throw new Error("Friends Galaxy presentation label kind does not match its node.");
    }
    assertFinite("label x", label.x);
    assertFinite("label y", label.y);
    assertFinite("label priority", label.priority);
  }

  if (!atlas.bounds || typeof atlas.bounds !== "object") {
    throw new Error("Friends Galaxy presentation bounds are invalid.");
  }
  for (const [label, value] of [
    ["left bound", atlas.bounds.left],
    ["right bound", atlas.bounds.right],
    ["top bound", atlas.bounds.top],
    ["bottom bound", atlas.bounds.bottom],
  ] as const) assertFinite(label, value);
  if (atlas.bounds.left > atlas.bounds.right || atlas.bounds.top > atlas.bounds.bottom) {
    throw new Error("Friends Galaxy presentation bounds are inverted.");
  }
  if (!atlas.metrics || typeof atlas.metrics !== "object") {
    throw new Error("Friends Galaxy presentation metrics are invalid.");
  }
  for (const [label, value] of [
    ["source node count", atlas.metrics.sourceNodeCount],
    ["visible node count", atlas.metrics.visibleNodeCount],
    ["rendered primitive count", atlas.metrics.renderedPrimitiveCount],
    ["visible label count", atlas.metrics.visibleLabelCount],
    ["cluster node count", atlas.metrics.clusterNodeCount],
  ] as const) assertNonNegativeInteger(label, value);
  assertFinite("build duration", atlas.metrics.buildMs);
  if (atlas.metrics.buildMs < 0 || atlas.metrics.visibleNodeCount !== atlas.nodes.length) {
    throw new Error("Friends Galaxy presentation metrics do not match their payload.");
  }
  if (!new Set(["overview", "middle", "detail"]).has(atlas.metrics.lod)) {
    throw new Error("Friends Galaxy presentation detail tier is invalid.");
  }
}
