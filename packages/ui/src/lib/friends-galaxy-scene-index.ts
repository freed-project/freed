import {
  IdentityGalaxyNodeFlag,
  type IdentityGalaxyScene,
} from "./identity-galaxy-scene.js";
import {
  findFriendsGalaxyPickCellIndex,
  findFriendsGalaxySceneNodeIndex,
  type FriendsGalaxySceneInteractionIndex,
} from "./friends-galaxy-scene-interaction-index.js";

export interface FriendsGalaxyInteraction {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
}

export type FriendsGalaxyInteractionRole = "selected" | "hovered" | "linked";

export interface FriendsGalaxyInteractionState {
  activeNodeId: string | null;
  contextualEdgeIndices: Uint32Array;
  contextualEdgeCount: number;
  roles: ReadonlyMap<number, FriendsGalaxyInteractionRole>;
}

export class FriendsGalaxySceneIndex {
  private readonly scene: IdentityGalaxyScene;
  private readonly interactionIndex: FriendsGalaxySceneInteractionIndex;
  private readonly interactionRoles = new Map<number, FriendsGalaxyInteractionRole>();
  private readonly interactionStateValue: FriendsGalaxyInteractionState;
  private lastPickCandidateCountValue = 0;

  constructor(
    scene: IdentityGalaxyScene,
    interactionIndex: FriendsGalaxySceneInteractionIndex,
  ) {
    this.scene = scene;
    this.interactionIndex = interactionIndex;
    this.interactionStateValue = {
      activeNodeId: null,
      contextualEdgeIndices: new Uint32Array(interactionIndex.maxNeighborCount * 2),
      contextualEdgeCount: 0,
      roles: this.interactionRoles,
    };
  }

  nodeIndex(nodeId: string | null): number | null {
    return findFriendsGalaxySceneNodeIndex(this.scene, this.interactionIndex, nodeId);
  }

  neighbors(nodeIndex: number): Uint32Array {
    const start = this.interactionIndex.neighborOffsets[nodeIndex] ?? 0;
    const end = this.interactionIndex.neighborOffsets[nodeIndex + 1] ?? start;
    return this.interactionIndex.neighborIndices.subarray(start, end);
  }

  get lastPickCandidateCount(): number {
    return this.lastPickCandidateCountValue;
  }

  get pickSourceNodeCount(): number {
    return this.scene.nodeIds.length;
  }

  get contextualEdgeCapacity(): number {
    return this.interactionStateValue.contextualEdgeIndices.length / 2;
  }

  interactionState(interaction: FriendsGalaxyInteraction): FriendsGalaxyInteractionState {
    const state = this.interactionStateValue;
    const roles = this.interactionRoles;
    roles.clear();
    state.activeNodeId = null;
    state.contextualEdgeCount = 0;
    const selectedIndex = this.nodeIndex(interaction.selectedNodeId);
    const hoveredIndex = this.nodeIndex(interaction.hoveredNodeId);
    if (selectedIndex !== null) roles.set(selectedIndex, "selected");
    if (hoveredIndex !== null && hoveredIndex !== selectedIndex) {
      roles.set(hoveredIndex, "hovered");
    }
    const activeIndex = hoveredIndex ?? selectedIndex;
    if (activeIndex === null) return state;
    const neighborStart = this.interactionIndex.neighborOffsets[activeIndex] ?? 0;
    const neighborEnd = this.interactionIndex.neighborOffsets[activeIndex + 1] ?? neighborStart;
    const edgeCount = neighborEnd - neighborStart;
    for (let index = 0; index < edgeCount; index += 1) {
      const neighbor = this.interactionIndex.neighborIndices[neighborStart + index]!;
      if (!roles.has(neighbor)) roles.set(neighbor, "linked");
      state.contextualEdgeIndices[index * 2] = activeIndex;
      state.contextualEdgeIndices[index * 2 + 1] = neighbor;
    }
    state.activeNodeId = this.scene.nodeIds[activeIndex] ?? null;
    state.contextualEdgeCount = edgeCount;
    return state;
  }

  applyFlags(
    target: Uint16Array,
    state: FriendsGalaxyInteractionState,
    previousIndices: Iterable<number>,
    touched: Set<number>,
  ): void {
    for (const index of previousIndices) target[index] = this.scene.flags[index]!;
    touched.clear();
    for (const [index, role] of state.roles) {
      let flags = this.scene.flags[index]!;
      if (role === "selected") flags |= IdentityGalaxyNodeFlag.Selected;
      if (role === "hovered") flags |= IdentityGalaxyNodeFlag.Hovered;
      if (role === "linked") flags |= IdentityGalaxyNodeFlag.LinkedToSelection;
      target[index] = flags;
      touched.add(index);
    }
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
    const positions = this.scene.positions;
    const spatial = this.interactionIndex;
    const xScale = elements[0]!;
    const yScale = elements[5]!;
    const cameraZ = elements[15]!;
    this.lastPickCandidateCountValue = 0;
    if (
      viewportX < 0 || viewportX > viewportWidth ||
      viewportY < 0 || viewportY > viewportHeight ||
      !Number.isFinite(xScale) || !Number.isFinite(yScale) || !Number.isFinite(cameraZ) ||
      Math.abs(xScale) < 0.000001 || Math.abs(yScale) < 0.000001
    ) return null;

    const cameraX = -elements[12]! / xScale;
    const cameraY = -elements[13]! / yScale;
    const ndcX = viewportX / Math.max(1, viewportWidth) * 2 - 1;
    const ndcY = 1 - viewportY / Math.max(1, viewportHeight) * 2;
    const minRayX = cameraX + ndcX * (cameraZ - spatial.pickMinZ) / xScale;
    const maxRayX = cameraX + ndcX * (cameraZ - spatial.pickMaxZ) / xScale;
    const minRayY = cameraY + ndcY * (cameraZ - spatial.pickMinZ) / yScale;
    const maxRayY = cameraY + ndcY * (cameraZ - spatial.pickMaxZ) / yScale;
    const furthestDepth = Math.max(1, cameraZ - spatial.pickMinZ, cameraZ - spatial.pickMaxZ);
    const paddingX = spatial.pickMaxScreenRadius * 2 * furthestDepth /
      (Math.abs(xScale) * Math.max(1, viewportWidth));
    const paddingY = spatial.pickMaxScreenRadius * 2 * furthestDepth /
      (Math.abs(yScale) * Math.max(1, viewportHeight));
    const minColumn = Math.floor(
      (Math.min(minRayX, maxRayX) - paddingX) / spatial.pickCellSize,
    );
    const maxColumn = Math.floor(
      (Math.max(minRayX, maxRayX) + paddingX) / spatial.pickCellSize,
    );
    const minRow = Math.floor(
      (Math.min(minRayY, maxRayY) - paddingY) / spatial.pickCellSize,
    );
    const maxRow = Math.floor(
      (Math.max(minRayY, maxRayY) + paddingY) / spatial.pickCellSize,
    );

    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cellIndex = findFriendsGalaxyPickCellIndex(spatial, column, row);
        if (cellIndex === null) continue;
        const start = spatial.pickCellOffsets[cellIndex]!;
        const end = spatial.pickCellOffsets[cellIndex + 1]!;
        for (let candidateOffset = start; candidateOffset < end; candidateOffset += 1) {
          const index = spatial.pickNodeIndices[candidateOffset]!;
          this.lastPickCandidateCountValue += 1;
          const offset = index * 3;
          const x = positions[offset]!;
          const y = positions[offset + 1]!;
          const z = positions[offset + 2]!;
          const clipX = elements[0]! * x + elements[4]! * y +
            elements[8]! * z + elements[12]!;
          const clipY = elements[1]! * x + elements[5]! * y +
            elements[9]! * z + elements[13]!;
          const clipZ = elements[2]! * x + elements[6]! * y +
            elements[10]! * z + elements[14]!;
          const clipW = elements[3]! * x + elements[7]! * y +
            elements[11]! * z + elements[15]!;
          const minimumClipZ = depthRange === "zero-to-one" ? 0 : -clipW;
          if (clipW <= 0 || clipZ < minimumClipZ || clipZ > clipW) continue;
          const screenX = (clipX / clipW + 1) * viewportWidth * 0.5;
          const screenY = (1 - clipY / clipW) * viewportHeight * 0.5;
          const dx = screenX - viewportX;
          const dy = screenY - viewportY;
          const radius = Math.max(9, this.scene.pointSizes[index]! * 0.24);
          const normalizedDistance = (dx * dx + dy * dy) / (radius * radius);
          if (normalizedDistance > 1) continue;
          const score = normalizedDistance - this.scene.prominence[index]! * 0.26;
          if (score < bestScore || (score === bestScore && index < bestIndex)) {
            bestIndex = index;
            bestScore = score;
          }
        }
      }
    }
    return bestIndex < 0 ? null : this.scene.nodeIds[bestIndex] ?? null;
  }
}
