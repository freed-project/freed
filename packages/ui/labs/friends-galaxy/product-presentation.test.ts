import { describe, expect, it } from "vitest";
import { FriendsGalaxyProductPresentationIndex } from "../../src/lib/friends-galaxy-product-presentation.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  type FriendsGalaxyProductWorkerPresentationRequest,
  type FriendsGalaxyProductWorkerSourceRequest,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

function sourceRequest(): FriendsGalaxyProductWorkerSourceRequest {
  return {
    kind: "source",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    sourceRevision: 1,
    source: createFriendsGalaxyProductSource(120, 500),
    viewport: {
      width: 390,
      height: 844,
      selectedAccountId: "product-account-2",
    },
    backgroundStarCount: 1_000,
    backgroundSeed: "product-presentation",
  };
}

function presentationRequest(): FriendsGalaxyProductWorkerPresentationRequest {
  return {
    kind: "presentation",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: 2,
    sourceRevision: 1,
    presentationRevision: 1,
    viewport: {
      width: 390,
      height: 844,
      transform: { x: 195, y: 422, scale: 0.58 },
      selectedAccountId: "product-account-2",
    },
  };
}

describe("Friends Galaxy product presentation", () => {
  it("retains a selected linked channel and its parent identity", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const source = service.handle(sourceRequest());
    if (source.kind !== "source-ready") throw new Error("Expected a source response.");
    expect(source.rendererScene.atlas.nodes.slice(0, 2).map((node) => node.id)).toEqual([
      "account:product-account-2",
      "person:product-person-2",
    ]);

    const presentation = service.handle(presentationRequest());
    if (presentation.kind !== "presentation-ready") {
      throw new Error("Expected a presentation response.");
    }
    expect(presentation.atlas.nodes.slice(0, 2).map((node) => node.id)).toEqual([
      "account:product-account-2",
      "person:product-person-2",
    ]);
  });

  it("resolves real bounded metadata through one stable resolver", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const source = service.handle(sourceRequest());
    if (source.kind !== "source-ready") throw new Error("Expected a source response.");
    const presentation = service.handle(presentationRequest());
    if (presentation.kind !== "presentation-ready") {
      throw new Error("Expected a presentation response.");
    }
    const scene = { ...source.rendererScene, atlas: presentation.atlas };
    const index = new FriendsGalaxyProductPresentationIndex();
    const personNodeIndex = findFriendsGalaxySceneNodeIndex(
      scene.scene,
      scene.interactionIndex,
      "person:product-person-2",
    );
    if (personNodeIndex === null) throw new Error("Expected a resident person node.");

    expect(index.resolve(scene, personNodeIndex)).toEqual({
      label: "Product Person 2",
      initials: "PP",
      priority: expect.any(Number),
    });
    expect(index.nodeCount).toBe(presentation.atlas.nodes.length);
    expect(index.node("person:product-person-2")?.personId).toBe("product-person-2");
    expect(index.avatarUrl("person:product-person-2")).toBeNull();
  });

  it("fails if product rendering requests identity copy outside admitted metadata", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const source = service.handle(sourceRequest());
    if (source.kind !== "source-ready") throw new Error("Expected a source response.");
    const admittedNodeIds = new Set(source.rendererScene.atlas.nodes.map((node) => node.id));
    const missingNodeIndex = source.rendererScene.scene.nodeIds.findIndex(
      (nodeId) => !admittedNodeIds.has(nodeId),
    );
    expect(missingNodeIndex).toBeGreaterThanOrEqual(0);
    const index = new FriendsGalaxyProductPresentationIndex();

    expect(() => index.resolve(source.rendererScene, missingNodeIndex)).toThrow(
      "Friends Galaxy product presentation requested metadata outside the admitted atlas.",
    );
  });
});
