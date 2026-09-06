import { describe, expect, it } from "vitest";
import { FriendsGalaxyProductPresentationIndex } from "../../src/lib/friends-galaxy-product-presentation.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  type FriendsGalaxyProductWorkerPresentationRequest,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import { buildFriendsGalaxyProductServiceSource } from "./product-sqlite-source-fixture.js";

function buildSource(service: FriendsGalaxyProductWorkerService) {
  return buildFriendsGalaxyProductServiceSource(service, {
    accountCount: 500,
    backgroundSeed: "product-presentation",
    personCount: 120,
    viewport: {
      width: 390,
      height: 844,
      selectedAccountId: "product-account-2",
    },
  });
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
  it("admits a distant hovered identity without displacing selection or exceeding metadata budgets", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const source = buildSource(service);
    const initial = service.handle(presentationRequest());
    if (initial.kind !== "presentation-ready") throw new Error("Expected presentation.");
    const admitted = new Set(initial.atlas.nodes.map(node => node.id));
    const hoveredNodeId = source.rendererScene.scene.nodeIds.find(id => !admitted.has(id));
    expect(hoveredNodeId).toBeDefined();
    const request = presentationRequest();
    request.viewport.hoveredNodeId = hoveredNodeId;
    const hovered = service.handle(request);
    if (hovered.kind !== "presentation-ready") throw new Error(JSON.stringify(hovered));
    expect(hovered.atlas.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      hoveredNodeId, "account:product-account-2", "person:product-person-2",
    ]));
    expect(hovered.atlas.nodes.length).toBeLessThanOrEqual(192);
    expect(hovered.atlas.labels.length).toBeLessThanOrEqual(120);
    expect(hovered.atlas.labels[0]).toMatchObject({
      id: `label:${hoveredNodeId}`, nodeId: hoveredNodeId, priority: 2_000_000,
    });
    expect(hovered.atlas.labels[0].text.length).toBeGreaterThan(0);

    request.viewport.hoveredNodeId = null;
    const cleared = service.handle(request);
    if (cleared.kind !== "presentation-ready") throw new Error("Expected presentation.");
    expect(cleared.atlas.nodes).toEqual(initial.atlas.nodes);
    expect(cleared.atlas.labels).toEqual(initial.atlas.labels);
    request.viewport.hoveredNodeId = "person:nonexistent";
    const unknown = service.handle(request);
    if (unknown.kind !== "presentation-ready") throw new Error("Expected presentation.");
    expect(unknown.atlas.nodes).toEqual(initial.atlas.nodes);
    expect(unknown.atlas.labels).toEqual(initial.atlas.labels);
  });

  it("retains a selected linked channel and its parent identity", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const source = buildSource(service);
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
    const source = buildSource(service);
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
    const source = buildSource(service);
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
