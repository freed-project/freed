import type { IdentityGalaxyScene } from "../../src/lib/identity-galaxy-scene.js";

const EMPTY_NODE_INDEX_SLOT = 0;

export interface GalaxyLabSceneInteractionIndex {
  nodeIndexSlots: Uint32Array;
  neighborOffsets: Uint32Array;
  neighborIndices: Uint32Array;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function galaxyLabNodeIdHash(nodeId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createGalaxyLabSceneInteractionIndex(
  scene: IdentityGalaxyScene,
): GalaxyLabSceneInteractionIndex {
  const nodeCount = scene.nodeIds.length;
  const slotCount = nextPowerOfTwo(Math.max(2, nodeCount * 2));
  const nodeIndexSlots = new Uint32Array(slotCount);
  const slotMask = slotCount - 1;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    let slot = galaxyLabNodeIdHash(scene.nodeIds[nodeIndex]!) & slotMask;
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

  return { nodeIndexSlots, neighborOffsets, neighborIndices };
}

export function findGalaxyLabSceneNodeIndex(
  scene: IdentityGalaxyScene,
  index: GalaxyLabSceneInteractionIndex,
  nodeId: string | null,
): number | null {
  if (!nodeId || index.nodeIndexSlots.length === 0) return null;
  const slotMask = index.nodeIndexSlots.length - 1;
  let slot = galaxyLabNodeIdHash(nodeId) & slotMask;
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
