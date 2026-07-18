import type {
  GalaxyLabFixture,
  GalaxyLabFixtureOptions,
} from "./scene-fixture.js";
import { IDENTITY_GALAXY_SCENE_VERSION } from "../../src/lib/identity-galaxy-scene.js";
import { GALAXY_LAB_STAR_INSTANCE_FLOATS } from "./star-instance-data.js";

export const GALAXY_LAB_METADATA_NODE_CAP = 192;

export interface GalaxyLabFixtureWorkerRequest {
  kind: "build";
  requestId: number;
  options: GalaxyLabFixtureOptions;
}

export interface GalaxyLabFixtureWorkerReceipt {
  semanticNodeCount: number;
  metadataNodeCount: number;
  activitySummaryCount: number;
  representedActivityItemCount: number;
  transferableBufferCount: number;
}

export interface GalaxyLabFixtureWorkerReadyResponse {
  kind: "ready";
  requestId: number;
  fixture: GalaxyLabFixture;
  receipt: GalaxyLabFixtureWorkerReceipt;
}

export interface GalaxyLabFixtureWorkerErrorResponse {
  kind: "error";
  requestId: number;
  message: string;
}

export type GalaxyLabFixtureWorkerResponse =
  GalaxyLabFixtureWorkerReadyResponse | GalaxyLabFixtureWorkerErrorResponse;

type GalaxyLabTypedArray =
  | Float32Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

interface GalaxyLabTypedArrayConstructor<T extends GalaxyLabTypedArray> {
  readonly name: string;
  new(length: number): T;
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
    throw new Error(`Friends Galaxy worker returned ${label} outside a plain array.`);
  }
  assertArrayLength(label, value, expectedLength);
}

function assertTypedArray<T extends GalaxyLabTypedArray>(
  label: string,
  value: unknown,
  constructor: GalaxyLabTypedArrayConstructor<T>,
  expectedLength: number,
): asserts value is T {
  if (!(value instanceof constructor)) {
    throw new Error(
      `Friends Galaxy worker returned ${label} as ${Object.prototype.toString.call(value)}; expected ${constructor.name}.`,
    );
  }
  assertArrayLength(label, value, expectedLength);
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function assertFiniteScalar(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Friends Galaxy worker returned a non-finite ${label}.`);
  }
}

function formatEnvelopeValue(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

export function validateGalaxyLabFixtureEnvelope(
  fixture: GalaxyLabFixture,
  receipt: GalaxyLabFixtureWorkerReceipt,
): void {
  const { scene, interactionIndex, packedStarInstances } = fixture;
  if (!Array.isArray(scene.nodeIds)) {
    throw new Error("Friends Galaxy worker returned node ids outside a plain array.");
  }
  const nodeCount = scene.nodeIds.length;
  const backgroundCount = fixture.backgroundStarCount;

  for (const [label, value] of [
    ["person count", fixture.personCount],
    ["account count", fixture.accountCount],
    ["linked account count", fixture.linkedAccountCount],
    ["background star count", backgroundCount],
    ["activity summary count", fixture.activitySummaryCount],
    ["represented activity item count", fixture.representedActivityItemCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Friends Galaxy worker returned an invalid ${label}.`);
    }
  }

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
  if (scene.edgeIndices.length % 2 !== 0) {
    throw new Error("Friends Galaxy worker returned an incomplete edge pair.");
  }
  assertTypedArray(
    "edge indices",
    scene.edgeIndices,
    Uint32Array,
    scene.edgeIndices.length,
  );
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

  assertTypedArray(
    "node index slots",
    interactionIndex.nodeIndexSlots,
    Uint32Array,
    interactionIndex.nodeIndexSlots.length,
  );
  if (!isPowerOfTwo(interactionIndex.nodeIndexSlots.length)) {
    throw new Error("Friends Galaxy worker returned a non-power-of-two node index table.");
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
  if (interactionIndex.neighborOffsets[nodeCount] !== interactionIndex.neighborIndices.length) {
    throw new Error("Friends Galaxy worker returned inconsistent neighbor offsets.");
  }
  if (!Number.isInteger(interactionIndex.maxNeighborCount) || interactionIndex.maxNeighborCount < 0) {
    throw new Error("Friends Galaxy worker returned an invalid maximum neighbor count.");
  }

  assertTypedArray(
    "pick cell slots",
    interactionIndex.pickCellSlots,
    Uint32Array,
    interactionIndex.pickCellSlots.length,
  );
  if (!isPowerOfTwo(interactionIndex.pickCellSlots.length)) {
    throw new Error("Friends Galaxy worker returned a non-power-of-two pick cell table.");
  }
  if (interactionIndex.pickCellCoordinates.length % 2 !== 0) {
    throw new Error("Friends Galaxy worker returned an incomplete pick cell coordinate.");
  }
  assertTypedArray(
    "pick cell coordinates",
    interactionIndex.pickCellCoordinates,
    Int32Array,
    interactionIndex.pickCellCoordinates.length,
  );
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
    throw new Error("Friends Galaxy worker returned inconsistent pick cell offsets.");
  }
  assertFiniteScalar("pick cell size", interactionIndex.pickCellSize);
  assertFiniteScalar("minimum pick depth", interactionIndex.pickMinZ);
  assertFiniteScalar("maximum pick depth", interactionIndex.pickMaxZ);
  assertFiniteScalar("maximum pick radius", interactionIndex.pickMaxScreenRadius);
  if (interactionIndex.pickCellSize <= 0 || interactionIndex.pickMaxScreenRadius < 0) {
    throw new Error("Friends Galaxy worker returned invalid pick geometry bounds.");
  }
  if (interactionIndex.pickMinZ > interactionIndex.pickMaxZ) {
    throw new Error("Friends Galaxy worker returned inverted pick depth bounds.");
  }

  assertTypedArray(
    "background positions",
    fixture.backgroundPositions,
    Float32Array,
    backgroundCount * 3,
  );
  assertTypedArray(
    "background brightness",
    fixture.backgroundBrightness,
    Float32Array,
    backgroundCount,
  );
  assertTypedArray(
    "packed semantic stars",
    packedStarInstances.semantic,
    Float32Array,
    nodeCount * GALAXY_LAB_STAR_INSTANCE_FLOATS,
  );
  assertTypedArray(
    "packed background stars",
    packedStarInstances.background,
    Float32Array,
    backgroundCount * GALAXY_LAB_STAR_INSTANCE_FLOATS,
  );

  if (fixture.personCount + fixture.accountCount !== nodeCount) {
    throw new Error("Friends Galaxy worker returned inconsistent semantic source counts.");
  }
  if (fixture.linkedAccountCount > fixture.accountCount) {
    throw new Error("Friends Galaxy worker returned too many linked accounts.");
  }
  if (fixture.activitySummaryCount > fixture.accountCount) {
    throw new Error("Friends Galaxy worker returned too many activity summaries.");
  }
  if (fixture.representedActivityItemCount < fixture.activitySummaryCount) {
    throw new Error(
      "Friends Galaxy worker returned fewer represented items than activity summaries.",
    );
  }
  if (fixture.atlas.nodes.length > GALAXY_LAB_METADATA_NODE_CAP) {
    throw new Error("Friends Galaxy worker exceeded the rich metadata admission cap.");
  }
  assertFiniteScalar("fixture build duration", fixture.buildMs);
  if (fixture.buildMs < 0) {
    throw new Error("Friends Galaxy worker returned a negative fixture build duration.");
  }

  const transferableBufferCount = galaxyLabFixtureTransferables(fixture).length;
  if (
    receipt.semanticNodeCount !== nodeCount ||
    receipt.metadataNodeCount !== fixture.atlas.nodes.length ||
    receipt.activitySummaryCount !== fixture.activitySummaryCount ||
    receipt.representedActivityItemCount !== fixture.representedActivityItemCount ||
    receipt.transferableBufferCount !== transferableBufferCount
  ) {
    throw new Error("Friends Galaxy worker receipt does not match its transferred fixture.");
  }
}

export function compactGalaxyLabFixtureMetadata(
  fixture: GalaxyLabFixture,
  cap = GALAXY_LAB_METADATA_NODE_CAP,
): GalaxyLabFixture {
  const safeCap = Math.max(0, Math.floor(cap));
  const requiredNodeIds = new Set(
    fixture.atlas.labels.map((label) => label.nodeId),
  );
  const nodes = [];
  const acceptedNodeIds = new Set<string>();

  for (const node of fixture.atlas.nodes) {
    if (!requiredNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }
  for (const node of fixture.atlas.nodes) {
    if (nodes.length >= safeCap) break;
    if (!node.personId || acceptedNodeIds.has(node.id)) continue;
    nodes.push(node);
    acceptedNodeIds.add(node.id);
  }

  return {
    ...fixture,
    atlas: {
      ...fixture.atlas,
      nodes,
      edges: [],
      hitBuckets: [],
      metrics: {
        ...fixture.atlas.metrics,
        visibleNodeCount: nodes.length,
        capped: fixture.scene.nodeIds.length > nodes.length,
      },
    },
  };
}

export function galaxyLabFixtureTransferables(
  fixture: GalaxyLabFixture,
): ArrayBuffer[] {
  const buffers = [
    fixture.scene.kinds.buffer,
    fixture.scene.colorRoles.buffer,
    fixture.scene.flags.buffer,
    fixture.scene.positions.buffer,
    fixture.scene.radii.buffer,
    fixture.scene.pointSizes.buffer,
    fixture.scene.prominence.buffer,
    fixture.scene.brightness.buffer,
    fixture.scene.emphasis.buffer,
    fixture.scene.edgeIndices.buffer,
    fixture.interactionIndex.nodeIndexSlots.buffer,
    fixture.interactionIndex.neighborOffsets.buffer,
    fixture.interactionIndex.neighborIndices.buffer,
    fixture.interactionIndex.pickCellSlots.buffer,
    fixture.interactionIndex.pickCellCoordinates.buffer,
    fixture.interactionIndex.pickCellOffsets.buffer,
    fixture.interactionIndex.pickNodeIndices.buffer,
    fixture.packedStarInstances.semantic.buffer,
    fixture.packedStarInstances.background.buffer,
    fixture.backgroundPositions.buffer,
    fixture.backgroundBrightness.buffer,
  ];
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return [...unique];
}

export function galaxyLabFixtureWorkerReceipt(
  fixture: GalaxyLabFixture,
  transferableBufferCount: number,
): GalaxyLabFixtureWorkerReceipt {
  return {
    semanticNodeCount: fixture.scene.nodeIds.length,
    metadataNodeCount: fixture.atlas.nodes.length,
    activitySummaryCount: fixture.activitySummaryCount,
    representedActivityItemCount: fixture.representedActivityItemCount,
    transferableBufferCount,
  };
}
