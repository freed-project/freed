import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_REPLICATION_PROTOCOL_VERSION = 1 as const;

export const LIBRARY_CORE_CLOUD_TRANSPORT_IDS = [
  "google_drive_app_data_v1",
  "dropbox_app_folder_v1",
] as const;

export type LibraryCoreCloudTransportId =
  (typeof LIBRARY_CORE_CLOUD_TRANSPORT_IDS)[number];

interface LibraryScopedObjectRequest {
  readonly libraryId: string;
}

export type LibraryCoreImmutableObjectKeyRequest =
  | (LibraryScopedObjectRequest & {
      readonly kind: "epoch_certificate";
      readonly epochId: string;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "actor_enrollment";
      readonly epochId: string;
      readonly actorId: string;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "operation_segment";
      readonly epochId: string;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "checkpoint_manifest";
      readonly epochId: string;
      readonly generation: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "checkpoint_page";
      readonly epochId: string;
      readonly generation: number;
      readonly pageIndex: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "search_manifest";
      readonly epochId: string;
      readonly generation: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "search_shard";
      readonly epochId: string;
      readonly generation: number;
      readonly shardIndex: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "search_delta";
      readonly epochId: string;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "intent_segment";
      readonly actorId: string;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "result_segment";
      readonly actorId: string;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "blob";
      readonly digest: string;
    })
  | (LibraryScopedObjectRequest & {
      readonly kind: "backup_manifest";
      readonly backupId: string;
      readonly digest: string;
    });

export interface LibraryCoreImmutableObjectDescriptorV1 {
  readonly objectKey: string;
  readonly contentDigest: LibraryCoreLowercaseHex64;
  readonly byteLength: number;
}

export interface LibraryCoreControlPointerV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly storageEpoch: LibraryCoreOperationInstanceId;
  readonly writerId: LibraryCoreOperationInstanceId;
  readonly activeTransport: LibraryCoreCloudTransportId;
  readonly generation: number;
  readonly causalFrontierDigest: LibraryCoreLowercaseHex64;
  readonly manifest: LibraryCoreImmutableObjectDescriptorV1;
}

function assertIdentifier(
  value: unknown,
  field: string,
): asserts value is LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${field} must be a bounded Library Core identifier`);
  }
}

function assertDigest(
  value: unknown,
  field: string,
): asserts value is LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function assertIndex(value: unknown, field: string): asserts value is number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
}

function assertSequenceRange(
  firstSequence: unknown,
  lastSequence: unknown,
): void {
  assertIndex(firstSequence, "firstSequence");
  assertIndex(lastSequence, "lastSequence");
  if (lastSequence < firstSequence) {
    throw new RangeError("lastSequence must not precede firstSequence");
  }
}

export function createLibraryCoreControlObjectKey(libraryId: string): string {
  assertIdentifier(libraryId, "libraryId");
  return `freed-v2-control-${libraryId}.json`;
}

export function createLibraryCoreIntentHeadObjectKey(
  libraryId: string,
  actorId: string,
): string {
  assertIdentifier(libraryId, "libraryId");
  assertIdentifier(actorId, "actorId");
  return `freed-v2-intent-head-${libraryId}-${actorId}.json`;
}

export function createLibraryCoreResultHeadObjectKey(
  libraryId: string,
  actorId: string,
): string {
  assertIdentifier(libraryId, "libraryId");
  assertIdentifier(actorId, "actorId");
  return `freed-v2-result-head-${libraryId}-${actorId}.json`;
}

/**
 * Construct one flat canonical locator for an immutable replication object.
 *
 * Drive file IDs remain the locators of record. These names are descriptive,
 * never authority, and never depend on folder or filename uniqueness.
 */
export function createLibraryCoreImmutableObjectKey(
  request: LibraryCoreImmutableObjectKeyRequest,
): string {
  assertIdentifier(request.libraryId, "libraryId");
  switch (request.kind) {
    case "epoch_certificate":
      assertIdentifier(request.epochId, "epochId");
      assertDigest(request.digest, "digest");
      return `freed-v2-epoch-${request.libraryId}-${request.epochId}-${request.digest}.json`;
    case "actor_enrollment":
      assertIdentifier(request.epochId, "epochId");
      assertIdentifier(request.actorId, "actorId");
      assertDigest(request.digest, "digest");
      return `freed-v2-enrollment-${request.libraryId}-${request.epochId}-${request.actorId}-${request.digest}.json`;
    case "operation_segment":
      assertIdentifier(request.epochId, "epochId");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      assertDigest(request.digest, "digest");
      return `freed-v2-ops-${request.libraryId}-e${request.epochId}-s${request.firstSequence}-${request.lastSequence}-${request.digest}.fseg.gz`;
    case "checkpoint_manifest":
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      return `freed-v2-manifest-${request.libraryId}-e${request.epochId}-g${request.generation}-${request.digest}.json`;
    case "checkpoint_page":
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertIndex(request.pageIndex, "pageIndex");
      assertDigest(request.digest, "digest");
      return `freed-v2-checkpoint-${request.libraryId}-e${request.epochId}-g${request.generation}-p${request.pageIndex}-${request.digest}.fpage.gz`;
    case "search_manifest":
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      return `freed-v2-search-${request.libraryId}-e${request.epochId}-g${request.generation}-manifest-${request.digest}.json`;
    case "search_shard":
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertIndex(request.shardIndex, "shardIndex");
      assertDigest(request.digest, "digest");
      return `freed-v2-search-${request.libraryId}-e${request.epochId}-g${request.generation}-s${request.shardIndex}-${request.digest}.fidx.gz`;
    case "search_delta":
      assertIdentifier(request.epochId, "epochId");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      assertDigest(request.digest, "digest");
      return `freed-v2-search-delta-${request.libraryId}-e${request.epochId}-s${request.firstSequence}-${request.lastSequence}-${request.digest}.fidx.gz`;
    case "intent_segment":
      assertIdentifier(request.actorId, "actorId");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      assertDigest(request.digest, "digest");
      return `freed-v2-intents-${request.libraryId}-${request.actorId}-s${request.firstSequence}-${request.lastSequence}-${request.digest}.fseg.gz`;
    case "result_segment":
      assertIdentifier(request.actorId, "actorId");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      assertDigest(request.digest, "digest");
      return `freed-v2-results-${request.libraryId}-${request.actorId}-s${request.firstSequence}-${request.lastSequence}-${request.digest}.fseg.gz`;
    case "blob":
      assertDigest(request.digest, "digest");
      return `freed-v2-blob-${request.libraryId}-${request.digest}`;
    case "backup_manifest":
      assertIdentifier(request.backupId, "backupId");
      assertDigest(request.digest, "digest");
      return `freed-v2-backup-${request.libraryId}-${request.backupId}-${request.digest}.json`;
  }
}

function ownEnumerableDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
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

export function parseLibraryCoreImmutableObjectDescriptorV1(
  value: unknown,
): LibraryCoreImmutableObjectDescriptorV1 {
  const record = ownEnumerableDataRecord(
    value,
    ["objectKey", "contentDigest", "byteLength"],
    "immutable object descriptor",
  );
  if (
    typeof record.objectKey !== "string" ||
    !isLibraryCoreImmutableObjectKey(record.objectKey)
  ) {
    throw new TypeError("immutable object descriptor has an invalid objectKey");
  }
  assertDigest(record.contentDigest, "contentDigest");
  assertIndex(record.byteLength, "byteLength");
  if (record.byteLength === 0) {
    throw new RangeError(
      "immutable object descriptor byteLength must be positive",
    );
  }
  const embeddedDigest = embeddedObjectKeyDigest(record.objectKey);
  if (embeddedDigest !== record.contentDigest) {
    throw new TypeError(
      "immutable object descriptor contentDigest does not match objectKey",
    );
  }
  return Object.freeze({
    objectKey: record.objectKey,
    contentDigest: record.contentDigest,
    byteLength: record.byteLength,
  });
}

export function parseLibraryCoreControlPointerV1(
  value: unknown,
): LibraryCoreControlPointerV1 {
  const record = ownEnumerableDataRecord(
    value,
    [
      "schemaVersion",
      "protocolVersion",
      "libraryId",
      "storageEpoch",
      "writerId",
      "activeTransport",
      "generation",
      "causalFrontierDigest",
      "manifest",
    ],
    "library control pointer",
  );
  if (record.schemaVersion !== 1 || record.protocolVersion !== 1) {
    throw new TypeError("library control pointer uses an unsupported version");
  }
  assertIdentifier(record.libraryId, "libraryId");
  assertIdentifier(record.storageEpoch, "storageEpoch");
  assertIdentifier(record.writerId, "writerId");
  if (
    typeof record.activeTransport !== "string" ||
    !LIBRARY_CORE_CLOUD_TRANSPORT_IDS.includes(
      record.activeTransport as LibraryCoreCloudTransportId,
    )
  ) {
    throw new TypeError(
      "library control pointer has an unsupported activeTransport",
    );
  }
  assertIndex(record.generation, "generation");
  assertDigest(record.causalFrontierDigest, "causalFrontierDigest");
  const manifest = parseLibraryCoreImmutableObjectDescriptorV1(record.manifest);
  const expectedManifestKey = createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_manifest",
    libraryId: record.libraryId,
    epochId: record.storageEpoch,
    generation: record.generation,
    digest: manifest.contentDigest,
  });
  if (manifest.objectKey !== expectedManifestKey) {
    throw new TypeError(
      "library control pointer manifest does not match its library, storage epoch, and generation",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    protocolVersion: 1,
    libraryId: record.libraryId,
    storageEpoch: record.storageEpoch,
    writerId: record.writerId,
    activeTransport: record.activeTransport as LibraryCoreCloudTransportId,
    generation: record.generation,
    causalFrontierDigest: record.causalFrontierDigest,
    manifest,
  });
}

const ID = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
const DIGEST = "[0-9a-f]{64}";
const INDEX = "(?:0|[1-9][0-9]*)";

function embeddedObjectKeyDigest(objectKey: string): string | null {
  const match = new RegExp(
    `-(${DIGEST})(?:\\.json|\\.fseg\\.gz|\\.fpage\\.gz|\\.fidx\\.gz)?$`,
  ).exec(objectKey);
  return match?.[1] ?? null;
}

function isCanonicalSafeIndexText(value: string): boolean {
  const parsed = Number(value);
  return (
    isLibraryCoreNonnegativeSafeInteger(parsed) && String(parsed) === value
  );
}

interface ObjectKeyPattern {
  readonly pattern: RegExp;
  readonly numericCaptures?: readonly number[];
  readonly rangeCaptures?: readonly [number, number];
}

const IMMUTABLE_OBJECT_KEY_PATTERNS: readonly ObjectKeyPattern[] = [
  { pattern: new RegExp(`^freed-v2-epoch-${ID}-${ID}-${DIGEST}\\.json$`) },
  {
    pattern: new RegExp(
      `^freed-v2-enrollment-${ID}-${ID}-${ID}-${DIGEST}\\.json$`,
    ),
  },
  {
    pattern: new RegExp(
      `^freed-v2-ops-${ID}-e${ID}-s(${INDEX})-(${INDEX})-${DIGEST}\\.fseg\\.gz$`,
    ),
    numericCaptures: [1, 2],
    rangeCaptures: [1, 2],
  },
  {
    pattern: new RegExp(
      `^freed-v2-manifest-${ID}-e${ID}-g(${INDEX})-${DIGEST}\\.json$`,
    ),
    numericCaptures: [1],
  },
  {
    pattern: new RegExp(
      `^freed-v2-checkpoint-${ID}-e${ID}-g(${INDEX})-p(${INDEX})-${DIGEST}\\.fpage\\.gz$`,
    ),
    numericCaptures: [1, 2],
  },
  {
    pattern: new RegExp(
      `^freed-v2-search-${ID}-e${ID}-g(${INDEX})-manifest-${DIGEST}\\.json$`,
    ),
    numericCaptures: [1],
  },
  {
    pattern: new RegExp(
      `^freed-v2-search-${ID}-e${ID}-g(${INDEX})-s(${INDEX})-${DIGEST}\\.fidx\\.gz$`,
    ),
    numericCaptures: [1, 2],
  },
  {
    pattern: new RegExp(
      `^freed-v2-search-delta-${ID}-e${ID}-s(${INDEX})-(${INDEX})-${DIGEST}\\.fidx\\.gz$`,
    ),
    numericCaptures: [1, 2],
    rangeCaptures: [1, 2],
  },
  {
    pattern: new RegExp(
      `^freed-v2-intents-${ID}-${ID}-s(${INDEX})-(${INDEX})-${DIGEST}\\.fseg\\.gz$`,
    ),
    numericCaptures: [1, 2],
    rangeCaptures: [1, 2],
  },
  {
    pattern: new RegExp(
      `^freed-v2-results-${ID}-${ID}-s(${INDEX})-(${INDEX})-${DIGEST}\\.fseg\\.gz$`,
    ),
    numericCaptures: [1, 2],
    rangeCaptures: [1, 2],
  },
  { pattern: new RegExp(`^freed-v2-blob-${ID}-${DIGEST}$`) },
  {
    pattern: new RegExp(`^freed-v2-backup-${ID}-${ID}-${DIGEST}\\.json$`),
  },
];

function matchesObjectKeyPattern(
  value: string,
  definition: ObjectKeyPattern,
): boolean {
  const match = definition.pattern.exec(value);
  if (match === null) return false;
  if (
    definition.numericCaptures?.some((capture) => {
      const text = match[capture];
      return text === undefined || !isCanonicalSafeIndexText(text);
    })
  ) {
    return false;
  }
  if (definition.rangeCaptures === undefined) return true;
  const [firstCapture, lastCapture] = definition.rangeCaptures;
  return Number(match[lastCapture]) >= Number(match[firstCapture]);
}

export function isLibraryCoreImmutableObjectKey(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    !value.includes("/") &&
    !value.includes("..") &&
    !value.includes(".sqlite") &&
    !value.includes(".wal") &&
    !value.includes(".shm") &&
    !value.includes(".journal") &&
    IMMUTABLE_OBJECT_KEY_PATTERNS.some((definition) =>
      matchesObjectKeyPattern(value, definition),
    )
  );
}
