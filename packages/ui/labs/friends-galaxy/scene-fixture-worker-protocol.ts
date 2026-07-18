import type {
  GalaxyLabFixture,
  GalaxyLabFixtureOptions,
} from "./scene-fixture.js";

export const GALAXY_LAB_METADATA_NODE_CAP = 192;

export interface GalaxyLabFixtureWorkerRequest {
  kind: "build";
  requestId: number;
  options: GalaxyLabFixtureOptions;
}

export interface GalaxyLabFixtureWorkerReceipt {
  semanticNodeCount: number;
  metadataNodeCount: number;
  transferableBufferCount: number;
}

export interface GalaxyLabFixtureWorkerReadyResponse {
  kind: "ready";
  requestId: number;
  fixture: GalaxyLabFixture;
  receipt: GalaxyLabFixtureWorkerReceipt;
}

export interface GalaxyLabFixtureWorkerErrorResponse {
  kind: "error";
  requestId: number;
  message: string;
}

export type GalaxyLabFixtureWorkerResponse =
  GalaxyLabFixtureWorkerReadyResponse | GalaxyLabFixtureWorkerErrorResponse;

export function compactGalaxyLabFixtureMetadata(
  fixture: GalaxyLabFixture,
  cap = GALAXY_LAB_METADATA_NODE_CAP,
): GalaxyLabFixture {
  const safeCap = Math.max(0, Math.floor(cap));
  const requiredNodeIds = new Set(
    fixture.atlas.labels.map((label) => label.nodeId),
  );
  const nodes = [];
  const acceptedNodeIds = new Set<string>();

  for (const node of fixture.atlas.nodes) {
    if (!requiredNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }
  for (const node of fixture.atlas.nodes) {
    if (nodes.length >= safeCap) break;
    if (!node.personId || acceptedNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }

  return {
    ...fixture,
    atlas: {
      ...fixture.atlas,
      nodes,
      edges: [],
      hitBuckets: [],
      metrics: {
        ...fixture.atlas.metrics,
        visibleNodeCount: nodes.length,
        capped: fixture.scene.nodeIds.length > nodes.length,
      },
    },
  };
}

export function galaxyLabFixtureTransferables(
  fixture: GalaxyLabFixture,
): ArrayBuffer[] {
  const buffers = [
    fixture.scene.kinds.buffer,
    fixture.scene.colorRoles.buffer,
    fixture.scene.flags.buffer,
    fixture.scene.positions.buffer,
    fixture.scene.radii.buffer,
    fixture.scene.pointSizes.buffer,
    fixture.scene.prominence.buffer,
    fixture.scene.brightness.buffer,
    fixture.scene.emphasis.buffer,
    fixture.scene.edgeIndices.buffer,
    fixture.interactionIndex.nodeIndexSlots.buffer,
    fixture.interactionIndex.neighborOffsets.buffer,
    fixture.interactionIndex.neighborIndices.buffer,
    fixture.backgroundPositions.buffer,
    fixture.backgroundBrightness.buffer,
  ];
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return [...unique];
}

export function galaxyLabFixtureWorkerReceipt(
  fixture: GalaxyLabFixture,
  transferableBufferCount: number,
): GalaxyLabFixtureWorkerReceipt {
  return {
    semanticNodeCount: fixture.scene.nodeIds.length,
    metadataNodeCount: fixture.atlas.nodes.length,
    transferableBufferCount,
  };
}
