import type { IdentityGalaxyScene } from "./identity-galaxy-scene.js";

const EMPTY_NODE_INDEX_SLOT = 0;
const EMPTY_PICK_CELL_SLOT = 0;
export const FRIENDS_GALAXY_PICK_CELL_SIZE = 192;

export interface FriendsGalaxySceneInteractionIndex {
  nodeIndexSlots: Uint32Array;
  neighborOffsets: Uint32Array;
  neighborIndices: Uint32Array;
  maxNeighborCount: number;
  pickCellSlots: Uint32Array;
  pickCellCoordinates: Int32Array;
  pickCellOffsets: Uint32Array;
  pickNodeIndices: Uint32Array;
  pickCellSize: number;
  pickMinZ: number;
  pickMaxZ: number;
  pickMaxScreenRadius: number;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function friendsGalaxyNodeIdHash(nodeId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function friendsGalaxyPickCellHash(column: number, row: number): number {
  let hash = Math.imul(column, 0x9e3779b1) ^ Math.imul(row, 0x85ebca77);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function createFriendsGalaxySceneInteractionIndex(
  scene: IdentityGalaxyScene,
): FriendsGalaxySceneInteractionIndex {
  const nodeCount = scene.nodeIds.length;
  const slotCount = nextPowerOfTwo(Math.max(2, nodeCount * 2));
  const nodeIndexSlots = new Uint32Array(slotCount);
  const slotMask = slotCount - 1;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    let slot = friendsGalaxyNodeIdHash(scene.nodeIds[nodeIndex]!) & slotMask;
    while (nodeIndexSlots[slot] !== EMPTY_NODE_INDEX_SLOT) {
      slot = (slot + 1) & slotMask;
    }
    nodeIndexSlots[slot] = nodeIndex + 1;
  }

  const neighborOffsets = new Uint32Array(nodeCount + 1);
  for (let offset = 0; offset < scene.edgeIndices.length; offset += 2) {
    const source = scene.edgeIndices[offset]!;
    const target = scene.edgeIndices[offset + 1]!;
    neighborOffsets[source + 1] += 1;
    neighborOffsets[target + 1] += 1;
  }
  let maxNeighborCount = 0;
  for (let index = 1; index < neighborOffsets.length; index += 1) {
    maxNeighborCount = Math.max(maxNeighborCount, neighborOffsets[index]!);
  }
  for (let index = 1; index < neighborOffsets.length; index += 1) {
    neighborOffsets[index] += neighborOffsets[index - 1]!;
  }

  const neighborIndices = new Uint32Array(scene.edgeIndices.length);
  const writeOffsets = neighborOffsets.slice(0, nodeCount);
  for (let offset = 0; offset < scene.edgeIndices.length; offset += 2) {
    const source = scene.edgeIndices[offset]!;
    const target = scene.edgeIndices[offset + 1]!;
    neighborIndices[writeOffsets[source]!] = target;
    writeOffsets[source] += 1;
    neighborIndices[writeOffsets[target]!] = source;
    writeOffsets[target] += 1;
  }

  if (nodeCount === 0) {
    return {
      nodeIndexSlots,
      neighborOffsets,
      neighborIndices,
      maxNeighborCount,
      pickCellSlots: new Uint32Array(2),
      pickCellCoordinates: new Int32Array(0),
      pickCellOffsets: new Uint32Array(1),
      pickNodeIndices: new Uint32Array(0),
      pickCellSize: FRIENDS_GALAXY_PICK_CELL_SIZE,
      pickMinZ: 0,
      pickMaxZ: 0,
      pickMaxScreenRadius: 9,
    };
  }

  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let maxScreenRadius = 9;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * 3;
    const z = scene.positions[offset + 2]!;
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    maxScreenRadius = Math.max(maxScreenRadius, scene.pointSizes[nodeIndex]! * 0.24);
  }
  const pickCellSize = FRIENDS_GALAXY_PICK_CELL_SIZE;
  const pickCellSlots = new Uint32Array(nextPowerOfTwo(Math.max(2, nodeCount * 2)));
  const pickSlotMask = pickCellSlots.length - 1;
  const coordinateScratch = new Int32Array(nodeCount * 2);
  const countScratch = new Uint32Array(nodeCount);
  let pickCellCount = 0;
  const findOrCreatePickCell = (column: number, row: number): number => {
    let slot = friendsGalaxyPickCellHash(column, row) & pickSlotMask;
    while (true) {
      const storedIndex = pickCellSlots[slot]!;
      if (storedIndex === EMPTY_PICK_CELL_SLOT) {
        const cellIndex = pickCellCount;
        pickCellCount += 1;
        pickCellSlots[slot] = cellIndex + 1;
        coordinateScratch[cellIndex * 2] = column;
        coordinateScratch[cellIndex * 2 + 1] = row;
        return cellIndex;
      }
      const cellIndex = storedIndex - 1;
      if (
        coordinateScratch[cellIndex * 2] === column &&
        coordinateScratch[cellIndex * 2 + 1] === row
      ) return cellIndex;
      slot = (slot + 1) & pickSlotMask;
    }
  };
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * 3;
    const column = Math.floor(scene.positions[offset]! / pickCellSize);
    const row = Math.floor(scene.positions[offset + 1]! / pickCellSize);
    countScratch[findOrCreatePickCell(column, row)] += 1;
  }
  const pickCellCoordinates = coordinateScratch.slice(0, pickCellCount * 2);
  const pickCellOffsets = new Uint32Array(pickCellCount + 1);
  for (let cellIndex = 0; cellIndex < pickCellCount; cellIndex += 1) {
    pickCellOffsets[cellIndex + 1] = countScratch[cellIndex]!;
  }
  for (let cellIndex = 1; cellIndex < pickCellOffsets.length; cellIndex += 1) {
    pickCellOffsets[cellIndex] += pickCellOffsets[cellIndex - 1]!;
  }
  const pickNodeIndices = new Uint32Array(nodeCount);
  const pickWriteOffsets = pickCellOffsets.slice(0, -1);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * 3;
    const column = Math.floor(scene.positions[offset]! / pickCellSize);
    const row = Math.floor(scene.positions[offset + 1]! / pickCellSize);
    const cellIndex = findOrCreatePickCell(column, row);
    pickNodeIndices[pickWriteOffsets[cellIndex]!] = nodeIndex;
    pickWriteOffsets[cellIndex] += 1;
  }

  return {
    nodeIndexSlots,
    neighborOffsets,
    neighborIndices,
    maxNeighborCount,
    pickCellSlots,
    pickCellCoordinates,
    pickCellOffsets,
    pickNodeIndices,
    pickCellSize,
    pickMinZ: minZ,
    pickMaxZ: maxZ,
    pickMaxScreenRadius: maxScreenRadius,
  };
}

export function findFriendsGalaxyPickCellIndex(
  index: FriendsGalaxySceneInteractionIndex,
  column: number,
  row: number,
): number | null {
  if (index.pickCellSlots.length === 0) return null;
  const slotMask = index.pickCellSlots.length - 1;
  let slot = friendsGalaxyPickCellHash(column, row) & slotMask;
  const initialSlot = slot;
  do {
    const storedIndex = index.pickCellSlots[slot]!;
    if (storedIndex === EMPTY_PICK_CELL_SLOT) return null;
    const cellIndex = storedIndex - 1;
    if (
      index.pickCellCoordinates[cellIndex * 2] === column &&
      index.pickCellCoordinates[cellIndex * 2 + 1] === row
    ) return cellIndex;
    slot = (slot + 1) & slotMask;
  } while (slot !== initialSlot);
  return null;
}

export function findFriendsGalaxySceneNodeIndex(
  scene: IdentityGalaxyScene,
  index: FriendsGalaxySceneInteractionIndex,
  nodeId: string | null,
): number | null {
  if (!nodeId || index.nodeIndexSlots.length === 0) return null;
  const slotMask = index.nodeIndexSlots.length - 1;
  let slot = friendsGalaxyNodeIdHash(nodeId) & slotMask;
  const initialSlot = slot;
  do {
    const storedIndex = index.nodeIndexSlots[slot]!;
    if (storedIndex === EMPTY_NODE_INDEX_SLOT) return null;
    const nodeIndex = storedIndex - 1;
    if (scene.nodeIds[nodeIndex] === nodeId) return nodeIndex;
    slot = (slot + 1) & slotMask;
  } while (slot !== initialSlot);
  return null;
}
