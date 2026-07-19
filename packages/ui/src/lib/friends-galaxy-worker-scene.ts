import { IDENTITY_GALAXY_SCENE_VERSION } from "./identity-galaxy-scene.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import { FRIENDS_GALAXY_STAR_INSTANCE_FLOATS } from "./friends-galaxy-star-instances.js";

export const FRIENDS_GALAXY_WORKER_SCENE_BUFFER_COUNT = 21;

export interface FriendsGalaxyWorkerSceneReceipt {
  semanticNodeCount: number;
  metadataNodeCount: number;
  transferableBufferCount: number;
}

export interface FriendsGalaxyWorkerSceneAdmission {
  metadataNodeCap: number;
}

type FriendsGalaxyTypedArray =
  Float32Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;

interface FriendsGalaxyTypedArrayConstructor<
  T extends FriendsGalaxyTypedArray,
> {
  readonly name: string;
  new (length: number): T;
}

function assertArrayLength(
  label: string,
  value: { readonly length: number } | null | undefined,
  expectedLength: number,
): void {
  if (!value || value.length !== expectedLength) {
    const actualLength = value?.length;
    throw new Error(
      `Friends Galaxy worker returned ${label} length ${actualLength === undefined ? "missing" : actualLength.toLocaleString()}; expected ${expectedLength.toLocaleString()}.`,
    );
  }
}

function assertPlainArray(
  label: string,
  value: unknown,
  expectedLength: number,
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Friends Galaxy worker returned ${label} outside a plain array.`,
    );
  }
  assertArrayLength(label, value, expectedLength);
}

function assertTypedArray<T extends FriendsGalaxyTypedArray>(
  label: string,
  value: unknown,
  constructor: FriendsGalaxyTypedArrayConstructor<T>,
  expectedLength: number,
): asserts value is T {
  if (!(value instanceof constructor)) {
    throw new Error(
      `Friends Galaxy worker returned ${label} as ${Object.prototype.toString.call(value)}; expected ${constructor.name}.`,
    );
  }
  assertArrayLength(label, value, expectedLength);
}

function assertFiniteScalar(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Friends Galaxy worker returned a non-finite ${label}.`);
  }
}

function assertSourceCount(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Friends Galaxy worker returned an invalid ${label}.`);
  }
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function formatEnvelopeValue(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

export function friendsGalaxyRendererSceneTransferables(
  rendererScene: FriendsGalaxyRendererScene,
): ArrayBuffer[] {
  const buffers = [
    rendererScene.scene.kinds.buffer,
    rendererScene.scene.colorRoles.buffer,
    rendererScene.scene.flags.buffer,
    rendererScene.scene.positions.buffer,
    rendererScene.scene.radii.buffer,
    rendererScene.scene.pointSizes.buffer,
    rendererScene.scene.prominence.buffer,
    rendererScene.scene.brightness.buffer,
    rendererScene.scene.emphasis.buffer,
    rendererScene.scene.edgeIndices.buffer,
    rendererScene.interactionIndex.nodeIndexSlots.buffer,
    rendererScene.interactionIndex.neighborOffsets.buffer,
    rendererScene.interactionIndex.neighborIndices.buffer,
    rendererScene.interactionIndex.pickCellSlots.buffer,
    rendererScene.interactionIndex.pickCellCoordinates.buffer,
    rendererScene.interactionIndex.pickCellOffsets.buffer,
    rendererScene.interactionIndex.pickNodeIndices.buffer,
    rendererScene.packedStarInstances.semantic.buffer,
    rendererScene.packedStarInstances.background.buffer,
    rendererScene.backgroundPositions.buffer,
    rendererScene.backgroundBrightness.buffer,
  ];
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return [...unique];
}

export function friendsGalaxyWorkerSceneReceipt(
  rendererScene: FriendsGalaxyRendererScene,
  transferableBufferCount = friendsGalaxyRendererSceneTransferables(
    rendererScene,
  ).length,
): FriendsGalaxyWorkerSceneReceipt {
  return {
    semanticNodeCount: rendererScene.scene.nodeIds.length,
    metadataNodeCount: rendererScene.atlas.nodes.length,
    transferableBufferCount,
  };
}

export function validateFriendsGalaxyWorkerScene(
  candidate: unknown,
  receiptCandidate: unknown,
  admission: FriendsGalaxyWorkerSceneAdmission,
): asserts candidate is FriendsGalaxyRendererScene {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(
      "Friends Galaxy worker returned an invalid renderer scene.",
    );
  }
  const rendererScene = candidate as FriendsGalaxyRendererScene;
  if (!rendererScene.scene || typeof rendererScene.scene !== "object") {
    throw new Error(
      "Friends Galaxy worker returned an invalid semantic scene.",
    );
  }
  if (
    !rendererScene.atlas ||
    typeof rendererScene.atlas !== "object" ||
    !Array.isArray(rendererScene.atlas.nodes)
  ) {
    throw new Error("Friends Galaxy worker returned invalid rich metadata.");
  }
  if (
    !rendererScene.interactionIndex ||
    typeof rendererScene.interactionIndex !== "object"
  ) {
    throw new Error(
      "Friends Galaxy worker returned an invalid interaction index.",
    );
  }
  if (
    !rendererScene.packedStarInstances ||
    typeof rendererScene.packedStarInstances !== "object"
  ) {
    throw new Error(
      "Friends Galaxy worker returned invalid packed star instances.",
    );
  }
  if (!receiptCandidate || typeof receiptCandidate !== "object") {
    throw new Error("Friends Galaxy worker returned an invalid scene receipt.");
  }
  const receipt = receiptCandidate as FriendsGalaxyWorkerSceneReceipt;
  const { scene, interactionIndex, packedStarInstances } = rendererScene;
  if (!Array.isArray(scene.nodeIds)) {
    throw new Error(
      "Friends Galaxy worker returned node ids outside a plain array.",
    );
  }
  const nodeCount = scene.nodeIds.length;
  const backgroundCount = rendererScene.backgroundStarCount;
  assertSourceCount("person count", rendererScene.personCount);
  assertSourceCount("account count", rendererScene.accountCount);
  assertSourceCount("linked account count", rendererScene.linkedAccountCount);
  assertSourceCount("background star count", backgroundCount);

  if (scene.version !== IDENTITY_GALAXY_SCENE_VERSION) {
    throw new Error(
      `Friends Galaxy worker returned scene version ${formatEnvelopeValue(scene.version)}; expected ${formatEnvelopeValue(IDENTITY_GALAXY_SCENE_VERSION)}.`,
    );
  }
  assertPlainArray("node ids", scene.nodeIds, nodeCount);
  assertPlainArray("person ids", scene.personIds, nodeCount);
  assertPlainArray("account ids", scene.accountIds, nodeCount);
  assertPlainArray("linked person ids", scene.linkedPersonIds, nodeCount);
  assertPlainArray("providers", scene.providers, nodeCount);
  assertTypedArray("node kinds", scene.kinds, Uint8Array, nodeCount);
  assertTypedArray("color roles", scene.colorRoles, Uint8Array, nodeCount);
  assertTypedArray("node flags", scene.flags, Uint16Array, nodeCount);
  assertTypedArray("positions", scene.positions, Float32Array, nodeCount * 3);
  assertTypedArray("radii", scene.radii, Float32Array, nodeCount);
  assertTypedArray("point sizes", scene.pointSizes, Float32Array, nodeCount);
  assertTypedArray("prominence", scene.prominence, Float32Array, nodeCount);
  assertTypedArray("brightness", scene.brightness, Float32Array, nodeCount);
  assertTypedArray("emphasis", scene.emphasis, Float32Array, nodeCount);
  if (!(scene.edgeIndices instanceof Uint32Array)) {
    throw new Error(
      "Friends Galaxy worker returned edge indices outside a Uint32Array.",
    );
  }
  if (scene.edgeIndices.length % 2 !== 0) {
    throw new Error("Friends Galaxy worker returned an incomplete edge pair.");
  }
  if (!scene.bounds || typeof scene.bounds !== "object") {
    throw new Error("Friends Galaxy worker returned invalid scene bounds.");
  }
  assertFiniteScalar("minimum scene x", scene.bounds.minX);
  assertFiniteScalar("maximum scene x", scene.bounds.maxX);
  assertFiniteScalar("minimum scene y", scene.bounds.minY);
  assertFiniteScalar("maximum scene y", scene.bounds.maxY);
  assertFiniteScalar("minimum scene z", scene.bounds.minZ);
  assertFiniteScalar("maximum scene z", scene.bounds.maxZ);
  if (
    scene.bounds.minX > scene.bounds.maxX ||
    scene.bounds.minY > scene.bounds.maxY ||
    scene.bounds.minZ > scene.bounds.maxZ
  ) {
    throw new Error("Friends Galaxy worker returned inverted scene bounds.");
  }

  if (!(interactionIndex.nodeIndexSlots instanceof Uint32Array)) {
    throw new Error(
      "Friends Galaxy worker returned node index slots outside a Uint32Array.",
    );
  }
  assertTypedArray(
    "node index slots",
    interactionIndex.nodeIndexSlots,
    Uint32Array,
    interactionIndex.nodeIndexSlots.length,
  );
  if (!isPowerOfTwo(interactionIndex.nodeIndexSlots.length)) {
    throw new Error(
      "Friends Galaxy worker returned a non-power-of-two node index table.",
    );
  }
  if (!(interactionIndex.pickCellSlots instanceof Uint32Array)) {
    throw new Error(
      "Friends Galaxy worker returned pick cell slots outside a Uint32Array.",
    );
  }
  assertTypedArray(
    "neighbor offsets",
    interactionIndex.neighborOffsets,
    Uint32Array,
    nodeCount + 1,
  );
  assertTypedArray(
    "neighbor indices",
    interactionIndex.neighborIndices,
    Uint32Array,
    scene.edgeIndices.length,
  );
  if (
    interactionIndex.neighborOffsets[nodeCount] !==
    interactionIndex.neighborIndices.length
  ) {
    throw new Error(
      "Friends Galaxy worker returned inconsistent neighbor offsets.",
    );
  }
  if (
    !Number.isInteger(interactionIndex.maxNeighborCount) ||
    interactionIndex.maxNeighborCount < 0
  ) {
    throw new Error(
      "Friends Galaxy worker returned an invalid maximum neighbor count.",
    );
  }

  assertTypedArray(
    "pick cell slots",
    interactionIndex.pickCellSlots,
    Uint32Array,
    interactionIndex.pickCellSlots.length,
  );
  if (!isPowerOfTwo(interactionIndex.pickCellSlots.length)) {
    throw new Error(
      "Friends Galaxy worker returned a non-power-of-two pick cell table.",
    );
  }
  if (!(interactionIndex.pickCellCoordinates instanceof Int32Array)) {
    throw new Error(
      "Friends Galaxy worker returned pick cell coordinates outside an Int32Array.",
    );
  }
  if (interactionIndex.pickCellCoordinates.length % 2 !== 0) {
    throw new Error(
      "Friends Galaxy worker returned an incomplete pick cell coordinate.",
    );
  }
  const pickCellCount = interactionIndex.pickCellCoordinates.length / 2;
  assertTypedArray(
    "pick cell offsets",
    interactionIndex.pickCellOffsets,
    Uint32Array,
    pickCellCount + 1,
  );
  assertTypedArray(
    "pick node indices",
    interactionIndex.pickNodeIndices,
    Uint32Array,
    nodeCount,
  );
  if (interactionIndex.pickCellOffsets[pickCellCount] !== nodeCount) {
    throw new Error(
      "Friends Galaxy worker returned inconsistent pick cell offsets.",
    );
  }
  assertFiniteScalar("pick cell size", interactionIndex.pickCellSize);
  assertFiniteScalar("minimum pick depth", interactionIndex.pickMinZ);
  assertFiniteScalar("maximum pick depth", interactionIndex.pickMaxZ);
  assertFiniteScalar(
    "maximum pick radius",
    interactionIndex.pickMaxScreenRadius,
  );
  if (
    interactionIndex.pickCellSize <= 0 ||
    interactionIndex.pickMaxScreenRadius < 0
  ) {
    throw new Error(
      "Friends Galaxy worker returned invalid pick geometry bounds.",
    );
  }
  if (interactionIndex.pickMinZ > interactionIndex.pickMaxZ) {
    throw new Error(
      "Friends Galaxy worker returned inverted pick depth bounds.",
    );
  }

  assertTypedArray(
    "background positions",
    rendererScene.backgroundPositions,
    Float32Array,
    backgroundCount * 3,
  );
  assertTypedArray(
    "background brightness",
    rendererScene.backgroundBrightness,
    Float32Array,
    backgroundCount,
  );
  assertTypedArray(
    "packed semantic stars",
    packedStarInstances.semantic,
    Float32Array,
    nodeCount * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
  );
  assertTypedArray(
    "packed background stars",
    packedStarInstances.background,
    Float32Array,
    backgroundCount * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
  );

  if (rendererScene.personCount + rendererScene.accountCount !== nodeCount) {
    throw new Error(
      "Friends Galaxy worker returned inconsistent semantic source counts.",
    );
  }
  if (rendererScene.linkedAccountCount > rendererScene.accountCount) {
    throw new Error("Friends Galaxy worker returned too many linked accounts.");
  }
  if (
    !Number.isSafeInteger(admission.metadataNodeCap) ||
    admission.metadataNodeCap < 0
  ) {
    throw new Error(
      "Friends Galaxy worker admission requires a valid metadata cap.",
    );
  }
  const metadataNodeCap = admission.metadataNodeCap;
  if (rendererScene.atlas.nodes.length > metadataNodeCap) {
    throw new Error(
      "Friends Galaxy worker exceeded the rich metadata admission cap.",
    );
  }

  const transferableBufferCount =
    friendsGalaxyRendererSceneTransferables(rendererScene).length;
  if (transferableBufferCount !== FRIENDS_GALAXY_WORKER_SCENE_BUFFER_COUNT) {
    throw new Error(
      `Friends Galaxy worker returned ${transferableBufferCount.toLocaleString()} unique scene buffers; expected ${FRIENDS_GALAXY_WORKER_SCENE_BUFFER_COUNT.toLocaleString()}.`,
    );
  }
  if (
    receipt.semanticNodeCount !== nodeCount ||
    receipt.metadataNodeCount !== rendererScene.atlas.nodes.length ||
    receipt.transferableBufferCount !== transferableBufferCount
  ) {
    throw new Error(
      "Friends Galaxy worker receipt does not match its transferred scene.",
    );
  }
}
