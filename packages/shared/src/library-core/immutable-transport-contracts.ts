import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_CONTROL_OBJECT_KEY =
  "control/library-control.json" as const;

export const LIBRARY_CORE_REPLICATION_PROTOCOL_VERSION = 1 as const;

export const LIBRARY_CORE_CLOUD_TRANSPORT_IDS = [
  "google_drive_app_data_v1",
  "dropbox_app_folder_v1",
] as const;

export type LibraryCoreCloudTransportId =
  (typeof LIBRARY_CORE_CLOUD_TRANSPORT_IDS)[number];

export type LibraryCoreImmutableObjectKeyRequest =
  | {
      readonly kind: "epoch_certificate";
      readonly epochId: string;
    }
  | {
      readonly kind: "actor_enrollment";
      readonly actorId: string;
      readonly digest: string;
    }
  | {
      readonly kind: "operation_segment";
      readonly epochId: string;
      readonly actorId: string;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    }
  | {
      readonly kind: "checkpoint_manifest";
      readonly epochId: string;
      readonly generation: number;
      readonly digest: string;
    }
  | {
      readonly kind: "checkpoint_page";
      readonly epochId: string;
      readonly generation: number;
      readonly pageIndex: number;
      readonly digest: string;
    }
  | {
      readonly kind: "desktop_checkpoint";
      readonly epochId: string;
      readonly generation: number;
      readonly digest: string;
    }
  | {
      readonly kind: "search_base";
      readonly epochId: string;
      readonly generation: number;
      readonly digest: string;
    }
  | {
      readonly kind: "search_delta";
      readonly epochId: string;
      readonly generation: number;
      readonly firstSequence: number;
      readonly lastSequence: number;
      readonly digest: string;
    }
  | {
      readonly kind: "intent";
      readonly actorId: string;
      readonly sequence: number;
      readonly operationId: string;
      readonly digest: string;
    }
  | {
      readonly kind: "intent_result";
      readonly actorId: string;
      readonly sequence: number;
      readonly operationId: string;
      readonly digest: string;
    }
  | {
      readonly kind: "blob";
      readonly digest: string;
    }
  | {
      readonly kind: "backup_manifest";
      readonly backupId: string;
      readonly digest: string;
    };

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

/**
 * Construct one canonical locator for an immutable replication object.
 *
 * The mutable control pointer is deliberately absent. SQLite WAL, SHM, and
 * rollback-journal paths cannot be constructed through this contract.
 */
export function createLibraryCoreImmutableObjectKey(
  request: LibraryCoreImmutableObjectKeyRequest,
): string {
  switch (request.kind) {
    case "epoch_certificate": {
      assertIdentifier(request.epochId, "epochId");
      return `epochs/${request.epochId}/epoch-certificate.cbor`;
    }
    case "actor_enrollment": {
      assertIdentifier(request.actorId, "actorId");
      assertDigest(request.digest, "digest");
      return `actors/${request.actorId}/enrollment-${request.digest}.cbor`;
    }
    case "operation_segment": {
      assertIdentifier(request.epochId, "epochId");
      assertIdentifier(request.actorId, "actorId");
      assertDigest(request.digest, "digest");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      return `operations/${request.epochId}/${request.actorId}/${request.firstSequence}-${request.lastSequence}-${request.digest}.cbor`;
    }
    case "checkpoint_manifest": {
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      return `checkpoints/${request.epochId}/${request.generation}/manifest-${request.digest}.cbor`;
    }
    case "checkpoint_page": {
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertIndex(request.pageIndex, "pageIndex");
      assertDigest(request.digest, "digest");
      return `checkpoints/${request.epochId}/${request.generation}/pages/${request.pageIndex}-${request.digest}.cbor`;
    }
    case "desktop_checkpoint": {
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      return `checkpoints/${request.epochId}/${request.generation}/desktop-${request.digest}.sqlite`;
    }
    case "search_base": {
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      return `search/${request.epochId}/${request.generation}/base-${request.digest}.cbor`;
    }
    case "search_delta": {
      assertIdentifier(request.epochId, "epochId");
      assertIndex(request.generation, "generation");
      assertDigest(request.digest, "digest");
      assertSequenceRange(request.firstSequence, request.lastSequence);
      return `search/${request.epochId}/${request.generation}/delta-${request.firstSequence}-${request.lastSequence}-${request.digest}.cbor`;
    }
    case "intent": {
      assertIdentifier(request.actorId, "actorId");
      assertIndex(request.sequence, "sequence");
      assertIdentifier(request.operationId, "operationId");
      assertDigest(request.digest, "digest");
      return `intents/${request.actorId}/${request.sequence}-${request.operationId}-${request.digest}.cbor`;
    }
    case "intent_result": {
      assertIdentifier(request.actorId, "actorId");
      assertIndex(request.sequence, "sequence");
      assertIdentifier(request.operationId, "operationId");
      assertDigest(request.digest, "digest");
      return `intent-results/${request.actorId}/${request.sequence}-${request.operationId}-${request.digest}.cbor`;
    }
    case "blob": {
      assertDigest(request.digest, "digest");
      return `blobs/${request.digest.slice(0, 2)}/${request.digest}`;
    }
    case "backup_manifest": {
      assertIdentifier(request.backupId, "backupId");
      assertDigest(request.digest, "digest");
      return `backups/${request.backupId}/manifest-${request.digest}.cbor`;
    }
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
  if (embeddedDigest !== null && embeddedDigest !== record.contentDigest) {
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
    epochId: record.storageEpoch,
    generation: record.generation,
    digest: manifest.contentDigest,
  });
  if (manifest.objectKey !== expectedManifestKey) {
    throw new TypeError(
      "library control pointer manifest does not match its storage epoch and generation",
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
  const blobMatch = new RegExp(`^blobs/[0-9a-f]{2}/(${DIGEST})$`).exec(
    objectKey,
  );
  if (blobMatch?.[1]) return blobMatch[1];

  const suffixedMatch = new RegExp(`-(${DIGEST})(?:\\.cbor|\\.sqlite)$`).exec(
    objectKey,
  );
  return suffixedMatch?.[1] ?? null;
}

const SIMPLE_IMMUTABLE_OBJECT_KEY_PATTERNS = [
  new RegExp(`^epochs/${ID}/epoch-certificate\\.cbor$`),
  new RegExp(`^actors/${ID}/enrollment-${DIGEST}\\.cbor$`),
  new RegExp(`^backups/${ID}/manifest-${DIGEST}\\.cbor$`),
] as const;

function isCanonicalSafeIndexText(value: string): boolean {
  const parsed = Number(value);
  return (
    isLibraryCoreNonnegativeSafeInteger(parsed) && String(parsed) === value
  );
}

interface IndexedObjectKeyPattern {
  readonly pattern: RegExp;
  readonly numericCaptures: readonly number[];
  readonly rangeCaptures?: readonly [number, number];
}

const INDEXED_IMMUTABLE_OBJECT_KEY_PATTERNS: readonly IndexedObjectKeyPattern[] =
  [
    {
      pattern: new RegExp(
        `^operations/${ID}/${ID}/(${INDEX})-(${INDEX})-${DIGEST}\\.cbor$`,
      ),
      numericCaptures: [1, 2],
      rangeCaptures: [1, 2],
    },
    {
      pattern: new RegExp(
        `^checkpoints/${ID}/(${INDEX})/manifest-${DIGEST}\\.cbor$`,
      ),
      numericCaptures: [1],
    },
    {
      pattern: new RegExp(
        `^checkpoints/${ID}/(${INDEX})/pages/(${INDEX})-${DIGEST}\\.cbor$`,
      ),
      numericCaptures: [1, 2],
    },
    {
      pattern: new RegExp(
        `^checkpoints/${ID}/(${INDEX})/desktop-${DIGEST}\\.sqlite$`,
      ),
      numericCaptures: [1],
    },
    {
      pattern: new RegExp(`^search/${ID}/(${INDEX})/base-${DIGEST}\\.cbor$`),
      numericCaptures: [1],
    },
    {
      pattern: new RegExp(
        `^search/${ID}/(${INDEX})/delta-(${INDEX})-(${INDEX})-${DIGEST}\\.cbor$`,
      ),
      numericCaptures: [1, 2, 3],
      rangeCaptures: [2, 3],
    },
    {
      pattern: new RegExp(`^intents/${ID}/(${INDEX})-${ID}-${DIGEST}\\.cbor$`),
      numericCaptures: [1],
    },
    {
      pattern: new RegExp(
        `^intent-results/${ID}/(${INDEX})-${ID}-${DIGEST}\\.cbor$`,
      ),
      numericCaptures: [1],
    },
  ];

function matchesIndexedObjectKeyPattern(
  value: string,
  definition: IndexedObjectKeyPattern,
): boolean {
  const match = definition.pattern.exec(value);
  if (match === null) return false;
  if (
    definition.numericCaptures.some((capture) => {
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
  if (
    typeof value !== "string" ||
    value === LIBRARY_CORE_CONTROL_OBJECT_KEY ||
    value.includes("..")
  ) {
    return false;
  }

  if (
    SIMPLE_IMMUTABLE_OBJECT_KEY_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    return true;
  }

  if (
    INDEXED_IMMUTABLE_OBJECT_KEY_PATTERNS.some((definition) =>
      matchesIndexedObjectKeyPattern(value, definition),
    )
  ) {
    return true;
  }

  const blobMatch = new RegExp(`^blobs/([0-9a-f]{2})/(${DIGEST})$`).exec(value);
  return blobMatch !== null && blobMatch[1] === blobMatch[2]?.slice(0, 2);
}
