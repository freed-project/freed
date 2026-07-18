import { IdentityGalaxyNodeFlag } from "../../src/lib/identity-galaxy-scene.js";
import type { GalaxyLabInteraction } from "./backend.js";
import type { GalaxyLabFixture } from "./scene-fixture.js";
import { findGalaxyLabSceneNodeIndex } from "./scene-interaction-index.js";

export type GalaxyLabInteractionRole = "selected" | "hovered" | "linked";

export interface GalaxyLabInteractionState {
  activeNodeId: string | null;
  contextualEdgeIndices: Uint32Array;
  roles: ReadonlyMap<number, GalaxyLabInteractionRole>;
}

export class GalaxyLabSceneIndex {
  private readonly fixture: GalaxyLabFixture;
  private readonly neighborOffsets: Uint32Array;
  private readonly neighborIndices: Uint32Array;

  constructor(fixture: GalaxyLabFixture) {
    this.fixture = fixture;
    this.neighborOffsets = fixture.interactionIndex.neighborOffsets;
    this.neighborIndices = fixture.interactionIndex.neighborIndices;
  }

  nodeIndex(nodeId: string | null): number | null {
    return findGalaxyLabSceneNodeIndex(
      this.fixture.scene,
      this.fixture.interactionIndex,
      nodeId,
    );
  }

  neighbors(nodeIndex: number): Uint32Array {
    const start = this.neighborOffsets[nodeIndex] ?? 0;
    const end = this.neighborOffsets[nodeIndex + 1] ?? start;
    return this.neighborIndices.subarray(start, end);
  }

  interactionState(interaction: GalaxyLabInteraction): GalaxyLabInteractionState {
    const roles = new Map<number, GalaxyLabInteractionRole>();
    const selectedIndex = this.nodeIndex(interaction.selectedNodeId);
    const hoveredIndex = this.nodeIndex(interaction.hoveredNodeId);
    if (selectedIndex !== null) roles.set(selectedIndex, "selected");
    if (hoveredIndex !== null && hoveredIndex !== selectedIndex) roles.set(hoveredIndex, "hovered");
    const activeIndex = hoveredIndex ?? selectedIndex;
    if (activeIndex === null) {
      return { activeNodeId: null, contextualEdgeIndices: new Uint32Array(0), roles };
    }
    const neighbors = this.neighbors(activeIndex);
    const edgeIndices = new Uint32Array(neighbors.length * 2);
    for (let index = 0; index < neighbors.length; index += 1) {
      const neighbor = neighbors[index]!;
      if (!roles.has(neighbor)) roles.set(neighbor, "linked");
      edgeIndices[index * 2] = activeIndex;
      edgeIndices[index * 2 + 1] = neighbor;
    }
    return {
      activeNodeId: this.fixture.scene.nodeIds[activeIndex] ?? null,
      contextualEdgeIndices: edgeIndices,
      roles,
    };
  }

  applyFlags(target: Uint16Array, state: GalaxyLabInteractionState, previousIndices: Iterable<number>): Set<number> {
    for (const index of previousIndices) target[index] = this.fixture.scene.flags[index]!;
    const touched = new Set<number>();
    for (const [index, role] of state.roles) {
      let flags = this.fixture.scene.flags[index]!;
      if (role === "selected") flags |= IdentityGalaxyNodeFlag.Selected;
      if (role === "hovered") flags |= IdentityGalaxyNodeFlag.Hovered;
      if (role === "linked") flags |= IdentityGalaxyNodeFlag.LinkedToSelection;
      target[index] = flags;
      touched.add(index);
    }
    return touched;
  }

  pickNode(
    viewProjection: ArrayLike<number>,
    viewportWidth: number,
    viewportHeight: number,
    viewportX: number,
    viewportY: number,
    depthRange: "negative-one-to-one" | "zero-to-one" = "negative-one-to-one",
  ): string | null {
    const elements = viewProjection;
    const positions = this.fixture.scene.positions;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.fixture.scene.nodeIds.length; index += 1) {
      const offset = index * 3;
      const x = positions[offset]!;
      const y = positions[offset + 1]!;
      const z = positions[offset + 2]!;
      const clipX = elements[0]! * x + elements[4]! * y + elements[8]! * z + elements[12]!;
      const clipY = elements[1]! * x + elements[5]! * y + elements[9]! * z + elements[13]!;
      const clipZ = elements[2]! * x + elements[6]! * y + elements[10]! * z + elements[14]!;
      const clipW = elements[3]! * x + elements[7]! * y + elements[11]! * z + elements[15]!;
      const minimumClipZ = depthRange === "zero-to-one" ? 0 : -clipW;
      if (clipW <= 0 || clipZ < minimumClipZ || clipZ > clipW) continue;
      const screenX = (clipX / clipW + 1) * viewportWidth * 0.5;
      const screenY = (1 - clipY / clipW) * viewportHeight * 0.5;
      const dx = screenX - viewportX;
      const dy = screenY - viewportY;
      const radius = Math.max(9, this.fixture.scene.pointSizes[index]! * 0.24);
      const normalizedDistance = (dx * dx + dy * dy) / (radius * radius);
      if (normalizedDistance > 1) continue;
      const score = normalizedDistance - this.fixture.scene.prominence[index]! * 0.26;
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    return bestIndex < 0 ? null : this.fixture.scene.nodeIds[bestIndex] ?? null;
  }
}
