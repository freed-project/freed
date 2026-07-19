import type {
  GalaxyLabFixture,
  GalaxyLabFixtureOptions,
} from "./scene-fixture.js";
import {
  friendsGalaxyRendererSceneTransferables,
  friendsGalaxyWorkerSceneReceipt,
  validateFriendsGalaxyWorkerScene,
  type FriendsGalaxyWorkerSceneReceipt,
} from "../../src/lib/friends-galaxy-worker-scene.js";

export const GALAXY_LAB_METADATA_NODE_CAP = 192;

export interface GalaxyLabFixtureWorkerRequest {
  kind: "build";
  requestId: number;
  options: GalaxyLabFixtureOptions;
}

export interface GalaxyLabFixtureWorkerReceipt extends FriendsGalaxyWorkerSceneReceipt {
  activitySummaryCount: number;
  representedActivityItemCount: number;
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

export function validateGalaxyLabFixtureEnvelope(
  fixture: GalaxyLabFixture,
  receipt: GalaxyLabFixtureWorkerReceipt,
): void {
  validateFriendsGalaxyWorkerScene(fixture, receipt, {
    metadataNodeCap: GALAXY_LAB_METADATA_NODE_CAP,
  });
  for (const [label, value] of [
    ["activity summary count", fixture.activitySummaryCount],
    ["represented activity item count", fixture.representedActivityItemCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Friends Galaxy worker returned an invalid ${label}.`);
    }
  }
  if (fixture.activitySummaryCount > fixture.accountCount) {
    throw new Error(
      "Friends Galaxy worker returned too many activity summaries.",
    );
  }
  if (fixture.representedActivityItemCount < fixture.activitySummaryCount) {
    throw new Error(
      "Friends Galaxy worker returned fewer represented items than activity summaries.",
    );
  }
  if (!Number.isFinite(fixture.buildMs) || fixture.buildMs < 0) {
    throw new Error(
      "Friends Galaxy worker returned an invalid fixture build duration.",
    );
  }
  if (
    receipt.activitySummaryCount !== fixture.activitySummaryCount ||
    receipt.representedActivityItemCount !==
      fixture.representedActivityItemCount
  ) {
    throw new Error(
      "Friends Galaxy worker receipt does not match its transferred fixture.",
    );
  }
}

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
  return friendsGalaxyRendererSceneTransferables(fixture);
}

export function galaxyLabFixtureWorkerReceipt(
  fixture: GalaxyLabFixture,
  transferableBufferCount: number,
): GalaxyLabFixtureWorkerReceipt {
  return {
    ...friendsGalaxyWorkerSceneReceipt(fixture, transferableBufferCount),
    activitySummaryCount: fixture.activitySummaryCount,
    representedActivityItemCount: fixture.representedActivityItemCount,
  };
}
