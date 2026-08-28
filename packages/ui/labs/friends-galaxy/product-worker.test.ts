import { describe, expect, it } from "vitest";
import { FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP } from "../../src/lib/friends-galaxy-activity-patches.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  friendsGalaxyProductWorkerResponseTransferables,
  validateFriendsGalaxyProductWorkerResponse,
  type FriendsGalaxyProductWorkerActivityRequest,
  type FriendsGalaxyProductWorkerPresentationRequest,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import {
  FriendsGalaxyProductWorkerService,
} from "../../src/lib/friends-galaxy-product-worker-service.js";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../src/lib/friends-galaxy-camera.js";
import { selectFriendsGalaxyLabels } from "../../src/lib/friends-galaxy-presentation.js";
import { socialActivitySummaryKey } from "../../src/lib/identity-graph-activity-summary.js";
import { buildFriendsGalaxyProductServiceSource } from "./product-sqlite-source-fixture.js";

function buildSource(
  service: FriendsGalaxyProductWorkerService,
  sourceRevision = 1,
) {
  return buildFriendsGalaxyProductServiceSource(service, {
    accountCount: 500,
    backgroundSeed: "product-worker",
    backgroundStarCount: 2_000,
    personCount: 120,
    sourceRevision,
    viewport: {
      width: 390,
      height: 844,
      selectedAccountId: "product-account-499",
    },
  });
}

function presentationRequest(
  sourceRevision = 1,
): FriendsGalaxyProductWorkerPresentationRequest {
  return {
    kind: "presentation",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: 2,
    sourceRevision,
    presentationRevision: 7,
    viewport: {
      width: 390,
      height: 844,
      transform: { x: 195, y: 422, scale: 0.22 },
      selectedAccountId: "product-account-499",
    },
  };
}

function activityRequest(
  sourceRevision = 1,
): FriendsGalaxyProductWorkerActivityRequest {
  return {
    kind: "activity",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: 3,
    sourceRevision,
    activityRevision: 11,
    referenceTime: 1_800_000_000_000,
    patches: [{
      namespace: "social",
      key: socialActivitySummaryKey("linkedin", "product-author-2"),
      summary: {
        itemCount: 17,
        latestActivityAt: 1_799_999_000_000,
        sampleItemIds: ["not-transferred"],
        hasLocation: true,
        avatarUrlCandidates: ["https://example.com/avatar.jpg"],
      },
    }],
  };
}

describe("Friends Galaxy product worker", () => {
  it("builds one resident source scene and transfers its exact GPU envelope", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const response = buildSource(service);

    expect(response.rendererScene.scene.nodeIds).toHaveLength(620);
    expect(response.rendererScene.scene.nodeIds.some(
      (nodeId) => nodeId.startsWith("provider:"),
    )).toBe(false);
    expect(response.rendererScene.presentationCandidateSource).toBe("atlas");
    expect(response.rendererScene.atlas.nodes[0]?.accountId).toBe("product-account-499");
    expect(friendsGalaxyProductWorkerResponseTransferables(response)).toHaveLength(21);
  });

  it("returns settled presentation with no semantic scene transfer", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const sourceResponse = buildSource(service);
    const request = presentationRequest();
    const response = service.handle(request);
    validateFriendsGalaxyProductWorkerResponse(
      response,
      request,
      sourceResponse.rendererScene,
    );
    if (response.kind !== "presentation-ready") {
      throw new Error("Expected a presentation response.");
    }

    expect(response.atlas.nodes.length).toBeLessThanOrEqual(192);
    expect(response.atlas.labels.length).toBeLessThanOrEqual(120);
    expect(response.atlas.edges).toEqual([]);
    expect(response.atlas.hitBuckets).toEqual([]);
    expect(response.atlas.nodes[0]?.accountId).toBe("product-account-499");
    expect(friendsGalaxyProductWorkerResponseTransferables(response)).toEqual([]);
  });

  it("keeps product label resolution inside worker-admitted metadata", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const sourceResponse = buildSource(service);
    const targetNodeId = "account:product-account-498";
    const targetNodeIndex = sourceResponse.rendererScene.scene.nodeIds.indexOf(targetNodeId);
    if (targetNodeIndex < 0) throw new Error("Expected an unlinked account in the resident scene.");
    const scale = 1.2;
    const request = presentationRequest();
    request.viewport.transform = {
      x: request.viewport.width / 2 -
        sourceResponse.rendererScene.scene.positions[targetNodeIndex * 3]! * scale,
      y: request.viewport.height / 2 +
        sourceResponse.rendererScene.scene.positions[targetNodeIndex * 3 + 1]! * scale,
      scale,
    };
    const response = service.handle(request);
    if (response.kind !== "presentation-ready") {
      throw new Error("Expected a presentation response.");
    }
    const scene = {
      ...sourceResponse.rendererScene,
      atlas: response.atlas,
    };
    const metadataByNodeId = new Map(
      response.atlas.nodes.map((node) => [node.id, node]),
    );
    const resolvedNodeIds: string[] = [];
    const matrix = new Float32Array(16);
    writeFriendsGalaxyWebGpuViewProjection(
      matrix,
      request.viewport.transform,
      request.viewport.width,
      request.viewport.height,
    );
    const labels = selectFriendsGalaxyLabels(
      scene,
      (_rendererScene, nodeIndex) => {
        const nodeId = scene.scene.nodeIds[nodeIndex]!;
        const metadata = metadataByNodeId.get(nodeId);
        if (!metadata) {
          throw new Error("Product label resolution escaped worker metadata.");
        }
        resolvedNodeIds.push(nodeId);
        return {
          label: metadata.label,
          initials: metadata.initials ?? "?",
          priority: metadata.priority,
        };
      },
      false,
      "close",
      null,
      {
        viewProjection: matrix,
        width: request.viewport.width,
        height: request.viewport.height,
      },
    );

    expect(resolvedNodeIds.length).toBeGreaterThan(0);
    expect(labels.every(
      (label) => label.provider || metadataByNodeId.has(label.nodeId),
    )).toBe(true);
    expect(labels.some(
      (label) => label.nodeId.startsWith("account:") &&
        label.nodeId !== "account:product-account-499",
    )).toBe(true);
  });

  it("encodes sparse activity changes against the resident source scene", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const sourceResponse = buildSource(service);
    const request = activityRequest();
    const response = service.handle(request);
    validateFriendsGalaxyProductWorkerResponse(
      response,
      request,
      sourceResponse.rendererScene,
    );
    if (response.kind !== "activity-ready") {
      throw new Error("Expected an activity response.");
    }

    const accountNodeIndex = sourceResponse.rendererScene.scene.nodeIds.indexOf(
      "account:product-account-2",
    );
    expect(Array.from(response.scenePatches.nodeIndices)).toEqual([accountNodeIndex]);
    expect(Array.from(response.scenePatches.itemCounts)).toEqual([17]);
    expect(response.scenePatches.avatarUrls).toEqual([
      "https://example.com/avatar.jpg",
    ]);
    expect(response.scenePatches.unknownSources).toEqual([]);
    expect(response.scenePatches).not.toHaveProperty("sampleItemIds");
    expect(friendsGalaxyProductWorkerResponseTransferables(response)).toHaveLength(6);
  });

  it("reports unknown activity sources without rebuilding the scene", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const sourceResponse = buildSource(service);
    const request = activityRequest();
    request.patches = [{
      namespace: "rss",
      key: "https://example.com/new-feed.xml",
      summary: null,
    }];
    const response = service.handle(request);
    if (response.kind !== "activity-ready") {
      throw new Error("Expected an activity response.");
    }

    expect(response.scenePatches.nodeIndices).toHaveLength(0);
    expect(response.scenePatches.unknownSources).toEqual([{
      namespace: "rss",
      key: "https://example.com/new-feed.xml",
    }]);
    expect(sourceResponse.rendererScene.scene.nodeIds).toHaveLength(620);
  });

  it("rejects activity batches that exceed the sparse source cap", () => {
    const service = new FriendsGalaxyProductWorkerService();
    buildSource(service);
    const request = activityRequest();
    request.patches = Array.from(
      { length: FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP + 1 },
      (_, index) => ({
        namespace: "social" as const,
        key: `x:overflow-${index.toLocaleString()}`,
        summary: null,
      }),
    );

    const response = service.handle(request);
    expect(response.kind).toBe("error");
    if (response.kind !== "error") throw new Error("Expected an error response.");
    expect(response.requestKind).toBe("activity");
    expect(response.message).toContain("invalid patches");
  });

  it("contains missing and stale source revisions without rebuilding on the caller", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const missingRequest = presentationRequest();
    const missingResponse = service.handle(missingRequest);
    validateFriendsGalaxyProductWorkerResponse(missingResponse, missingRequest);
    expect(missingResponse.kind).toBe("error");
    if (missingResponse.kind !== "error") throw new Error("Expected an error response.");
    expect(missingResponse.requestKind).toBe("presentation");
    expect(Array.from(missingResponse.message).length).toBeLessThanOrEqual(240);

    expect(buildSource(service, 4).kind).toBe("source-ready");
    const staleRequest = presentationRequest(3);
    const staleResponse = service.handle(staleRequest);
    validateFriendsGalaxyProductWorkerResponse(staleResponse, staleRequest);
    expect(staleResponse.kind).toBe("error");

    const staleActivityRequest = activityRequest(3);
    const staleActivityResponse = service.handle(staleActivityRequest);
    validateFriendsGalaxyProductWorkerResponse(
      staleActivityResponse,
      staleActivityRequest,
    );
    expect(staleActivityResponse.kind).toBe("error");
  });

  it("uses stable virtual layout dimensions instead of source viewport dimensions", () => {
    const narrowResponse = buildFriendsGalaxyProductServiceSource(
      new FriendsGalaxyProductWorkerService(),
      { accountCount: 500, personCount: 120, viewport: { width: 10, height: 10 } },
    );
    const wideResponse = buildFriendsGalaxyProductServiceSource(
      new FriendsGalaxyProductWorkerService(),
      { accountCount: 500, personCount: 120, viewport: { width: 10_000, height: 8_000 } },
    );
    expect(Array.from(narrowResponse.rendererScene.scene.positions)).toEqual(
      Array.from(wideResponse.rendererScene.scene.positions),
    );
  });

  it("rejects an error response attributed to the wrong worker lane", () => {
    const request = presentationRequest();
    const response = new FriendsGalaxyProductWorkerService().handle(request);
    if (response.kind !== "error") throw new Error("Expected an error response.");

    expect(() => validateFriendsGalaxyProductWorkerResponse(
      { ...response, requestKind: "activity" },
      request,
    )).toThrow("Friends Galaxy worker error does not match its request lane.");
  });
});
