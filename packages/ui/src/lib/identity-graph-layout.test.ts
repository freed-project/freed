import { describe, expect, it } from "vitest";
import type { IdentityGraphModel, IdentityGraphNode } from "./identity-graph-model.js";
import { buildIdentityGraphLayout } from "./identity-graph-layout.js";

function personNode(index: number): IdentityGraphNode {
  return {
    id: `person:test-${index}`,
    kind: index % 4 === 0 ? "connection_person" : "friend_person",
    label: `Test Person ${index}`,
    radius: 42,
    labelPriority: 80,
    personId: `test-${index}`,
    ring: index % 4 === 0 ? 1 : 0,
    weight: 100 - (index % 10),
    initials: "TP",
    interactive: true,
  };
}

function modelWithPeople(count: number): IdentityGraphModel {
  return {
    nodes: Array.from({ length: count }, (_, index) => personNode(index)),
    edges: [],
    signature: `test:${count.toLocaleString()}`,
    buildMs: 0,
  };
}

describe("buildIdentityGraphLayout", () => {
  it("uses a deterministic fast path for dense person fields", () => {
    const model = modelWithPeople(1_600);

    const startedAt = performance.now();
    const first = buildIdentityGraphLayout({
      model,
      width: 1_200,
      height: 760,
      quality: "fast",
    });
    const elapsed = performance.now() - startedAt;
    const second = buildIdentityGraphLayout({
      model,
      width: 1_200,
      height: 760,
      quality: "fast",
    });

    expect(first.nodes).toHaveLength(1_600);
    expect(elapsed).toBeLessThan(120);
    expect(first.nodes.map((node) => [node.id, Math.round(node.x), Math.round(node.y)])).toEqual(
      second.nodes.map((node) => [node.id, Math.round(node.x), Math.round(node.y)]),
    );
  });
});
