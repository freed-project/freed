import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
} from "./identity-graph-atlas.js";
import {
  compileIdentityGalaxyScene,
  type IdentityGalaxySceneSource,
} from "./identity-galaxy-scene.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import {
  compactFriendsGalaxyRendererSceneMetadata,
  createFriendsGalaxyRendererScene,
} from "./friends-galaxy-renderer-scene.js";

export const FRIENDS_GALAXY_PRODUCT_BACKGROUND_STAR_COUNT = 100_000;
export const FRIENDS_GALAXY_PRODUCT_METADATA_NODE_CAP = 192;

export interface CompileFriendsGalaxyProductSceneInput {
  atlas: IdentityGraphAtlas;
  source: IdentityGalaxySceneSource;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  backgroundStarCount?: number;
  backgroundSeed?: string;
  metadataNodeCap?: number;
  now?: number;
}

interface FriendsGalaxyProductSource {
  nodes: IdentityGraphAtlasNode[];
  personCount: number;
  accountCount: number;
  linkedAccountCount: number;
  priorityNodeIds: string[];
}

function productSource(
  source: IdentityGalaxySceneSource,
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
): FriendsGalaxyProductSource {
  const nodes: IdentityGraphAtlasNode[] = [];
  const priorityNodeIds: string[] = [];
  let personCount = 0;
  let accountCount = 0;
  let linkedAccountCount = 0;

  for (const node of source.nodes) {
    if (node.kind === "provider_cluster") continue;
    nodes.push(node);
    if (node.kind === "friend_person" || node.kind === "connection_person") {
      personCount += 1;
    } else if (node.kind === "account" || node.kind === "feed") {
      accountCount += 1;
      if (node.linkedPersonId) linkedAccountCount += 1;
    }
    if (
      (selectedPersonId && node.personId === selectedPersonId) ||
      (selectedAccountId && node.accountId === selectedAccountId)
    ) {
      priorityNodeIds.push(node.id);
    }
  }

  if (personCount + accountCount !== nodes.length) {
    throw new Error("Friends Galaxy product source contains an unsupported semantic node kind.");
  }
  return {
    nodes,
    personCount,
    accountCount,
    linkedAccountCount,
    priorityNodeIds,
  };
}

export function compileFriendsGalaxyProductRendererScene({
  atlas,
  source,
  selectedPersonId,
  selectedAccountId,
  backgroundStarCount = FRIENDS_GALAXY_PRODUCT_BACKGROUND_STAR_COUNT,
  backgroundSeed,
  metadataNodeCap = FRIENDS_GALAXY_PRODUCT_METADATA_NODE_CAP,
  now,
}: CompileFriendsGalaxyProductSceneInput): FriendsGalaxyRendererScene {
  const product = productSource(source, selectedPersonId, selectedAccountId);
  const scene = compileIdentityGalaxyScene(
    { nodes: product.nodes, edges: source.edges },
    {
      quality: "settled",
      selectedPersonId,
      selectedAccountId,
      now,
    },
  );
  return compactFriendsGalaxyRendererSceneMetadata(
    createFriendsGalaxyRendererScene({
      atlas,
      scene,
      personCount: product.personCount,
      accountCount: product.accountCount,
      linkedAccountCount: product.linkedAccountCount,
      backgroundStarCount,
      backgroundSeed,
    }),
    metadataNodeCap,
    product.priorityNodeIds,
  );
}
