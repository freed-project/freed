import type { IdentityGalaxyScene } from "./identity-galaxy-scene.js";
import type { IdentityGraphAtlas } from "./identity-graph-atlas.js";
import { createFriendsGalaxyBackgroundField } from "./friends-galaxy-background.js";
import type {
  FriendsGalaxyPresentationCandidateSource,
  FriendsGalaxyRendererScene,
} from "./friends-galaxy-renderer.js";
import { createFriendsGalaxySceneInteractionIndex } from "./friends-galaxy-scene-interaction-index.js";
import { createFriendsGalaxyPackedStarInstances } from "./friends-galaxy-star-instances.js";

export interface CreateFriendsGalaxyRendererSceneInput {
  atlas: IdentityGraphAtlas;
  scene: IdentityGalaxyScene;
  personCount: number;
  accountCount: number;
  linkedAccountCount: number;
  backgroundStarCount: number;
  backgroundSeed?: string;
  presentationCandidateSource?: FriendsGalaxyPresentationCandidateSource;
}

function safeSourceCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function createFriendsGalaxyRendererScene({
  atlas,
  scene,
  personCount,
  accountCount,
  linkedAccountCount,
  backgroundStarCount,
  backgroundSeed,
  presentationCandidateSource = "scene",
}: CreateFriendsGalaxyRendererSceneInput): FriendsGalaxyRendererScene {
  const safePersonCount = safeSourceCount(personCount);
  const safeAccountCount = safeSourceCount(accountCount);
  const safeBackgroundCount = safeSourceCount(backgroundStarCount);
  const safeLinkedAccountCount = Math.min(
    safeAccountCount,
    safeSourceCount(linkedAccountCount),
  );
  if (safePersonCount + safeAccountCount !== scene.nodeIds.length) {
    throw new Error(
      "Friends Galaxy renderer scene counts do not match its semantic nodes.",
    );
  }
  const background = createFriendsGalaxyBackgroundField(
    safeBackgroundCount,
    backgroundSeed,
  );
  return {
    atlas,
    scene,
    presentationCandidateSource,
    interactionIndex: createFriendsGalaxySceneInteractionIndex(scene),
    packedStarInstances: createFriendsGalaxyPackedStarInstances({
      scene,
      backgroundPositions: background.positions,
      backgroundBrightness: background.brightness,
    }),
    backgroundPositions: background.positions,
    backgroundBrightness: background.brightness,
    personCount: safePersonCount,
    accountCount: safeAccountCount,
    linkedAccountCount: safeLinkedAccountCount,
    backgroundStarCount: safeBackgroundCount,
  };
}

export function compactFriendsGalaxyRendererSceneMetadata<
  Scene extends FriendsGalaxyRendererScene,
>(
  scene: Scene,
  cap: number,
  priorityNodeIds: readonly string[] = [],
): Scene {
  return {
    ...scene,
    atlas: compactFriendsGalaxyPresentationMetadata(
      scene.atlas,
      scene.scene.nodeIds.length,
      cap,
      priorityNodeIds,
    ),
  };
}

export function compactFriendsGalaxyPresentationMetadata(
  atlas: IdentityGraphAtlas,
  semanticNodeCount: number,
  cap: number,
  priorityNodeIds: readonly string[] = [],
): IdentityGraphAtlas {
  const safeCap = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
  const safeSemanticNodeCount = Number.isFinite(semanticNodeCount)
    ? Math.max(0, Math.floor(semanticNodeCount))
    : 0;
  const requiredNodeIds = new Set(atlas.labels.map((label) => label.nodeId));
  const nodes = [];
  const acceptedNodeIds = new Set<string>();
  const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));

  for (const nodeId of priorityNodeIds) {
    if (nodes.length >= safeCap || acceptedNodeIds.has(nodeId)) continue;
    const node = nodeById.get(nodeId);
    if (!node) continue;
    nodes.push(node);
    acceptedNodeIds.add(nodeId);
  }

  for (const node of atlas.nodes) {
    if (nodes.length >= safeCap) break;
    if (!requiredNodeIds.has(node.id) || acceptedNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }
  for (const node of atlas.nodes) {
    if (nodes.length >= safeCap) break;
    if (!node.personId || acceptedNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }

  return {
    ...atlas,
    nodes,
    edges: [],
    hitBuckets: [],
    metrics: {
      ...atlas.metrics,
      visibleNodeCount: nodes.length,
      capped: safeSemanticNodeCount > nodes.length,
    },
  };
}
