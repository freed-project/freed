import { describe, expect, it } from "vitest";
import {
  validateFriendsGalaxyPresentationAtlas,
} from "../../src/lib/friends-galaxy-presentation-atlas.js";
import { compactGalaxyLabFixtureMetadata } from "./scene-fixture-worker-protocol.js";
import { createGalaxyLabFixture } from "./scene-fixture.js";

function admittedFixture() {
  return compactGalaxyLabFixtureMetadata(createGalaxyLabFixture({
    personCount: 80,
    accountCount: 240,
    backgroundStarCount: 0,
  }));
}

describe("Friends Galaxy settled presentation atlas", () => {
  it("admits bounded metadata against the resident semantic scene", () => {
    const fixture = admittedFixture();
    expect(() => validateFriendsGalaxyPresentationAtlas(
      fixture.atlas,
      fixture.scene,
      fixture.interactionIndex,
    )).not.toThrow();
  });

  it("rejects rich graph edges and hit buckets", () => {
    const fixture = admittedFixture();
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        edges: [{ id: "edge", sourceId: "person:0", targetId: "person:1" }],
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("edges exceeds its bounded contract");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        hitBuckets: [{ key: "0:0", nodeIds: ["person:0"] }],
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("hit buckets exceeds its bounded contract");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        nodes: new Array(193).fill(fixture.atlas.nodes[0]!),
        metrics: {
          ...fixture.atlas.metrics,
          visibleNodeCount: 193,
        },
      },
      fixture.scene,
      fixture.interactionIndex,
      { nodeCap: Number.MAX_SAFE_INTEGER },
    )).toThrow("nodes exceeds its bounded contract");
  });

  it("rejects foreign nodes, oversized text, and duplicate labels", () => {
    const fixture = admittedFixture();
    const semanticNode = fixture.atlas.nodes.find(
      (node) => node.kind !== "provider_cluster",
    )!;
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        nodes: [{ ...fixture.atlas.nodes[0]!, id: "foreign:node" }],
        metrics: { ...fixture.atlas.metrics, visibleNodeCount: 1 },
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("outside the resident scene");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        labels: [{ ...fixture.atlas.labels[0]!, text: "x".repeat(161) }],
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("label text is invalid");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        labels: [fixture.atlas.labels[0]!, fixture.atlas.labels[0]!],
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("duplicate label");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        nodes: [{ ...semanticNode, kind: "provider_cluster" }],
        metrics: { ...fixture.atlas.metrics, visibleNodeCount: 1 },
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("node kind does not match");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        nodes: [{ ...semanticNode, personId: "wrong-person" }],
        metrics: { ...fixture.atlas.metrics, visibleNodeCount: 1 },
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("node identity does not match");
    expect(() => validateFriendsGalaxyPresentationAtlas(
      {
        ...fixture.atlas,
        regions: fixture.atlas.regions.map((region, index) => index === 0
          ? { ...region, count: region.count + 1 }
          : region),
      },
      fixture.scene,
      fixture.interactionIndex,
    )).toThrow("region counts do not balance");
  });
});
