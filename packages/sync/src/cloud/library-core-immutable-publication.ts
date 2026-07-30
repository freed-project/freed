import {
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreControlPointerV1,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";

const MAX_PUBLICATION_OBJECTS = 4_096;
const MAX_TRANSPORT_OBJECT_ID_BYTES = 1_024;
const MAX_CONTROL_BYTES = 65_536;
const textEncoder = new TextEncoder();

export interface LibraryCorePreparedImmutableObjectV1<Source> {
  readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
  readonly source: Source;
}

export interface LibraryCorePublishedImmutableObjectReceiptV1 {
  readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
  readonly transportObjectId: string;
}

export interface LibraryCoreControlReadV1 {
  readonly revision: string | null;
  readonly bytes: Uint8Array | null;
}

export type LibraryCoreControlCompareAndSwapResultV1 =
  | {
      readonly status: "committed";
      readonly revision: string;
    }
  | {
      readonly status: "conflict";
      readonly current: LibraryCoreControlReadV1;
    };

export interface LibraryCoreImmutablePublicationAdapterV1<Source> {
  readControl(): Promise<LibraryCoreControlReadV1>;
  putImmutable(
    object: LibraryCorePreparedImmutableObjectV1<Source>,
  ): Promise<{ readonly transportObjectId: string }>;
  verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1>;
  compareAndSwapControl(input: {
    readonly expectedRevision: string | null;
    readonly bytes: Uint8Array;
  }): Promise<LibraryCoreControlCompareAndSwapResultV1>;
}

export interface LibraryCoreImmutablePublicationRequestV1<Source> {
  readonly adapter: LibraryCoreImmutablePublicationAdapterV1<Source>;
  readonly expectedControl: {
    readonly revision: string | null;
    readonly pointer: LibraryCoreControlPointerV1 | null;
  };
  readonly dependencies:
    | Iterable<LibraryCorePreparedImmutableObjectV1<Source>>
    | AsyncIterable<LibraryCorePreparedImmutableObjectV1<Source>>;
  readonly prepareManifest: (
    dependencies: readonly LibraryCorePublishedImmutableObjectReceiptV1[],
  ) =>
    | {
        readonly manifest: LibraryCorePreparedImmutableObjectV1<Source>;
        readonly nextControlPointer: LibraryCoreControlPointerV1;
      }
    | Promise<{
        readonly manifest: LibraryCorePreparedImmutableObjectV1<Source>;
        readonly nextControlPointer: LibraryCoreControlPointerV1;
      }>;
}

export type LibraryCoreImmutablePublicationResultV1 =
  | {
      readonly status: "committed" | "recovered_after_response_loss";
      readonly revision: string;
      readonly dependencies: readonly LibraryCorePublishedImmutableObjectReceiptV1[];
      readonly manifest: LibraryCorePublishedImmutableObjectReceiptV1;
      readonly controlPointer: LibraryCoreControlPointerV1;
    }
  | {
      readonly status: "conflict";
      readonly currentRevision: string | null;
      readonly currentControlPointer: LibraryCoreControlPointerV1 | null;
    };

function copyBytes(value: Uint8Array | null, label: string): Uint8Array | null {
  if (value === null) return null;
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array or null`);
  }
  return value.slice();
}

function bytesEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertBoundedText(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TRANSPORT_OBJECT_ID_BYTES ||
    textEncoder.encode(value).byteLength > MAX_TRANSPORT_OBJECT_ID_BYTES
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
}

function encodeControlPointer(
  pointer: LibraryCoreControlPointerV1,
): Uint8Array {
  const parsed = parseLibraryCoreControlPointerV1(pointer);
  return textEncoder.encode(
    JSON.stringify({
      activeTransport: parsed.activeTransport,
      causalFrontierDigest: parsed.causalFrontierDigest,
      generation: parsed.generation,
      libraryId: parsed.libraryId,
      manifest: {
        byteLength: parsed.manifest.byteLength,
        contentDigest: parsed.manifest.contentDigest,
        objectKey: parsed.manifest.objectKey,
      },
      protocolVersion: parsed.protocolVersion,
      schemaVersion: parsed.schemaVersion,
      storageEpoch: parsed.storageEpoch,
      writerId: parsed.writerId,
    }),
  );
}

function parseControlBytes(
  bytes: Uint8Array | null,
): LibraryCoreControlPointerV1 | null {
  if (bytes === null) return null;
  if (bytes.byteLength > MAX_CONTROL_BYTES) {
    throw new RangeError(
      `control bytes exceed ${MAX_CONTROL_BYTES.toLocaleString()} bytes`,
    );
  }
  const snapshot = bytes.slice();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(snapshot),
    );
  } catch {
    throw new TypeError("control bytes must contain canonical UTF-8 JSON");
  }
  const pointer = parseLibraryCoreControlPointerV1(parsed);
  if (!bytesEqual(snapshot, encodeControlPointer(pointer))) {
    throw new TypeError("control bytes are not canonical");
  }
  return pointer;
}

function exactControlRead(
  value: LibraryCoreControlReadV1,
): LibraryCoreControlReadV1 {
  if ((value.revision === null) !== (value.bytes === null)) {
    throw new TypeError(
      "control revision and bytes must both be present or both be absent",
    );
  }
  if (value.revision !== null) {
    assertBoundedText(value.revision, "control revision");
  }
  return Object.freeze({
    revision: value.revision,
    bytes: copyBytes(value.bytes, "control bytes"),
  });
}

function exactReceipt(
  descriptor: LibraryCoreImmutableObjectDescriptorV1,
  transportObjectId: unknown,
): LibraryCorePublishedImmutableObjectReceiptV1 {
  assertBoundedText(transportObjectId, "transportObjectId");
  return Object.freeze({
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1(descriptor),
    transportObjectId,
  });
}

function assertVerifiedDescriptor(
  expected: LibraryCoreImmutableObjectDescriptorV1,
  actual: LibraryCoreImmutableObjectDescriptorV1,
): void {
  const verified = parseLibraryCoreImmutableObjectDescriptorV1(actual);
  if (
    verified.objectKey !== expected.objectKey ||
    verified.contentDigest !== expected.contentDigest ||
    verified.byteLength !== expected.byteLength
  ) {
    throw new Error(
      `immutable object verification failed for ${expected.objectKey}`,
    );
  }
}

async function publishOne<Source>(
  adapter: LibraryCoreImmutablePublicationAdapterV1<Source>,
  prepared: LibraryCorePreparedImmutableObjectV1<Source>,
): Promise<LibraryCorePublishedImmutableObjectReceiptV1> {
  const descriptor = parseLibraryCoreImmutableObjectDescriptorV1(
    prepared.descriptor,
  );
  const stored = await adapter.putImmutable({
    descriptor,
    source: prepared.source,
  });
  const receipt = exactReceipt(descriptor, stored.transportObjectId);
  const verified = await adapter.verifyImmutable(receipt);
  assertVerifiedDescriptor(descriptor, verified);
  return receipt;
}

function controlPointersEqual(
  left: LibraryCoreControlPointerV1 | null,
  right: LibraryCoreControlPointerV1 | null,
): boolean {
  return bytesEqual(
    left === null ? null : encodeControlPointer(left),
    right === null ? null : encodeControlPointer(right),
  );
}

async function* asAsyncIterable<T>(
  values: Iterable<T> | AsyncIterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(values)) {
    yield* values as AsyncIterable<T>;
    return;
  }
  yield* values as Iterable<T>;
}

/**
 * Publish one immutable generation without granting cloud or writer authority.
 *
 * Provider-specific adapters own upload mechanics and remote digest readback.
 * This coordinator enforces dependency-first publication, an exact manifest,
 * and one compare-and-swap of the small control pointer.
 */
export async function publishLibraryCoreImmutableGenerationV1<Source>(
  request: LibraryCoreImmutablePublicationRequestV1<Source>,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const expectedPointer =
    request.expectedControl.pointer === null
      ? null
      : parseLibraryCoreControlPointerV1(request.expectedControl.pointer);
  if (
    (request.expectedControl.revision === null) !==
    (expectedPointer === null)
  ) {
    throw new TypeError(
      "expected control revision and pointer must both be present or both be absent",
    );
  }
  if (request.expectedControl.revision !== null) {
    assertBoundedText(
      request.expectedControl.revision,
      "expected control revision",
    );
  }

  const initial = exactControlRead(await request.adapter.readControl());
  const initialPointer = parseControlBytes(initial.bytes);
  if (
    initial.revision !== request.expectedControl.revision ||
    !controlPointersEqual(initialPointer, expectedPointer)
  ) {
    return Object.freeze({
      status: "conflict",
      currentRevision: initial.revision,
      currentControlPointer: initialPointer,
    });
  }

  const receipts: LibraryCorePublishedImmutableObjectReceiptV1[] = [];
  const objectKeys = new Set<string>();
  for await (const prepared of asAsyncIterable(request.dependencies)) {
    if (receipts.length >= MAX_PUBLICATION_OBJECTS) {
      throw new RangeError(
        `immutable publication exceeds ${MAX_PUBLICATION_OBJECTS.toLocaleString()} dependency objects`,
      );
    }
    const descriptor = parseLibraryCoreImmutableObjectDescriptorV1(
      prepared.descriptor,
    );
    if (objectKeys.has(descriptor.objectKey)) {
      throw new TypeError(
        `immutable publication repeats object key ${descriptor.objectKey}`,
      );
    }
    objectKeys.add(descriptor.objectKey);
    receipts.push(
      await publishOne(request.adapter, {
        descriptor,
        source: prepared.source,
      }),
    );
  }

  const frozenReceipts = Object.freeze([...receipts]);
  const preparedPublication = await request.prepareManifest(frozenReceipts);
  const preparedManifest = preparedPublication.manifest;
  const manifestDescriptor = parseLibraryCoreImmutableObjectDescriptorV1(
    preparedManifest.descriptor,
  );
  if (objectKeys.has(manifestDescriptor.objectKey)) {
    throw new TypeError("manifest object key repeats a dependency object key");
  }
  const manifest = await publishOne(request.adapter, {
    descriptor: manifestDescriptor,
    source: preparedManifest.source,
  });

  const nextControlPointer = parseLibraryCoreControlPointerV1(
    preparedPublication.nextControlPointer,
  );
  if (
    nextControlPointer.manifest.objectKey !== manifest.descriptor.objectKey ||
    nextControlPointer.manifest.contentDigest !==
      manifest.descriptor.contentDigest ||
    nextControlPointer.manifest.byteLength !== manifest.descriptor.byteLength
  ) {
    throw new TypeError(
      "next control pointer does not name the verified manifest",
    );
  }
  if (
    expectedPointer !== null &&
    (nextControlPointer.libraryId !== expectedPointer.libraryId ||
      nextControlPointer.storageEpoch !== expectedPointer.storageEpoch ||
      nextControlPointer.writerId !== expectedPointer.writerId ||
      nextControlPointer.activeTransport !== expectedPointer.activeTransport ||
      nextControlPointer.generation <= expectedPointer.generation)
  ) {
    throw new TypeError(
      "ordinary publication must preserve library, writer epoch, and active transport while advancing generation",
    );
  }
  if (expectedPointer === null && nextControlPointer.generation !== 0) {
    throw new TypeError("the first control pointer must use generation zero");
  }

  const controlBytes = encodeControlPointer(nextControlPointer);
  try {
    const result = await request.adapter.compareAndSwapControl({
      expectedRevision: request.expectedControl.revision,
      bytes: controlBytes.slice(),
    });
    if (result.status === "conflict") {
      const current = exactControlRead(result.current);
      return Object.freeze({
        status: "conflict",
        currentRevision: current.revision,
        currentControlPointer: parseControlBytes(current.bytes),
      });
    }
    assertBoundedText(result.revision, "committed control revision");
    return Object.freeze({
      status: "committed",
      revision: result.revision,
      dependencies: frozenReceipts,
      manifest,
      controlPointer: nextControlPointer,
    });
  } catch (error) {
    const recovered = exactControlRead(await request.adapter.readControl());
    const recoveredPointer = parseControlBytes(recovered.bytes);
    if (
      recovered.revision !== null &&
      controlPointersEqual(recoveredPointer, nextControlPointer)
    ) {
      return Object.freeze({
        status: "recovered_after_response_loss",
        revision: recovered.revision,
        dependencies: frozenReceipts,
        manifest,
        controlPointer: nextControlPointer,
      });
    }
    throw error;
  }
}
