import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreFollowerActorRequestReceiptV2,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreNormalizedIntentHeadV2,
  parseLibraryCoreNormalizedResultHeadV2,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreNormalizedFollowerTransportV2,
  createGoogleDriveLibraryCoreNormalizedIntentAdapterV2,
  createGoogleDriveLibraryCoreNormalizedResultAdapterV2,
  createLibraryCorePrimaryCoordinatorV1,
  createLibraryCoreNormalizedCheckpointWriterV2,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCoreNormalizedIntentSegmentV2,
  importLibraryCoreNormalizedResultSegmentV2,
  importLibraryCoreNormalizedCheckpointV2,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreNormalizedResultHeadV2,
  publishLibraryCoreNormalizedCheckpointV2,
  publishLibraryCoreNormalizedResultSegmentV2,
  syncLibraryCoreNormalizedFollowerV2,
  reassignLibraryCoreNormalizedCheckpointV2,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePreparedImmutableObjectV1,
  type LibraryCoreNormalizedFollowerSyncRuntimeV2,
} from "@freed/sync/cloud/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud/library-core";
import { recordCloudProviderEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";
import {
  activateNormalizedLibraryCheckpointImport,
  appendNormalizedLibraryCheckpointImportPage,
  beginNormalizedLibraryCheckpointImport,
  describeNormalizedLibraryCloudIdentity,
  describeNormalizedLibraryCheckpoint,
  installNormalizedLibraryFollowerActorEnrollment,
  importNormalizedLibraryFollowerResultTransport,
  countersignNormalizedLibraryFollowerActorRequest,
  ingestNormalizedLibraryFollowerIntentPage,
  readNormalizedLibraryCheckpointPage,
  readNormalizedPrimaryFollowerActorTransportState,
  readNormalizedPrimaryFollowerResultPage,
  prepareNormalizedLibraryFollowerActorRequest,
  pageNormalizedLibraryFollowerTransport,
  readNormalizedLibraryFollowerRuntimeStatus,
  readNormalizedLibraryFollowerTransportContext,
  reassignNormalizedLibraryWriterEpoch,
  recordNormalizedLibraryFollowerIntentTransportPublication,
  setSqliteLibraryCloudWriterAdmission,
  type NormalizedLibraryCloudIdentity,
  type SqliteLibraryPersistedCloudIdentity,
} from "./sqlite-library";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";
import {
  readLibraryCoreDesktopRole,
  requireFollowerLibraryCoreDesktopRole,
  requirePrimaryLibraryCoreDesktopRole,
} from "./library-core-desktop-role";

const STATE_FILE = "library-core-cloud-v2.json";
const STATE_KEY = "state";
const FOLLOWER_SYNC_POLL_MS = 60_000;
const PUBLICATION_TIMEOUT_MS = 5 * 60_000;
const ACTIVATION_KEY = "freed.libraryCore.immutableGoogleDriveV1.enabled";

interface LocalLibraryCoreCloudStateV2 {
  readonly version: 2;
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
  readonly controlFileId: string | null;
  readonly lastPublishedRevision: number | null;
  readonly lastPublishedActorDigest: string | null;
  readonly lastPublishedCheckpoint?: LibraryCorePublishedCheckpointReceiptV1 | null;
}

export interface LibraryCorePublishedCheckpointReceiptV1 {
  readonly version: 1;
  readonly localRevision: number;
  readonly itemCount: number;
  readonly checkpointStoredByteLength: number;
  readonly controlRevision: string;
  readonly publishedAt: number;
  readonly controlPointer: LibraryCoreControlPointerV1;
}

export type LibraryCoreCloudPublishResult =
  | { readonly status: "published"; readonly revision: number }
  | { readonly status: "current"; readonly revision: number }
  | { readonly status: "follower_synced"; readonly revision: number }
  | { readonly status: "writer_transferred"; readonly revision: number }
  | { readonly status: "bootstrap_required" }
  | {
      readonly status: "ownership_required";
      readonly currentWriterId: string;
      readonly localWriterId: string;
    };

interface RunningLibraryCoreCloudSync {
  readonly abortController: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}

let running: RunningLibraryCoreCloudSync | null = null;
let runningPrimaryCoordinator: { stop(): void } | null = null;

/**
 * Immutable Drive sync is the production SQLite Library transport.
 *
 * The legacy `"1"` opt-in remains valid. Setting this key to `"0"` is the
 * local emergency rollback switch and is the only value that disables it.
 */
export function isSqliteLibraryGoogleDriveSyncEnabled(): boolean {
  try {
    return window.localStorage.getItem(ACTIVATION_KEY) !== "0";
  } catch {
    return true;
  }
}

function isCloudState(value: unknown): value is LocalLibraryCoreCloudStateV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LocalLibraryCoreCloudStateV2>;
  return (
    candidate.version === 2 &&
    typeof candidate.libraryId === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.libraryId) &&
    typeof candidate.storageEpoch === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.storageEpoch) &&
    typeof candidate.writerId === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.writerId) &&
    (candidate.controlFileId === null ||
      (typeof candidate.controlFileId === "string" &&
        candidate.controlFileId.length > 0 &&
        candidate.controlFileId.length <= 1_024)) &&
    (candidate.lastPublishedRevision === null ||
      (typeof candidate.lastPublishedRevision === "number" &&
        Number.isSafeInteger(candidate.lastPublishedRevision) &&
        candidate.lastPublishedRevision >= 0)) &&
    (candidate.lastPublishedActorDigest === undefined ||
      candidate.lastPublishedActorDigest === null ||
      /^[a-f0-9]{64}$/.test(candidate.lastPublishedActorDigest))
  );
}

/** Read a valid persisted cloud identity without creating cloud state. */
export async function readPersistedSqliteLibraryCloudIdentity(): Promise<SqliteLibraryPersistedCloudIdentity | null> {
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (stored === null || stored === undefined) return null;
  if (!isCloudState(stored)) {
    throw new Error("The saved Library Core cloud identity is invalid");
  }
  const identity: SqliteLibraryPersistedCloudIdentity = {
    libraryId: stored.libraryId,
    storageEpoch: stored.storageEpoch,
    writerId: stored.writerId,
  };
  return Object.freeze(identity);
}

function parsePublishedCheckpointReceipt(
  value: unknown,
): LibraryCorePublishedCheckpointReceiptV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<LibraryCorePublishedCheckpointReceiptV1>;
  if (
    candidate.version !== 1 ||
    typeof candidate.localRevision !== "number" ||
    !Number.isSafeInteger(candidate.localRevision) ||
    candidate.localRevision < 0 ||
    typeof candidate.itemCount !== "number" ||
    !Number.isSafeInteger(candidate.itemCount) ||
    candidate.itemCount < 0 ||
    typeof candidate.checkpointStoredByteLength !== "number" ||
    !Number.isSafeInteger(candidate.checkpointStoredByteLength) ||
    candidate.checkpointStoredByteLength < 0 ||
    typeof candidate.controlRevision !== "string" ||
    candidate.controlRevision.length === 0 ||
    candidate.controlRevision.length > 1_024 ||
    typeof candidate.publishedAt !== "number" ||
    !Number.isSafeInteger(candidate.publishedAt) ||
    candidate.publishedAt < 0 ||
    candidate.controlPointer === undefined
  ) {
    return null;
  }
  try {
    const controlPointer = parseLibraryCoreControlPointerV1(
      candidate.controlPointer,
    );
    return Object.freeze({
      version: 1,
      localRevision: candidate.localRevision,
      itemCount: candidate.itemCount,
      checkpointStoredByteLength: candidate.checkpointStoredByteLength,
      controlRevision: candidate.controlRevision,
      publishedAt: candidate.publishedAt,
      controlPointer,
    });
  } catch {
    return null;
  }
}

function checkpointReceiptForState(
  state: LocalLibraryCoreCloudStateV2,
): LibraryCorePublishedCheckpointReceiptV1 | null {
  const receipt = parsePublishedCheckpointReceipt(
    state.lastPublishedCheckpoint,
  );
  if (
    receipt === null ||
    state.lastPublishedRevision !== receipt.localRevision ||
    state.libraryId !== receipt.controlPointer.libraryId ||
    state.storageEpoch !== receipt.controlPointer.storageEpoch ||
    state.writerId !== receipt.controlPointer.writerId
  ) {
    return null;
  }
  return receipt;
}

async function loadOrCreateCloudState(
  identity: NormalizedLibraryCloudIdentity,
): Promise<{
  readonly state: LocalLibraryCoreCloudStateV2;
  readonly currentWriterId: string;
  readonly identity: NormalizedLibraryCloudIdentity;
}> {
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (stored !== null && stored !== undefined && !isCloudState(stored)) {
    throw new Error("The saved Library Core cloud identity is invalid");
  }
  let reusableState: LocalLibraryCoreCloudStateV2 | null = null;
  if (isCloudState(stored)) {
    if (stored.libraryId !== identity.libraryId) {
      throw new Error(
        "The saved Library Core cloud identity belongs to another Library",
      );
    }
    reusableState = Object.freeze({
      ...stored,
      lastPublishedActorDigest: stored.lastPublishedActorDigest ?? null,
      lastPublishedCheckpoint: checkpointReceiptForState(stored),
    });
  }
  const currentWriterId = identity.localActorId;
  if (reusableState !== null) {
    return { state: reusableState, currentWriterId, identity };
  }
  const state: LocalLibraryCoreCloudStateV2 = Object.freeze({
    version: 2,
    libraryId: identity.libraryId,
    storageEpoch: identity.authorityEpoch,
    writerId: identity.writerId,
    controlFileId: null,
    lastPublishedRevision: null,
    lastPublishedActorDigest: null,
    lastPublishedCheckpoint: null,
  });
  await persistCloudState(state);
  return { state, currentWriterId, identity };
}

async function persistCloudState(
  state: LocalLibraryCoreCloudStateV2,
): Promise<void> {
  await writeNativeJsonValue(
    STATE_FILE,
    STATE_KEY,
    state,
    "library-core-cloud-sync",
  );
}

export async function readSqliteLibraryGoogleDrivePublicationReceipt(): Promise<LibraryCorePublishedCheckpointReceiptV1 | null> {
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (!isCloudState(stored)) return null;
  return checkpointReceiptForState(stored);
}

function checkpointPublicationReceipt(input: {
  readonly localRevision: number;
  readonly itemCount: number;
  readonly checkpointStoredByteLength: number;
  readonly controlRevision: string;
  readonly controlPointer: LibraryCoreControlPointerV1;
}): LibraryCorePublishedCheckpointReceiptV1 {
  const receipt: LibraryCorePublishedCheckpointReceiptV1 = {
    version: 1,
    localRevision: input.localRevision,
    itemCount: input.itemCount,
    checkpointStoredByteLength: input.checkpointStoredByteLength,
    controlRevision: input.controlRevision,
    publishedAt: Date.now(),
    controlPointer: input.controlPointer,
  };
  return Object.freeze(receipt);
}

function checkpointStoredByteLength(input: {
  readonly dependencies: readonly {
    readonly descriptor: { readonly byteLength: number };
  }[];
  readonly manifest: { readonly descriptor: { readonly byteLength: number } };
}): number {
  const total = input.dependencies.reduce(
    (sum, dependency) => sum + dependency.descriptor.byteLength,
    input.manifest.descriptor.byteLength,
  );
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Library Core checkpoint byte total is invalid");
  }
  return total;
}

function exactBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function parseControl(
  read: LibraryCoreControlReadV1,
): LibraryCoreControlPointerV1 | null {
  if (read.bytes === null) {
    throw new Error("Library Core control file has no bytes");
  }
  const value = decodeLibraryCoreCanonicalValue(exactBytes(read.bytes));
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return null;
  }
  return parseLibraryCoreControlPointerV1(value);
}

async function persistVerifiedWriterAdmission(input: {
  readonly localWriterId: string;
  readonly pointer: LibraryCoreControlPointerV1;
  readonly revision: string;
}): Promise<void> {
  await setSqliteLibraryCloudWriterAdmission({
    localWriterId: input.localWriterId,
    activeWriterId: input.pointer.writerId,
    storageEpoch: input.pointer.storageEpoch,
    controlRevision: input.revision,
  });
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function tracedPublicationStage<T>(
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  log.info(`[library-core-cloud] ${label} started`);
  recordCloudProviderEvent("gdrive", {
    kind: "started",
    stage: "upload",
    message: `${label} started.`,
  });
  try {
    const result = await work();
    const elapsedMs = Math.round(performance.now() - startedAt);
    log.info(
      `[library-core-cloud] ${label} completed in ${elapsedMs.toLocaleString()} ms`,
    );
    recordCloudProviderEvent("gdrive", {
      kind: "success",
      stage: "upload",
      message: `${label} completed in ${elapsedMs.toLocaleString()} ms.`,
    });
    return result;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(
      `[library-core-cloud] ${label} failed after ${elapsedMs.toLocaleString()} ms: ${detail}`,
    );
    recordCloudProviderEvent("gdrive", {
      kind: "error",
      stage: "upload",
      message: `${label} failed after ${elapsedMs.toLocaleString()} ms: ${detail}`,
    });
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(`${label} failed: ${detail}`);
  }
}

async function* normalizedCheckpointRecords(
  snapshot: LibraryCoreNormalizedCheckpointExportDescriptorV2,
): AsyncIterable<LibraryCoreNormalizedCheckpointRecordV2> {
  let after: Parameters<
    typeof readNormalizedLibraryCheckpointPage
  >[0]["after"] = null;
  let recordCount = 0;
  for (;;) {
    const page = await readNormalizedLibraryCheckpointPage({ snapshot, after });
    for (const record of page.records) {
      yield record;
      recordCount += 1;
    }
    if (page.done) break;
    if (
      page.nextCursor === null ||
      (after !== null &&
        page.nextCursor.registryKey === after.registryKey &&
        page.nextCursor.primaryKeyJson === after.primaryKeyJson)
    ) {
      throw new Error("Normalized checkpoint export cursor did not advance");
    }
    after = page.nextCursor;
  }
  if (recordCount !== snapshot.recordCount) {
    throw new Error("Normalized checkpoint changed during export");
  }
}

async function prepareWriterEpochCertificate(input: {
  readonly libraryId: string;
  readonly targetStorageEpoch: string;
  readonly canonicalCertificateJson: string;
}): Promise<LibraryCorePreparedImmutableObjectV1<Uint8Array>> {
  const source = new TextEncoder().encode(input.canonicalCertificateJson);
  const contentDigest = await sha256Bytes(source);
  const prepared: LibraryCorePreparedImmutableObjectV1<Uint8Array> = {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: source.byteLength,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        digest: contentDigest,
        epochId: input.targetStorageEpoch,
        kind: "epoch_certificate",
        libraryId: input.libraryId,
      }),
    }),
    source,
  };
  return Object.freeze(prepared);
}

function normalizedEnrollmentIdentity(bytes: Uint8Array): Readonly<{
  actorId: string;
  libraryId: string;
  storageEpochId: string;
}> | null {
  const value = decodeLibraryCoreCanonicalValue(bytes);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const certificateBody = (
    value as Readonly<Record<string, LibraryCoreCanonicalValue>>
  ).certificate_body;
  if (
    certificateBody === null ||
    typeof certificateBody !== "object" ||
    Array.isArray(certificateBody)
  ) {
    return null;
  }
  const enrollmentBody = (
    certificateBody as Readonly<Record<string, LibraryCoreCanonicalValue>>
  ).actor_enrollment_body;
  if (
    enrollmentBody === null ||
    typeof enrollmentBody !== "object" ||
    Array.isArray(enrollmentBody)
  ) {
    return null;
  }
  const normalizedEnrollmentBody = enrollmentBody as Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
  const actorId = normalizedEnrollmentBody.actor_id;
  const libraryId = normalizedEnrollmentBody.library_id;
  const storageEpochId = normalizedEnrollmentBody.epoch_id;
  return typeof actorId === "string" &&
    typeof libraryId === "string" &&
    typeof storageEpochId === "string"
    ? Object.freeze({ actorId, libraryId, storageEpochId })
    : null;
}

function immutableReferenceEquals(
  left: LibraryCoreImmutableObjectReferenceV1,
  right: LibraryCoreImmutableObjectReferenceV1,
): boolean {
  return (
    left.transportObjectId === right.transportObjectId &&
    left.descriptor.byteLength === right.descriptor.byteLength &&
    left.descriptor.contentDigest === right.descriptor.contentDigest &&
    left.descriptor.objectKey === right.descriptor.objectKey
  );
}

async function publishNormalizedActorEnrollment(input: {
  readonly adapter: ReturnType<typeof createGoogleDriveLibraryCoreAdapterV1>;
  readonly enrollment: Awaited<
    ReturnType<typeof countersignNormalizedLibraryFollowerActorRequest>
  >;
}): Promise<void> {
  const source = new TextEncoder().encode(
    input.enrollment.canonicalEnrollmentCertificateJson,
  );
  const contentDigest = await sha256Bytes(source);
  const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
    byteLength: source.byteLength,
    contentDigest,
    objectKey: createLibraryCoreImmutableObjectKey({
      actorId: input.enrollment.actorId,
      digest: contentDigest,
      epochId: input.enrollment.authorityEpochId,
      kind: "actor_enrollment",
      libraryId: input.enrollment.libraryId,
    }),
  });
  const uploaded = await input.adapter.putImmutable({ descriptor, source });
  await input.adapter.verifyImmutable({
    descriptor,
    transportObjectId: uploaded.transportObjectId,
  });
}

async function acceptPendingNormalizedFollowerEnrollments(input: {
  readonly accessToken: string;
  readonly adapter: ReturnType<typeof createGoogleDriveLibraryCoreAdapterV1>;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<readonly string[]> {
  const requests =
    await discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1(input);
  for (const request of requests) {
    const canonical = new TextDecoder("utf-8", { fatal: true }).decode(
      request.bytes,
    );
    const enrollment =
      await countersignNormalizedLibraryFollowerActorRequest(canonical);
    await publishNormalizedActorEnrollment({
      adapter: input.adapter,
      enrollment,
    });
  }
  const certificates =
    await discoverGoogleDriveLibraryCoreActorEnrollmentsV1(input);
  const actorIds = new Set<string>();
  for (const certificate of certificates) {
    const identity = normalizedEnrollmentIdentity(certificate.bytes);
    if (
      identity?.libraryId === input.libraryId &&
      identity.storageEpochId === input.epochId
    ) {
      actorIds.add(identity.actorId);
    }
  }
  return Object.freeze([...actorIds].sort());
}

async function ingestPendingNormalizedFollowerIntents(input: {
  readonly accessToken: string;
  readonly actorIds: readonly string[];
  readonly controlFileId: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  for (const actorId of input.actorIds) {
    const state =
      await readNormalizedPrimaryFollowerActorTransportState(actorId);
    if (
      state.libraryId !== input.libraryId ||
      state.storageEpochId !== input.epochId
    ) {
      throw new Error("normalized follower actor authority changed");
    }
    const locator = await discoverGoogleDriveLibraryCoreIntentHeadV1({
      ...input,
      actorId,
    });
    if (locator === null) continue;
    const adapter = createGoogleDriveLibraryCoreNormalizedIntentAdapterV2({
      accessToken: input.accessToken,
      actorId,
      controlFileId: input.controlFileId,
      epochId: input.epochId,
      googleFetch: input.googleFetch,
      intentHeadFileId: locator.intentHeadFileId,
      libraryId: input.libraryId,
      signal: input.signal,
    });
    const headRead = await adapter.readHead();
    const head = parseLibraryCoreNormalizedIntentHeadV2(headRead.head);
    if (head.next_actor_counter <= state.nextActorCounter) continue;
    if (head.latest_segment === null) {
      throw new Error("normalized intent head references a missing segment");
    }
    const segments = await discoverGoogleDriveLibraryCoreIntentSegmentsV1({
      ...input,
      actorId,
    });
    const latestIndex = segments.findIndex(
      (segment) => immutableReferenceEquals(segment.reference, head.latest_segment!),
    );
    if (latestIndex < 0) {
      throw new Error("normalized intent head references a missing segment");
    }
    const committedSegments = segments.slice(0, latestIndex + 1);
    for (let index = 0; index < committedSegments.length; index += 1) {
      const segment = committedSegments[index]!;
      const previous = committedSegments[index - 1];
      if (
        segment.firstIntentSequence !==
          (previous?.lastIntentSequence ?? 0) + 1 ||
        segment.lastIntentSequence >= head.next_actor_counter
      ) {
        throw new Error("normalized intent segment chain has a gap or overlap");
      }
    }
    const latest = committedSegments.at(-1)!;
    if (latest.lastIntentSequence + 1 !== head.next_actor_counter) {
      throw new Error("normalized intent segments do not match their head");
    }
    const firstPending = committedSegments.findIndex(
      (segment) => segment.lastIntentSequence >= state.nextActorCounter,
    );
    if (firstPending < 0) {
      throw new Error("normalized intent head references a missing segment");
    }
    for (let index = firstPending; index < committedSegments.length; index += 1) {
      const segment = committedSegments[index]!;
      const previous = committedSegments[index - 1];
      await importLibraryCoreNormalizedIntentSegmentV2({
        actorId,
        adapter,
        expectedFirstActorCounter: segment.firstIntentSequence,
        expectedPreviousSegmentDigest:
          previous?.reference.descriptor.contentDigest ?? null,
        libraryId: input.libraryId,
        reference: segment.reference,
        storageEpochId: input.epochId,
        subtle: crypto.subtle,
        writer: {
          async stageNormalizedIntentSegment({ canonicalEnvelopes, envelopes }) {
            await ingestNormalizedLibraryFollowerIntentPage(
              envelopes,
              canonicalEnvelopes,
            );
          },
        },
      });
    }
  }
}

async function flushNormalizedFollowerResults(input: {
  readonly accessToken: string;
  readonly actorIds: readonly string[];
  readonly controlFileId: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  for (const actorId of input.actorIds) {
    let locator = await discoverGoogleDriveLibraryCoreResultHeadV1({
      ...input,
      actorId,
    });
    if (locator === null) {
      locator = await provisionGoogleDriveLibraryCoreNormalizedResultHeadV2({
        accessToken: input.accessToken,
        googleFetch: input.googleFetch,
        head: parseLibraryCoreNormalizedResultHeadV2({
          actor_id: actorId,
          latest_segment: null,
          latest_segment_digest: null,
          library_id: input.libraryId,
          next_result_sequence: 1,
          protocol: "normalized_result_head_v2",
          protocol_version: 2,
          storage_epoch_id: input.epochId,
        }),
        signal: input.signal,
      });
    }
    const adapter = createGoogleDriveLibraryCoreNormalizedResultAdapterV2({
      accessToken: input.accessToken,
      actorId,
      controlFileId: input.controlFileId,
      epochId: input.epochId,
      googleFetch: input.googleFetch,
      libraryId: input.libraryId,
      resultHeadFileId: locator.resultHeadFileId,
      signal: input.signal,
    });
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const head = parseLibraryCoreNormalizedResultHeadV2(
        (await adapter.readHead()).head,
      );
      let after: Readonly<{
        actorId: string;
        resultSequence: number;
        resultDigest: string;
      }> | null = null;
      if (head.next_result_sequence > 1) {
        if (head.latest_segment === null) {
          throw new Error("normalized result head references a missing segment");
        }
        const segments = await discoverGoogleDriveLibraryCoreResultSegmentsV1({
          ...input,
          actorId,
        });
        const latestIndex = segments.findIndex(
          (segment) =>
            immutableReferenceEquals(segment.reference, head.latest_segment!),
        );
        if (latestIndex < 0) {
          throw new Error("normalized result head references a missing segment");
        }
        const committedSegments = segments.slice(0, latestIndex + 1);
        for (let index = 0; index < committedSegments.length; index += 1) {
          const segment = committedSegments[index]!;
          const previous = committedSegments[index - 1];
          if (
            segment.firstResultSequence !==
              (previous?.lastResultSequence ?? 0) + 1 ||
            segment.lastResultSequence >= head.next_result_sequence
          ) {
            throw new Error(
              "normalized result segment chain has a gap or overlap",
            );
          }
        }
        const latest = segments[latestIndex]!;
        const previous = segments[latestIndex - 1];
        let resultDigest: string | null = null;
        await importLibraryCoreNormalizedResultSegmentV2({
          actorId,
          adapter,
          expectedFirstResultSequence: latest.firstResultSequence,
          expectedPreviousSegmentDigest:
            previous?.reference.descriptor.contentDigest ?? null,
          libraryId: input.libraryId,
          reference: latest.reference,
          storageEpochId: input.epochId,
          subtle: crypto.subtle,
          writer: {
            async appendNormalizedResultSegment({ results }) {
              resultDigest = results.at(-1)?.result_body_digest ?? null;
            },
          },
        });
        if (
          latest.lastResultSequence + 1 !== head.next_result_sequence ||
          resultDigest === null
        ) {
          throw new Error("normalized result segment does not match its head");
        }
        after = {
          actorId,
          resultSequence: latest.lastResultSequence,
          resultDigest,
        };
      }
      const page = await readNormalizedPrimaryFollowerResultPage({
        actorId,
        after,
      });
      if (page.records.length === 0) break;
      const published = await publishLibraryCoreNormalizedResultSegmentV2({
        adapter,
        canonicalResults: page.records.map((record) =>
          new TextEncoder().encode(record.canonicalResultJson),
        ),
        subtle: crypto.subtle,
      });
      if (
        published.segmentHeader.first_result_sequence !==
        head.next_result_sequence
      ) {
        throw new Error("normalized result publication changed sequence");
      }
      if (page.done) break;
    }
  }
}

async function bootstrapCloudCheckpointIntoSqlite(input: {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly controlRevision: string;
  readonly pointer: LibraryCoreControlPointerV1;
  readonly follower: boolean;
}): Promise<NormalizedLibraryCloudIdentity> {
  const installedAt = Date.now();
  await importLibraryCoreNormalizedCheckpointV2({
    adapter: input.adapter,
    generation: input.pointer.generation,
    libraryId: input.pointer.libraryId,
    manifest: input.pointer.manifest,
    storageEpoch: input.pointer.storageEpoch,
    subtle: crypto.subtle,
    writer: createLibraryCoreNormalizedCheckpointWriterV2({
      checkpointGeneration: input.pointer.generation,
      controlRevision: input.controlRevision,
      installedAt,
      runtime: {
        activate: (request) =>
          activateNormalizedLibraryCheckpointImport({
            followerReceipt: request.followerReceipt ?? undefined,
            stageId: request.stageId,
          }),
        appendPage: appendNormalizedLibraryCheckpointImportPage,
        begin: beginNormalizedLibraryCheckpointImport,
      },
      writerActorId: input.follower ? input.pointer.writerId : null,
    }),
  });
  return describeNormalizedLibraryCloudIdentity();
}

/**
 * Transfer one current remote Library to this restored Desktop installation.
 *
 * The local SQLite revision must be the exact last revision published by the
 * copied cloud state. A stale or independently advanced copy must bootstrap
 * from the active immutable checkpoint before it may replace authority.
 */
export async function makeThisSqliteLibraryDesktopWriter(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  let descriptor = await describeNormalizedLibraryCloudIdentity();
  const loaded = await loadOrCreateCloudState(descriptor);
  let state = loaded.state;
  const provisioned = await provisionGoogleDriveLibraryCoreControlV1({
    accessToken: input.accessToken,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  if (state.controlFileId !== provisioned.controlFileId) {
    state = Object.freeze({
      ...state,
      controlFileId: provisioned.controlFileId,
    });
    await persistCloudState(state);
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    controlFileId: provisioned.controlFileId,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const controlRead = await adapter.readControl();
  const pointer = parseControl(controlRead);
  if (pointer === null || controlRead.revision === null) {
    throw new Error("The cloud Library has no writer to transfer");
  }
  if (pointer.writerId === loaded.currentWriterId) {
    await persistVerifiedWriterAdmission({
      localWriterId: loaded.currentWriterId,
      pointer,
      revision: controlRead.revision,
    });
    if (
      state.writerId !== pointer.writerId ||
      state.storageEpoch !== pointer.storageEpoch ||
      state.lastPublishedRevision !== descriptor.sourceRevision
    ) {
      state = Object.freeze({
        ...state,
        lastPublishedRevision: descriptor.sourceRevision,
        storageEpoch: pointer.storageEpoch,
        writerId: pointer.writerId,
      });
      await persistCloudState(state);
    }
    return { status: "current", revision: descriptor.sourceRevision };
  }
  if (
    state.lastPublishedRevision !== descriptor.sourceRevision ||
    pointer.storageEpoch !== state.storageEpoch ||
    pointer.writerId !== state.writerId
  ) {
    descriptor = await bootstrapCloudCheckpointIntoSqlite({
      adapter,
      controlRevision: controlRead.revision,
      follower: false,
      pointer,
    });
    state = Object.freeze({
      ...state,
      lastPublishedRevision: descriptor.sourceRevision,
      storageEpoch: pointer.storageEpoch,
      writerId: pointer.writerId,
    });
    await persistCloudState(state);
  }

  const canonicalSourceControlJson = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(
    encodeLibraryCoreCanonicalValue(
      pointer as unknown as LibraryCoreCanonicalValue,
    ),
  );
  const normalizedSource = await describeNormalizedLibraryCheckpoint();
  if (
    String(normalizedSource.libraryId) !== String(pointer.libraryId) ||
    String(normalizedSource.authorityEpoch) !== String(pointer.storageEpoch) ||
    String(normalizedSource.writerId) !== String(pointer.writerId) ||
    normalizedSource.causalFrontierDigest !== pointer.causalFrontierDigest
  ) {
    throw new Error(
      "Normalized SQLite authority does not match the cloud writer source",
    );
  }
  const reassigned = await reassignNormalizedLibraryWriterEpoch({
    canonicalSourceControlJson,
    targetWriterId: loaded.currentWriterId,
  });
  const targetStorageEpoch = reassigned.authority.epoch_id;
  const normalizedTarget = await describeNormalizedLibraryCheckpoint();
  if (
    normalizedTarget.libraryId !== state.libraryId ||
    normalizedTarget.authorityEpoch !== targetStorageEpoch ||
    normalizedTarget.writerId !== loaded.currentWriterId ||
    normalizedTarget.sourceRevision !== normalizedSource.sourceRevision
  ) {
    throw new Error("Normalized SQLite writer reassignment is incomplete");
  }
  const targetState: LocalLibraryCoreCloudStateV2 = Object.freeze({
    ...state,
    lastPublishedCheckpoint: null,
    lastPublishedRevision: null,
    storageEpoch: targetStorageEpoch,
    writerId: loaded.currentWriterId,
  });
  const result = await reassignLibraryCoreNormalizedCheckpointV2({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    descriptor: normalizedTarget,
    epochCertificate: await prepareWriterEpochCertificate({
      canonicalCertificateJson: reassigned.canonicalEpochCertificateJson,
      libraryId: state.libraryId,
      targetStorageEpoch,
    }),
    expectedControl: { pointer, revision: controlRead.revision },
    generation: 0,
    records: normalizedCheckpointRecords(normalizedTarget),
    subtle: crypto.subtle,
  });
  if (result.status === "conflict") {
    const currentPointer = result.currentControlPointer ?? pointer;
    await persistVerifiedWriterAdmission({
      localWriterId: loaded.currentWriterId,
      pointer: currentPointer,
      revision: result.currentRevision ?? controlRead.revision,
    });
    return {
      status: "ownership_required",
      currentWriterId: currentPointer.writerId,
      localWriterId: loaded.currentWriterId,
    };
  }
  await persistCloudState(
    Object.freeze({
      ...targetState,
      lastPublishedActorDigest: null,
      lastPublishedCheckpoint: checkpointPublicationReceipt({
        localRevision: normalizedTarget.sourceRevision,
        itemCount: normalizedTarget.itemCount,
        checkpointStoredByteLength: checkpointStoredByteLength(result),
        controlRevision: result.revision,
        controlPointer: result.controlPointer,
      }),
      lastPublishedRevision: normalizedTarget.sourceRevision,
    }),
  );
  await setSqliteLibraryCloudWriterAdmission({
    localWriterId: loaded.currentWriterId,
    activeWriterId: loaded.currentWriterId,
    storageEpoch: targetStorageEpoch,
    controlRevision: result.revision,
  });
  return {
    status: "writer_transferred",
    revision: normalizedTarget.sourceRevision,
  };
}

async function publishCurrentSqliteLibraryToGoogleDriveInternal(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  const descriptor = await tracedPublicationStage(
    "read local SQLite revision",
    describeNormalizedLibraryCloudIdentity,
  );
  const loaded = await tracedPublicationStage(
    "load local writer authority",
    () => loadOrCreateCloudState(descriptor),
  );
  let state = loaded.state;
  if (state.writerId !== loaded.currentWriterId) {
    await setSqliteLibraryCloudWriterAdmission({
      localWriterId: loaded.currentWriterId,
      activeWriterId: state.writerId,
      storageEpoch: state.storageEpoch,
      controlRevision: "copied-local-cloud-state",
    });
    return {
      status: "ownership_required",
      currentWriterId: state.writerId,
      localWriterId: loaded.currentWriterId,
    };
  }
  const provisioned = await tracedPublicationStage(
    "discover Drive control",
    () =>
      provisionGoogleDriveLibraryCoreControlV1({
        accessToken: input.accessToken,
        libraryId: state.libraryId,
        googleFetch: input.googleFetch,
        signal: input.signal,
      }),
  );
  if (state.controlFileId !== provisioned.controlFileId) {
    state = Object.freeze({
      ...state,
      controlFileId: provisioned.controlFileId,
    });
    await persistCloudState(state);
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    libraryId: state.libraryId,
    controlFileId: provisioned.controlFileId,
    googleFetch: input.googleFetch,
    signal: input.signal,
  });
  const controlRead = await tracedPublicationStage("read Drive control", () =>
    adapter.readControl(),
  );
  const pointer = parseControl(controlRead);
  if (pointer !== null && pointer.writerId !== state.writerId) {
    if (controlRead.revision === null) {
      throw new Error("Library Core control revision is missing");
    }
    await persistVerifiedWriterAdmission({
      localWriterId: loaded.currentWriterId,
      pointer,
      revision: controlRead.revision,
    });
    return {
      status: "ownership_required",
      currentWriterId: pointer.writerId,
      localWriterId: state.writerId,
    };
  }
  if (pointer !== null && controlRead.revision !== null) {
    await persistVerifiedWriterAdmission({
      localWriterId: loaded.currentWriterId,
      pointer,
      revision: controlRead.revision,
    });
  }
  const actorIds = await acceptPendingNormalizedFollowerEnrollments({
    accessToken: input.accessToken,
    adapter,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  await ingestPendingNormalizedFollowerIntents({
    accessToken: input.accessToken,
    actorIds,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  await flushNormalizedFollowerResults({
    accessToken: input.accessToken,
    actorIds,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const normalizedCheckpoint = await describeNormalizedLibraryCheckpoint();
  if (
    normalizedCheckpoint.libraryId !== state.libraryId ||
    normalizedCheckpoint.authorityEpoch !== state.storageEpoch ||
    normalizedCheckpoint.writerId !== state.writerId
  ) {
    throw new Error(
      "Normalized SQLite checkpoint authority conflicts with cloud state",
    );
  }
  if (
    state.lastPublishedRevision === normalizedCheckpoint.sourceRevision
  ) {
    return { status: "current", revision: normalizedCheckpoint.sourceRevision };
  }
  const generation = pointer === null ? 0 : pointer.generation + 1;
  const result = await publishLibraryCoreNormalizedCheckpointV2({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    descriptor: normalizedCheckpoint,
    expectedControl: { revision: controlRead.revision, pointer },
    generation,
    records: normalizedCheckpointRecords(normalizedCheckpoint),
    subtle: crypto.subtle,
  });
  if (result.status === "conflict") {
    throw new Error("Library Core cloud authority changed during publication");
  }
  await setSqliteLibraryCloudWriterAdmission({
    localWriterId: loaded.currentWriterId,
    activeWriterId: state.writerId,
    storageEpoch: state.storageEpoch,
    controlRevision: result.revision,
  });
  state = Object.freeze({
    ...state,
    lastPublishedActorDigest: null,
    lastPublishedCheckpoint: checkpointPublicationReceipt({
      localRevision: normalizedCheckpoint.sourceRevision,
      itemCount: normalizedCheckpoint.itemCount,
      checkpointStoredByteLength: checkpointStoredByteLength(result),
      controlRevision: result.revision,
      controlPointer: result.controlPointer,
    }),
    lastPublishedRevision: normalizedCheckpoint.sourceRevision,
  });
  await persistCloudState(state);
  return { status: "published", revision: normalizedCheckpoint.sourceRevision };
}

function publicationAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * Bound one publication attempt to its owning UI lifecycle.
 *
 * Native SQLite and Keychain commands cannot be interrupted after Tauri has
 * accepted them. Their result is still safe to ignore because every cloud
 * mutation below rechecks the supplied signal before the request and Drive
 * publication ends in an exact control CAS. A canceled native invoke must not
 * remain the head of a module-wide queue and wedge every later sync attempt.
 */
async function runBoundedPublication(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  if (input.signal?.aborted) {
    throw publicationAbortError("SQLite Library publication was canceled.");
  }
  const timeoutController = new AbortController();
  const combinedController = new AbortController();
  const abortCombined = () => combinedController.abort();
  input.signal?.addEventListener("abort", abortCombined, { once: true });
  timeoutController.signal.addEventListener("abort", abortCombined, {
    once: true,
  });
  const timer = window.setTimeout(
    () => timeoutController.abort(),
    PUBLICATION_TIMEOUT_MS,
  );
  const canceled = new Promise<never>((_resolve, reject) => {
    combinedController.signal.addEventListener(
      "abort",
      () => {
        reject(
          publicationAbortError(
            timeoutController.signal.aborted
              ? "SQLite Library publication timed out. Try Sync now again."
              : "SQLite Library publication was canceled.",
          ),
        );
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([
      publishCurrentSqliteLibraryToGoogleDriveInternal({
        ...input,
        signal: combinedController.signal,
      }),
      canceled,
    ]);
  } finally {
    window.clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortCombined);
  }
}

export function publishCurrentSqliteLibraryToGoogleDrive(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  requirePrimaryLibraryCoreDesktopRole();
  return runBoundedPublication(input);
}

async function prepareDesktopNormalizedFollowerEnrollment() {
  const status = await readNormalizedLibraryFollowerRuntimeStatus();
  if (status.state === "active") return null;
  const request = await prepareNormalizedLibraryFollowerActorRequest();
  const source = new TextEncoder().encode(
    request.canonicalEnrollmentRequestJson,
  );
  const contentDigest = sha256LowerHex(source);
  const receipt = parseLibraryCoreFollowerActorRequestReceiptV2({
    actorId: request.actorId,
    actorPublicKey: request.actorPublicKey,
    canonicalRequestBytes: source,
    createdAt: request.createdAt,
    enrollmentRequestDigest: request.enrollmentRequestDigest,
    state: "pending",
  });
  const candidate = {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: source.byteLength,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: request.actorId,
        digest: contentDigest,
        epochId: request.authorityEpochId,
        kind: "actor_enrollment_request",
        libraryId: request.libraryId,
      }),
    }),
    libraryId: request.libraryId as LibraryCoreLowercaseHex64,
    receipt,
    source,
    storageEpochId: request.authorityEpochId as LibraryCoreLowercaseHex64,
  };
  return Object.freeze(candidate);
}

function createDesktopNormalizedFollowerRuntime(): LibraryCoreNormalizedFollowerSyncRuntimeV2 {
  const runtime: LibraryCoreNormalizedFollowerSyncRuntimeV2 = {
    async importResult(publication) {
      return importNormalizedLibraryFollowerResultTransport(publication);
    },
    async installEnrollment(input) {
      const canonical = new TextDecoder("utf-8", { fatal: true }).decode(
        input.canonicalCertificateBytes,
      );
      return installNormalizedLibraryFollowerActorEnrollment(canonical);
    },
    now: Date.now,
    pageIntents: pageNormalizedLibraryFollowerTransport,
    prepareEnrollment: prepareDesktopNormalizedFollowerEnrollment,
    publishIntent: recordNormalizedLibraryFollowerIntentTransportPublication,
    readContext: readNormalizedLibraryFollowerTransportContext,
    subtle: crypto.subtle,
  };
  return Object.freeze(runtime);
}

export async function syncSqliteLibraryFollowerGoogleDriveOnce(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  requireFollowerLibraryCoreDesktopRole();
  const discovered = await discoverPublishedGoogleDriveLibraryCoreControlV1({
    accessToken: input.accessToken,
    googleFetch: input.googleFetch,
    signal: input.signal,
  });
  if (discovered === null) {
    throw new Error("No published SQLite Library was found in Google Drive");
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    controlFileId: discovered.controlFileId,
    googleFetch: input.googleFetch,
    libraryId: discovered.libraryId,
    signal: input.signal,
  });
  requireFollowerLibraryCoreDesktopRole();
  const control = await adapter.readControl();
  const pointer = parseControl(control);
  if (pointer === null || control.revision === null) {
    throw new Error(
      "The Primary Freed Desktop has not published a Library checkpoint",
    );
  }
  const before = await readNormalizedLibraryFollowerRuntimeStatus();
  if (
    before.libraryId !== pointer.libraryId ||
    before.authorityEpochId !== pointer.storageEpoch ||
    before.checkpointGeneration !== pointer.generation
  ) {
    await bootstrapCloudCheckpointIntoSqlite({
      adapter,
      controlRevision: control.revision,
      follower: true,
      pointer,
    });
  }
  await syncLibraryCoreNormalizedFollowerV2(
    createGoogleDriveLibraryCoreNormalizedFollowerTransportV2({
      accessToken: input.accessToken,
      beforeProviderOperation: requireFollowerLibraryCoreDesktopRole,
      controlFileId: discovered.controlFileId,
      googleFetch: input.googleFetch,
      libraryId: pointer.libraryId,
      signal: input.signal,
    }),
    createDesktopNormalizedFollowerRuntime(),
    { signal: input.signal },
  );
  const descriptor = await describeNormalizedLibraryCloudIdentity();
  return { status: "follower_synced", revision: descriptor.sourceRevision };
}

export async function startSqliteLibraryGoogleDriveFollowerSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly onError?: (error: unknown) => void;
  readonly onSynced?: () => Promise<void>;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  stopSqliteLibraryCloudSync();
  const abortController = new AbortController();
  running = { abortController, timer: null };
  const sync = (accessToken: string) =>
    syncSqliteLibraryFollowerGoogleDriveOnce({
      accessToken,
      googleFetch: input.googleFetch,
      signal: abortController.signal,
    });
  const initial = await sync(input.accessToken);
  await input.onSynced?.();
  const poll = async (): Promise<void> => {
    if (
      running?.abortController !== abortController ||
      abortController.signal.aborted
    ) {
      return;
    }
    if (readLibraryCoreDesktopRole() !== "follower") {
      stopSqliteLibraryCloudSync();
      return;
    }
    try {
      await sync(await input.resolveAccessToken());
      await input.onSynced?.();
    } catch (error) {
      input.onError?.(error);
      throw error;
    } finally {
      if (
        running?.abortController === abortController &&
        !abortController.signal.aborted
      ) {
        running.timer = setTimeout(
          () => void poll().catch(console.error),
          FOLLOWER_SYNC_POLL_MS,
        );
      }
    }
  };
  running.timer = setTimeout(
    () => void poll().catch(console.error),
    FOLLOWER_SYNC_POLL_MS,
  );
  return initial;
}

export async function startSqliteLibraryGoogleDriveSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  stopSqliteLibraryCloudSync();
  const coordinator = createLibraryCorePrimaryCoordinatorV1<
    LibraryCoreCloudPublishResult,
    ReturnType<typeof setTimeout>
  >({
    authority: {
      assertPrimary: requirePrimaryLibraryCoreDesktopRole,
    },
    durableState: {
      async read() {
        if (readLibraryCoreDesktopRole() !== "primary") {
          return {
            active: false,
            localRevision: 0,
            lastPublishedRevision: null,
          };
        }
        const identity = await describeNormalizedLibraryCloudIdentity();
        const state = await readNativeJsonValue(STATE_FILE, STATE_KEY);
        if (!isCloudState(state)) return null;
        return {
          active: true,
          localRevision: identity.sourceRevision,
          lastPublishedRevision: state.lastPublishedRevision,
        };
      },
    },
    clock: { nowMs: Date.now },
    scheduler: {
      schedule(callback, delayMs) {
        return setTimeout(() => void callback(), delayMs);
      },
      cancel: clearTimeout,
    },
    diagnostics: {
      record(event) {
        if (
          event.kind === "failed" &&
          event.errorClass === "scheduled_poll_failed"
        ) {
          console.error(
            `[library-core-primary] ${event.errorClass}: ${event.safeDetail}`,
          );
        }
      },
    },
    publication: {
      async publish({ reason, signal }) {
        return publishCurrentSqliteLibraryToGoogleDrive({
          accessToken:
            reason === "initial"
              ? input.accessToken
              : await input.resolveAccessToken(),
          googleFetch: input.googleFetch,
          signal,
        });
      },
    },
  });
  runningPrimaryCoordinator = coordinator;
  return coordinator.start();
}

export function stopSqliteLibraryCloudSync(): void {
  const primaryCoordinator = runningPrimaryCoordinator;
  runningPrimaryCoordinator = null;
  primaryCoordinator?.stop();
  const current = running;
  running = null;
  current?.abortController.abort();
  if (current?.timer !== null && current?.timer !== undefined) {
    clearTimeout(current.timer);
  }
}
