import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "./immutable-transport-contracts.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_CHECKPOINT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_CHECKPOINT_DATASET_SCHEMA_IDS = [
  "library_core_feed_card_projection_v1",
  "library_core_logical_checkpoint_v1",
] as const;
export const LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT = 8_192;
export const LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT = 1_048_576;
export const LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT = 128;

export type LibraryCoreCheckpointDatasetSchemaId =
  (typeof LIBRARY_CORE_CHECKPOINT_DATASET_SCHEMA_IDS)[number];

export interface LibraryCoreCheckpointManifestPageV1 {
  readonly firstRecordIdentity: string;
  readonly lastRecordIdentity: string;
  readonly object: LibraryCoreImmutableObjectReferenceV1;
  readonly pageIndex: number;
  readonly recordCount: number;
}

export interface LibraryCoreCheckpointManifestV1 {
  readonly causalFrontierDigest: LibraryCoreLowercaseHex64;
  readonly datasetSchemaId: LibraryCoreCheckpointDatasetSchemaId;
  readonly generation: number;
  readonly kind: "checkpoint_manifest";
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly pages: readonly LibraryCoreCheckpointManifestPageV1[];
  readonly protocolVersion: 1;
  readonly schemaVersion: 1;
  readonly storageEpoch: LibraryCoreOperationInstanceId;
  readonly totalRecordCount: number;
}

const textEncoder = new TextEncoder();

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain closed record`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value as Record<string, unknown>;
}

function safeIndex(value: unknown, label: string, maximum: number): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value > maximum) {
    throw new RangeError(
      `${label} must be a nonnegative safe integer no greater than ${maximum.toLocaleString()}`,
    );
  }
  return value;
}

function boundedIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    textEncoder.encode(value).byteLength > 512
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
  return value;
}

function denseClosedArray(
  value: unknown,
  label: string,
  maximumItems: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new RangeError(
      `${label} must be an array of no more than ${maximumItems.toLocaleString()} entries`,
    );
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a dense undecorated array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} entries must be enumerable data values`);
    }
  }
  return value;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function compareIdentities(left: string, right: string): number {
  return compareBytes(textEncoder.encode(left), textEncoder.encode(right));
}

function parsePage(
  value: unknown,
  context: {
    readonly generation: number;
    readonly libraryId: string;
    readonly pageIndex: number;
    readonly storageEpoch: string;
  },
): LibraryCoreCheckpointManifestPageV1 {
  const record = closedRecord(
    value,
    [
      "firstRecordIdentity",
      "lastRecordIdentity",
      "object",
      "pageIndex",
      "recordCount",
    ],
    "checkpoint manifest page",
  );
  const pageIndex = safeIndex(
    record.pageIndex,
    "checkpoint manifest pageIndex",
    LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT - 1,
  );
  if (pageIndex !== context.pageIndex) {
    throw new TypeError(
      `checkpoint manifest page index must be contiguous at ${context.pageIndex.toLocaleString()}`,
    );
  }
  const recordCount = safeIndex(
    record.recordCount,
    "checkpoint manifest page recordCount",
    LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
  );
  if (recordCount === 0) {
    throw new RangeError("checkpoint manifest pages must not be empty");
  }
  const firstRecordIdentity = boundedIdentity(
    record.firstRecordIdentity,
    "checkpoint manifest firstRecordIdentity",
  );
  const lastRecordIdentity = boundedIdentity(
    record.lastRecordIdentity,
    "checkpoint manifest lastRecordIdentity",
  );
  const rangeOrder = compareIdentities(firstRecordIdentity, lastRecordIdentity);
  if (rangeOrder > 0 || (rangeOrder === 0 && recordCount !== 1)) {
    throw new TypeError(
      "checkpoint manifest page identity range does not match its record count",
    );
  }
  const object = parseLibraryCoreImmutableObjectReferenceV1(record.object);
  const expectedKey = createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_page",
    libraryId: context.libraryId,
    epochId: context.storageEpoch,
    generation: context.generation,
    pageIndex,
    digest: object.descriptor.contentDigest,
  });
  if (object.descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "checkpoint manifest page object does not match its library, epoch, generation, and page index",
    );
  }
  return Object.freeze({
    firstRecordIdentity,
    lastRecordIdentity,
    object,
    pageIndex,
    recordCount,
  });
}

export function parseLibraryCoreCheckpointManifestV1(
  value: unknown,
): LibraryCoreCheckpointManifestV1 {
  const record = closedRecord(
    value,
    [
      "causalFrontierDigest",
      "datasetSchemaId",
      "generation",
      "kind",
      "libraryId",
      "pages",
      "protocolVersion",
      "schemaVersion",
      "storageEpoch",
      "totalRecordCount",
    ],
    "checkpoint manifest",
  );
  if (
    record.schemaVersion !== LIBRARY_CORE_CHECKPOINT_MANIFEST_SCHEMA_VERSION ||
    record.protocolVersion !== 1 ||
    record.kind !== "checkpoint_manifest"
  ) {
    throw new TypeError("checkpoint manifest uses an unsupported version");
  }
  if (!isLibraryCoreOperationInstanceId(record.libraryId)) {
    throw new TypeError("checkpoint manifest libraryId is invalid");
  }
  if (!isLibraryCoreOperationInstanceId(record.storageEpoch)) {
    throw new TypeError("checkpoint manifest storageEpoch is invalid");
  }
  const generation = safeIndex(
    record.generation,
    "checkpoint manifest generation",
    Number.MAX_SAFE_INTEGER,
  );
  if (!isLibraryCoreLowercaseHex64(record.causalFrontierDigest)) {
    throw new TypeError("checkpoint manifest causalFrontierDigest is invalid");
  }
  if (
    typeof record.datasetSchemaId !== "string" ||
    !LIBRARY_CORE_CHECKPOINT_DATASET_SCHEMA_IDS.includes(
      record.datasetSchemaId as LibraryCoreCheckpointDatasetSchemaId,
    )
  ) {
    throw new TypeError("checkpoint manifest datasetSchemaId is unsupported");
  }
  const totalRecordCount = safeIndex(
    record.totalRecordCount,
    "checkpoint manifest totalRecordCount",
    LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT,
  );
  const pageValues = denseClosedArray(
    record.pages,
    "checkpoint manifest pages",
    LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT,
  );

  const pages: LibraryCoreCheckpointManifestPageV1[] = [];
  const transportObjectIds = new Set<string>();
  let countedRecords = 0;
  let previousLastIdentity: string | null = null;
  for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
    const page = parsePage(pageValues[pageIndex], {
      generation,
      libraryId: record.libraryId,
      pageIndex,
      storageEpoch: record.storageEpoch,
    });
    if (
      previousLastIdentity !== null &&
      compareIdentities(page.firstRecordIdentity, previousLastIdentity) <= 0
    ) {
      throw new TypeError(
        "checkpoint manifest page identity ranges must be strictly increasing",
      );
    }
    if (transportObjectIds.has(page.object.transportObjectId)) {
      throw new TypeError(
        "checkpoint manifest repeats a page transport object ID",
      );
    }
    transportObjectIds.add(page.object.transportObjectId);
    countedRecords += page.recordCount;
    if (countedRecords > LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT) {
      throw new RangeError(
        "checkpoint manifest record count exceeds its limit",
      );
    }
    previousLastIdentity = page.lastRecordIdentity;
    pages.push(page);
  }
  if (countedRecords !== totalRecordCount) {
    throw new TypeError(
      "checkpoint manifest page counts do not match totalRecordCount",
    );
  }
  if ((pages.length === 0) !== (totalRecordCount === 0)) {
    throw new TypeError(
      "empty checkpoint manifests must have zero records and zero pages",
    );
  }

  return Object.freeze({
    causalFrontierDigest: record.causalFrontierDigest,
    datasetSchemaId:
      record.datasetSchemaId as LibraryCoreCheckpointDatasetSchemaId,
    generation,
    kind: "checkpoint_manifest",
    libraryId: record.libraryId,
    pages: Object.freeze(pages),
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: record.storageEpoch,
    totalRecordCount,
  });
}
