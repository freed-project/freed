import type {
  FriendsGalaxyNodePresentation,
  FriendsGalaxyNodePresentationResolver,
} from "./friends-galaxy-presentation.js";
import { FRIENDS_GALAXY_PRESENTATION_NODE_CAP } from "./friends-galaxy-presentation-atlas.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
} from "./identity-graph-atlas.js";

function initialsForLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]!).slice(0, 2).join("").toUpperCase();
  return `${Array.from(parts[0]!)[0] ?? ""}${Array.from(parts[1]!)[0] ?? ""}`
    .toUpperCase();
}

export class FriendsGalaxyProductPresentationIndex {
  private atlas: IdentityGraphAtlas | null = null;
  private readonly metadataByNodeId = new Map<string, IdentityGraphAtlasNode>();

  readonly resolve: FriendsGalaxyNodePresentationResolver = (
    scene,
    nodeIndex,
  ) => this.resolveNode(scene, nodeIndex);

  get nodeCount(): number {
    return this.metadataByNodeId.size;
  }

  replace(atlas: IdentityGraphAtlas): void {
    if (atlas === this.atlas) return;
    if (atlas.nodes.length > FRIENDS_GALAXY_PRESENTATION_NODE_CAP) {
      throw new Error("Friends Galaxy product presentation exceeds its metadata cap.");
    }
    const nodeIds = new Set<string>();
    for (const node of atlas.nodes) {
      if (nodeIds.has(node.id)) {
        throw new Error("Friends Galaxy product presentation contains duplicate metadata.");
      }
      nodeIds.add(node.id);
    }
    this.metadataByNodeId.clear();
    for (const node of atlas.nodes) this.metadataByNodeId.set(node.id, node);
    this.atlas = atlas;
  }

  node(nodeId: string): IdentityGraphAtlasNode | null {
    return this.metadataByNodeId.get(nodeId) ?? null;
  }

  avatarUrl(nodeId: string): string | null {
    return this.metadataByNodeId.get(nodeId)?.avatarUrl ?? null;
  }

  private resolveNode(
    scene: FriendsGalaxyRendererScene,
    nodeIndex: number,
  ): FriendsGalaxyNodePresentation {
    this.replace(scene.atlas);
    const nodeId = scene.scene.nodeIds[nodeIndex];
    if (!nodeId) {
      throw new Error("Friends Galaxy presentation requested an invalid scene node.");
    }
    const metadata = this.metadataByNodeId.get(nodeId);
    if (!metadata) {
      throw new Error(
        "Friends Galaxy product presentation requested metadata outside the admitted atlas.",
      );
    }
    return {
      label: metadata.label,
      initials: metadata.initials ?? initialsForLabel(metadata.label),
      priority: metadata.priority,
    };
  }
}
