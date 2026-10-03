import { requireLibraryTransferCapability } from "./library-transfer-capability";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { isDesktopHandoffPaused } from "./factory-reset-guard";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import {
  LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
  LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
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
  createGoogleDriveLibraryCoreOperationAdapterV2,
  discoverGoogleDriveLibraryCoreOperationHeadV2,
  provisionGoogleDriveLibraryCoreOperationHeadV2,
  publishLibraryCoreNormalizedOperationsOnceV2,
  syncLibraryCoreNormalizedOperationsOnceV2,
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
  stageLibraryCoreNormalizedCheckpointV2,
  catchUpLibraryCorePredecessorCheckpointV1,
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
  activateNormalizedLibraryPredecessorCheckpoint,
  prepareNormalizedLibraryPredecessorCheckpointRead,
  appendNormalizedLibraryCheckpointImportPage,
  beginNormalizedLibraryCheckpointExport,
  beginNormalizedLibraryCheckpointImport,
  describeNormalizedLibraryCloudIdentity,
  describeNormalizedLibraryOperationExport,
  readNormalizedLibraryOperationPage,
  importNormalizedLibraryOperationPage,
  describeNormalizedLibraryCheckpoint,
  installNormalizedLibraryFollowerActorEnrollment,
  importNormalizedLibraryFollowerResultTransport,
  countersignNormalizedLibraryFollowerActorRequest,
  ingestNormalizedLibraryFollowerIntentPage,
  readNormalizedLibraryCheckpointPage,
  readNormalizedPrimaryFollowerActorTransportState,
  readNormalizedPrimaryFollowerResultPage,
  readNormalizedLibraryHandoffResultActors,
  prepareNormalizedLibraryFollowerActorRequest,
  pageNormalizedLibraryFollowerTransport,
  readNormalizedLibraryFollowerRuntimeStatus,
  readNormalizedLibraryHandoffStatus,
  prepareNormalizedLibraryHandoffActivation,
  stageNormalizedLibraryTargetHandoff,
  readNormalizedLibraryFollowerTransportContext,
  recordNormalizedLibraryFollowerIntentTransportPublication,
  setSqliteLibraryCloudWriterAdmission as setNativeWriterAdmission,
  type NormalizedLibraryCloudIdentity,
  type NormalizedLibraryFollowerRuntimeStatus,
  type SqliteLibraryPersistedCloudIdentity,
} from "./sqlite-library";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";
import { createCheckpointPublicationDeadline } from "./checkpoint-publication-deadline";
import {
  readLibraryCoreDesktopRole,
  refreshLibraryCoreDesktopRole,
  requireFollowerLibraryCoreDesktopRole,
  requirePrimaryLibraryCoreDesktopRole,
} from "./library-core-desktop-role";

const STATE_FILE = "library-core-cloud-v2.json";
const STATE_KEY = "state";
const FOLLOWER_SYNC_POLL_MS = 60_000;
const ACTIVATION_KEY = "freed.libraryCore.immutableGoogleDriveV1.enabled";

interface LocalLibraryCoreCloudStateV2 {
  readonly version: 2;
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
  readonly controlFileId: string | null;
  readonly lastPublishedRevision: number | null;
  readonly lastPublishedOperationRevision?: number | null;
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
  | { readonly status: "follower_synced"; readonly revision: number; readonly follower: NormalizedLibraryFollowerRuntimeStatus }
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
 * The retained `"0"` value is a device-local operator pause for cloud
 * coordination. It does not change SQLite authority or enable another Library
 * engine.
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
  if (candidate.lastPublishedOperationRevision !== undefined && candidate.lastPublishedOperationRevision !== null
    && (!Number.isSafeInteger(candidate.lastPublishedOperationRevision) || candidate.lastPublishedOperationRevision < 0)) return false;
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

function controlPointersEqual(
  left: LibraryCoreControlPointerV1,
  right: LibraryCoreControlPointerV1,
): boolean {
  const leftBytes = encodeLibraryCoreCanonicalValue(
    left as unknown as LibraryCoreCanonicalValue,
  );
  const rightBytes = encodeLibraryCoreCanonicalValue(
    right as unknown as LibraryCoreCanonicalValue,
  );
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}

function setSqliteLibraryCloudWriterAdmission(
  input: Parameters<typeof setNativeWriterAdmission>[0],
): ReturnType<typeof setNativeWriterAdmission> {
  return tracedPublicationStage("persist verified writer admission", () =>
    setNativeWriterAdmission(input));
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
  signal?: AbortSignal,
  advanceRecords?: (count: number) => void,
  handoffId?: string,
): AsyncIterable<LibraryCoreNormalizedCheckpointRecordV2> {
  let after: Parameters<
    typeof readNormalizedLibraryCheckpointPage
  >[0]["after"] = null;
  let recordCount = 0;
  for (;;) {
    throwIfPublicationCanceled(signal);
    const page = await readNormalizedLibraryCheckpointPage({ snapshot, after, ...(handoffId === undefined ? {} : { handoffId }) });
    throwIfPublicationCanceled(signal);
    for (const record of page.records) {
      yield record;
      recordCount += 1;
    }
    if (page.done) {
      if (recordCount === snapshot.recordCount) advanceRecords?.(recordCount);
      break;
    }
    if (
      page.nextCursor === null ||
      (after !== null &&
        page.nextCursor.registryKey === after.registryKey &&
        page.nextCursor.primaryKeyJson === after.primaryKeyJson)
    ) {
      throw new Error("Normalized checkpoint export cursor did not advance");
    }
    after = page.nextCursor;
    advanceRecords?.(recordCount);
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
    await tracedPublicationStage("discover follower enrollment requests", () =>
      discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1(input));
  for (const request of requests) {
    const canonical = new TextDecoder("utf-8", { fatal: true }).decode(
      request.bytes,
    );
    const enrollment =
      await tracedPublicationStage("countersign follower enrollment", async () => {
        try {
          return await countersignNormalizedLibraryFollowerActorRequest(canonical);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          const detail = error instanceof Error ? error.message : error;
          if (detail !== "normalized follower actor replay changed") throw error;
          // Native SQLite rejected this request without changing the enrolled
          // actor. Keep the immutable conflict, but do not strand other actors.
          const message = "Conflicting device enrollment rejected; continuing existing Library sync.";
          log.warn(`[library-core-cloud] ${message}`);
          recordCloudProviderEvent("gdrive", {
            kind: "error",
            stage: "upload",
            message,
          });
          return null;
        }
      });
    if (enrollment === null) continue;
    await tracedPublicationStage("publish follower enrollment", () => publishNormalizedActorEnrollment({
      adapter: input.adapter,
      enrollment,
    }));
  }
  const certificates =
    await tracedPublicationStage("discover accepted follower enrollments", () =>
      discoverGoogleDriveLibraryCoreActorEnrollmentsV1(input));
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
  readonly requireComplete?: boolean;
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
    let complete = false;
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
      if (page.records.length === 0) {
        if (input.requireComplete && !page.done) throw new Error("Handoff result page did not advance");
        complete = true; break;
      }
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
      if (page.done) { complete = true; break; }
    }
    if (input.requireComplete && !complete) throw new Error("Handoff result publication reached its batch limit; retry before consent");
  }
}

async function importCloudCheckpointIntoSqlite(input: {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly controlRevision: string;
  readonly pointer: LibraryCoreControlPointerV1;
  readonly follower: boolean;
  readonly signal?: AbortSignal;
  readonly deadline?: ReturnType<typeof createCheckpointPublicationDeadline>;
}): Promise<void> {
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
        activate: async (request) => {
          throwIfPublicationCanceled(input.signal);
          if (input.follower) await catchUpLibraryCorePredecessorCheckpointV1({
            adapter: input.adapter, subtle: crypto.subtle, successorStageId: request.stageId, installedAt,
            assertActive: () => throwIfPublicationCanceled(input.signal), runtime: {
              prepare: prepareNormalizedLibraryPredecessorCheckpointRead,
              activate: activateNormalizedLibraryPredecessorCheckpoint,
              begin: beginNormalizedLibraryCheckpointImport,
              async appendPage(page) {
                const receipt = await appendNormalizedLibraryCheckpointImportPage(page);
                input.deadline?.verifiedObject(`predecessor:${page.stageId}:${receipt.stagedRecordCount}`);
                return receipt;
              },
            },
          });
          throwIfPublicationCanceled(input.signal);
          return activateNormalizedLibraryCheckpointImport({
            followerReceipt: request.followerReceipt ?? undefined,
            stageId: request.stageId,
          });
        },
        async appendPage(request) {
          throwIfPublicationCanceled(input.signal);
          const receipt = await appendNormalizedLibraryCheckpointImportPage(request);
          input.deadline?.advanceRecords(receipt.stagedRecordCount);
          return receipt;
        },
        async begin(request) {
          throwIfPublicationCanceled(input.signal);
          input.deadline?.beginCheckpoint(request.expectedRecordCount);
          return beginNormalizedLibraryCheckpointImport(request);
        },
      },
      writerActorId: input.follower ? input.pointer.writerId : null,
    }),
  });
}

async function bootstrapCloudCheckpointIntoSqlite(
  input: Parameters<typeof importCloudCheckpointIntoSqlite>[0],
): Promise<NormalizedLibraryCloudIdentity> {
  await importCloudCheckpointIntoSqlite(input);
  return describeNormalizedLibraryCloudIdentity();
}

async function publishCurrentSqliteLibraryToGoogleDriveInternal(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly deadline?: ReturnType<typeof createCheckpointPublicationDeadline>;
}): Promise<LibraryCoreCloudPublishResult> {
  const descriptor = await tracedPublicationStage(
    "read local SQLite revision",
    describeNormalizedLibraryCloudIdentity,
  );
  throwIfPublicationCanceled(input.signal);
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
  await tracedPublicationStage("ingest follower intents", () => ingestPendingNormalizedFollowerIntents({
    accessToken: input.accessToken,
    actorIds,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  }));
  await tracedPublicationStage("publish follower results", () => flushNormalizedFollowerResults({
    accessToken: input.accessToken,
    actorIds,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  }));
  throwIfPublicationCanceled(input.signal);
  const checkpointReceipt = checkpointReceiptForState(state);
  if (pointer && checkpointReceipt && controlRead.revision === checkpointReceipt.controlRevision
    && controlPointersEqual(pointer, checkpointReceipt.controlPointer)) {
    const anchor = { libraryId: pointer.libraryId, storageEpoch: pointer.storageEpoch, writerId: pointer.writerId,
      checkpointDigest: pointer.manifest.descriptor.contentDigest, checkpointRevision: checkpointReceipt.localRevision };
    const operationHeadFileId = await provisionGoogleDriveLibraryCoreOperationHeadV2({
      accessToken: input.accessToken, googleFetch: input.googleFetch, signal: input.signal,
      head: { ...anchor, format: "freed_normalized_operation_head_v2", protocolVersion: 2, segmentCount: 0, tail: null },
    });
    const incremental = await publishLibraryCoreNormalizedOperationsOnceV2({
      anchor,
      transport: createGoogleDriveLibraryCoreOperationAdapterV2({
        accessToken: input.accessToken, libraryId: state.libraryId, epochId: state.storageEpoch,
        writerId: state.writerId, controlFileId: provisioned.controlFileId, operationHeadFileId,
        googleFetch: input.googleFetch, signal: input.signal,
      }),
      source: { describe: describeNormalizedLibraryOperationExport, read: readNormalizedLibraryOperationPage },
      async assertCurrentAuthority() {
        await refreshLibraryCoreDesktopRole();
        requirePrimaryLibraryCoreDesktopRole();
        const current = await adapter.readControl();
        const active = parseControl(current);
        if (current.revision !== controlRead.revision || !active || !controlPointersEqual(active,pointer)) {
          throw new Error("Library authority changed during operation publication.");
        }
      },
      signal: input.signal,
    });
    if (incremental.status !== "checkpoint_required") {
      state = Object.freeze({ ...state, lastPublishedOperationRevision: incremental.revision });
      await persistCloudState(state);
      return { status: incremental.status, revision: incremental.revision };
    }
  }
  return withCheckpointExport(async () => {
    const normalizedCheckpoint =
      await tracedPublicationStage("prepare checkpoint snapshot", () =>
        beginNormalizedLibraryCheckpointExport());
    throwIfPublicationCanceled(input.signal);
    if (
      normalizedCheckpoint.libraryId !== state.libraryId ||
      normalizedCheckpoint.authorityEpoch !== state.storageEpoch ||
      normalizedCheckpoint.writerId !== state.writerId
    ) {
      throw new Error(
        "Normalized SQLite checkpoint authority conflicts with cloud state",
      );
    }
    input.deadline?.beginCheckpoint(normalizedCheckpoint.recordCount);
    throwIfPublicationCanceled(input.signal);
    if (state.lastPublishedRevision === normalizedCheckpoint.sourceRevision) {
      const receipt = checkpointReceiptForState(state);
      if (receipt !== null && pointer !== null
        && controlRead.revision === receipt.controlRevision
        && controlPointersEqual(pointer, receipt.controlPointer)) {
        return { status: "current", revision: normalizedCheckpoint.sourceRevision };
      }
      // Final publication may reach Drive before its local receipt reaches disk.
      // A cancelled, never-authorized source may republish its unchanged frontier
      // through ordinary CAS. Do not extend this recovery to unknown authority.
      const handoff = await readNormalizedLibraryHandoffStatus();
      if (!handoff || handoff.installationRole !== "source" || handoff.phase !== "cancelled"
        || handoff.libraryId !== state.libraryId || handoff.predecessorEpochId !== state.storageEpoch
        || handoff.canonicalAuthorizationBody !== null || handoff.canonicalAuthorization !== null
        || handoff.canonicalActivation !== null || pointer === null
        || String(pointer.libraryId) !== normalizedCheckpoint.libraryId
        || String(pointer.storageEpoch) !== normalizedCheckpoint.authorityEpoch
        || String(pointer.writerId) !== normalizedCheckpoint.writerId
        || pointer.causalFrontierDigest !== normalizedCheckpoint.causalFrontierDigest
        || (receipt !== null && pointer.generation < receipt.controlPointer.generation)) {
        throw new Error(
          "Stored Library Core publication receipt does not match Drive control",
        );
      }
    }
    const generation = pointer === null ? 0 : pointer.generation + 1;
    const result = await publishLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1",
      adapter: {
        ...adapter,
        async verifyImmutable(receipt) {
          const verified = await adapter.verifyImmutable(receipt);
          throwIfPublicationCanceled(input.signal);
          if (
            verified.objectKey === receipt.descriptor.objectKey &&
            verified.contentDigest === receipt.descriptor.contentDigest &&
            verified.byteLength === receipt.descriptor.byteLength
          ) {
            input.deadline?.verifiedObject(verified.objectKey);
          }
          return verified;
        },
      },
      descriptor: normalizedCheckpoint,
      expectedControl: { revision: controlRead.revision, pointer },
      generation,
      records: normalizedCheckpointRecords(
        normalizedCheckpoint,
        input.signal,
        input.deadline?.advanceRecords,
      ),
      subtle: crypto.subtle,
    });
    input.deadline?.check();
    throwIfPublicationCanceled(input.signal);
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
      lastPublishedOperationRevision: normalizedCheckpoint.sourceRevision,
    });
    await persistCloudState(state);
    return { status: "published", revision: normalizedCheckpoint.sourceRevision };
  });
}

let activeSyncWork: Promise<unknown> | null = null;
let activeSyncAbort: (() => void) | null = null;

function requireOrdinarySyncAllowed(): void {
  if (isDesktopHandoffPaused()) throw new Error("Library transfer is pausing ordinary synchronization");
}

/** Native lifecycle changes share the sync owner. A cancelled network pass must
 * actually finish before source preparation can change its authority. */
export async function runSqliteLibraryHandoffLifecycle<T>(work: () => Promise<T>): Promise<T> {
  requireLibraryTransferCapability();
  if (!isDesktopHandoffPaused()) throw new Error("Library handoff requires the renderer pause");
  stopSqliteLibraryCloudSync();
  await waitForFactoryResetDrain(
    () => activeSyncWork === null ? [] : [activeSyncWork.catch(() => undefined)],
    "Library synchronization", 180_000,
  );
  return retainSyncWork(work);
}

function syncWorkBusyError(): Error {
  return new Error("SQLite Library sync is still finishing. Try Sync now again shortly.");
}

function retainSyncWork<T>(
  work: () => Promise<T>,
  abort?: () => void,
): Promise<T> {
  if (activeSyncWork !== null) return Promise.reject(syncWorkBusyError());
  const completion = Promise.resolve().then(work);
  activeSyncWork = completion;
  activeSyncAbort = abort ?? null;
  return completion.finally(() => {
    if (activeSyncWork === completion) {
      activeSyncWork = null;
      activeSyncAbort = null;
    }
  });
}

let checkpointExportInProgress = false;

function checkpointExportBusyError(): Error {
  return new Error(
    "SQLite checkpoint export is still finishing. Try Sync now again shortly.",
  );
}

/**
 * Keep the native singleton owned until the underlying work settles, even
 * when the caller's bounded UI promise has already rejected on cancellation.
 */
async function withCheckpointExport<T>(work: () => Promise<T>): Promise<T> {
  if (checkpointExportInProgress) {
    throw checkpointExportBusyError();
  }
  checkpointExportInProgress = true;
  try {
    return await work();
  } finally {
    checkpointExportInProgress = false;
  }
}

function throwIfPublicationCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw publicationAbortError("SQLite Library publication was canceled.");
  }
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
 * publication ends in an exact control CAS. All underlying work retains its
 * installation-wide ownership until it settles, including canceled preflight.
 * Callers receive a bounded busy error while that work is still finishing.
 */
async function runBoundedPublication<T>(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}, work: (input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly deadline?: ReturnType<typeof createCheckpointPublicationDeadline>;
}) => Promise<T>, handoffPublication = false): Promise<T> {
  if (!handoffPublication) requireOrdinarySyncAllowed();
  if (activeSyncWork !== null) throw syncWorkBusyError();
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
  let timeoutReason: "stalled" | "total" = "total";
  const deadline = createCheckpointPublicationDeadline((reason) => {
    timeoutReason = reason;
    timeoutController.abort();
    const diagnostic = deadline.diagnostics();
    const message = `Checkpoint publication ${reason}: elapsed ${diagnostic.elapsedMs.toLocaleString()} ms, idle ${diagnostic.idleMs.toLocaleString()} ms, records ${diagnostic.advancedRecords.toLocaleString()}/${diagnostic.expectedRecords.toLocaleString()}, verified objects ${diagnostic.verifiedObjects.toLocaleString()}.`;
    log.warn(`[library-core-cloud] ${message}`);
    recordCloudProviderEvent("gdrive", {
      kind: "error",
      stage: "upload",
      message,
    });
  });
  const canceled = new Promise<never>((_resolve, reject) => {
    combinedController.signal.addEventListener(
      "abort",
      () => {
        reject(
          publicationAbortError(
            timeoutController.signal.aborted
              ? timeoutReason === "stalled"
                ? "SQLite Library publication stalled: no checkpoint progress for five minutes."
                : "SQLite Library publication reached its total time budget."
              : "SQLite Library publication was canceled.",
          ),
        );
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([
      retainSyncWork(() => work({
        ...input,
        signal: combinedController.signal,
        deadline,
      }), abortCombined),
      canceled,
    ]);
  } finally {
    deadline.dispose();
    input.signal?.removeEventListener("abort", abortCombined);
  }
}

/** Publish the frozen predecessor without ordinary sync's admission side effects. */
export function publishSealedSqliteLibraryCheckpoint(input: {
  readonly accessToken: string;
  readonly handoffId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly checkpoint: LibraryCoreNormalizedCheckpointExportDescriptorV2;
  readonly controlPointer: LibraryCoreControlPointerV1;
  readonly controlRevision: string;
  readonly controlFileId: string;
}> {
  requireLibraryTransferCapability();
  return runBoundedPublication(input, (request) => withCheckpointExport(async () => {
    const requireSealed = async () => {
      throwIfPublicationCanceled(request.signal);
      const status = await readNormalizedLibraryHandoffStatus();
      if (!status || status.handoffId !== input.handoffId || status.installationRole !== "source"
        || status.phase !== "sealed" || status.canonicalAuthorizationBody !== null) {
        throw new Error("Final checkpoint publication requires this sealed, unsigned source transfer");
      }
      return status;
    };
    const status = await requireSealed();
    const checkpoint = await beginNormalizedLibraryCheckpointExport(input.handoffId);
    if (checkpoint.libraryId !== status.libraryId || checkpoint.authorityEpoch !== status.predecessorEpochId) {
      throw new Error("Sealed checkpoint belongs to a different handoff predecessor");
    }
    const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
    if (!isCloudState(stored) || !stored.controlFileId || stored.libraryId !== checkpoint.libraryId
      || stored.storageEpoch !== checkpoint.authorityEpoch || stored.writerId !== checkpoint.writerId) {
      throw new Error("Final checkpoint publication requires the existing predecessor cloud identity");
    }
    const adapter = createGoogleDriveLibraryCoreAdapterV1({
      ...request, libraryId: checkpoint.libraryId, controlFileId: stored.controlFileId,
    });
    const control = await adapter.readControl();
    const pointer = parseControl(control);
    if (!pointer || control.revision === null || String(pointer.libraryId) !== checkpoint.libraryId
      || String(pointer.storageEpoch) !== checkpoint.authorityEpoch || String(pointer.writerId) !== checkpoint.writerId) {
      throw new Error("Cloud authority no longer matches the sealed predecessor");
    }
    let after: string | null = null;
    for (;;) {
      await requireSealed();
      const actors = await readNormalizedLibraryHandoffResultActors(input.handoffId, after);
      if (actors.length === 0) break;
      if (actors.length > 100 || actors.some((id, index) => !/^[a-f0-9]{64}$/.test(id)
        || id <= (index === 0 ? after ?? "" : actors[index - 1]!))) {
        throw new Error("Handoff result actor page did not advance");
      }
      await flushNormalizedFollowerResults({
        accessToken: request.accessToken, actorIds: actors, controlFileId: stored.controlFileId,
        epochId: checkpoint.authorityEpoch, libraryId: checkpoint.libraryId,
        googleFetch: request.googleFetch, signal: request.signal, requireComplete: true,
      });
      after = actors.at(-1)!;
      request.deadline?.check();
    }
    request.deadline?.beginCheckpoint(checkpoint.recordCount);
    const result = await publishLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1",
      adapter: {
        ...adapter,
        async compareAndSwapControl(change) {
          await requireSealed();
          return adapter.compareAndSwapControl(change);
        },
        async verifyImmutable(receipt) {
          const verified = await adapter.verifyImmutable(receipt);
          if (verified.objectKey === receipt.descriptor.objectKey
            && verified.contentDigest === receipt.descriptor.contentDigest
            && verified.byteLength === receipt.descriptor.byteLength) {
            request.deadline?.verifiedObject(verified.objectKey);
          }
          return verified;
        },
      },
      descriptor: checkpoint,
      expectedControl: { revision: control.revision, pointer },
      generation: pointer.generation + 1,
      records: normalizedCheckpointRecords(checkpoint, request.signal, request.deadline?.advanceRecords, input.handoffId),
      subtle: crypto.subtle,
    });
    if (result.status === "conflict") throw new Error("Cloud authority changed during final checkpoint publication");
    const verified = await adapter.readControl();
    const verifiedPointer = parseControl(verified);
    if (verified.revision !== result.revision || !verifiedPointer || !controlPointersEqual(verifiedPointer, result.controlPointer)) {
      throw new Error("Final checkpoint cloud head could not be verified");
    }
    await requireSealed();
    request.deadline?.check();
    // Preserve ordinary sync continuity if the owner cancels before consent.
    // This receipt records verified publication; it does not restore admission.
    await persistCloudState(Object.freeze({
      ...stored,
      lastPublishedActorDigest: null,
      lastPublishedRevision: checkpoint.sourceRevision,
      lastPublishedOperationRevision: checkpoint.sourceRevision,
      lastPublishedCheckpoint: checkpointPublicationReceipt({
        localRevision: checkpoint.sourceRevision,
        itemCount: checkpoint.itemCount,
        checkpointStoredByteLength: checkpointStoredByteLength(result),
        controlRevision: result.revision,
        controlPointer: verifiedPointer,
      }),
    }));
    throwIfPublicationCanceled(request.signal);
    return { checkpoint, controlPointer: verifiedPointer, controlRevision: result.revision, controlFileId: stored.controlFileId };
  }), true);
}

/** The source stays selected and fenced while successor pages are downloaded.
 * Native code independently checks the signed successor and remote proof. */
export function stageSqliteLibraryHandoffSource(input: {
  handoffId: string; accessToken: string; googleFetch?: GoogleDriveFetch; signal?: AbortSignal;
}): Promise<{ stageId: string; canonicalControl: string }> {
  requireLibraryTransferCapability();
  return runBoundedPublication(input, async (request) => {
    const status = await readNormalizedLibraryHandoffStatus();
    if (!status || status.handoffId !== input.handoffId || status.installationRole !== "source"
      || status.phase !== "authorized" || !status.canonicalAuthorizationBody || !status.canonicalAuthorization) {
      throw new Error("Source download requires its durable handoff consent");
    }
    const body = decodeLibraryCoreCanonicalValue(exactBytes(new TextEncoder().encode(status.canonicalAuthorizationBody))) as {
      source_control_file_id?: unknown;
    };
    if (typeof body.source_control_file_id !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(body.source_control_file_id)) {
      throw new Error("Source consent control identity is invalid");
    }
    const adapter = createGoogleDriveLibraryCoreAdapterV1({ ...request, libraryId: status.libraryId, controlFileId: body.source_control_file_id });
    const control = await adapter.readControl();
    const pointer = parseControl(control);
    if (!pointer || !control.revision || pointer.libraryId !== status.libraryId || pointer.storageEpoch === status.predecessorEpochId) {
      throw new Error("The authorized successor has not published a checkpoint");
    }
    const runtime = {
      async begin(stage: Parameters<typeof beginNormalizedLibraryCheckpointImport>[0]) {
        throwIfPublicationCanceled(request.signal);
        request.deadline?.beginCheckpoint(stage.expectedRecordCount);
        return beginNormalizedLibraryCheckpointImport(stage);
      },
      async appendPage(page: Parameters<typeof appendNormalizedLibraryCheckpointImportPage>[0]) {
        throwIfPublicationCanceled(request.signal);
        const receipt = await appendNormalizedLibraryCheckpointImportPage(page);
        request.deadline?.advanceRecords(receipt.stagedRecordCount);
        return receipt;
      },
    };
    const staged = await stageLibraryCoreNormalizedCheckpointV2({
      adapter, generation: pointer.generation, libraryId: pointer.libraryId, storageEpoch: pointer.storageEpoch,
      manifest: pointer.manifest, subtle: crypto.subtle, runtime,
    });
    await catchUpLibraryCorePredecessorCheckpointV1({
      adapter, subtle: crypto.subtle, successorStageId: staged.stageId, installedAt: Date.now(), stageOnly: true,
      assertActive: () => throwIfPublicationCanceled(request.signal),
      runtime: {
        ...runtime,
        prepare: prepareNormalizedLibraryPredecessorCheckpointRead,
        async appendPage(page) {
          const receipt = await runtime.appendPage(page);
          // The final checkpoint has already exhausted its record counter.
          // Distinct historical pages renew idle time without extending the total cap.
          request.deadline?.verifiedObject(`predecessor:${page.stageId}:${receipt.stagedRecordCount}`);
          return receipt;
        },
        async activate() { throw new Error("Source history must remain staged until verified demotion"); },
      },
    });
    const current = await readNormalizedLibraryHandoffStatus();
    if (!current || current.handoffId !== status.handoffId || current.phase !== "authorized"
      || current.installationRole !== "source" || current.canonicalAuthorization !== status.canonicalAuthorization
      || current.canonicalAuthorizationBody !== status.canonicalAuthorizationBody) {
      throw new Error("Source handoff changed during checkpoint download");
    }
    throwIfPublicationCanceled(request.signal);
    return { stageId: staged.stageId, canonicalControl: new TextDecoder().decode(encodeLibraryCoreCanonicalValue(pointer as unknown as LibraryCoreCanonicalValue)) };
  }, true);
}

/** Import only the immutable predecessor checkpoint named by accepted consent.
 * Native activation checks its complete logical digest before committing rows. */
export function catchUpSqliteLibraryHandoffTarget(input: {
  handoffId: string;
  accessToken: string;
  googleFetch?: GoogleDriveFetch;
  signal?: AbortSignal;
}): Promise<LibraryCoreNormalizedCheckpointExportDescriptorV2> {
  requireLibraryTransferCapability();
  return runBoundedPublication(input, async (request) => {
    const status = await readNormalizedLibraryHandoffStatus();
    if (!status || status.handoffId !== input.handoffId || status.installationRole !== "target"
      || status.phase !== "preparing" || status.canonicalAuthorization === null
      || status.canonicalAuthorizationBody === null) {
      throw new Error("Target catch-up requires accepted predecessor consent");
    }
    const body = decodeLibraryCoreCanonicalValue(exactBytes(new TextEncoder().encode(status.canonicalAuthorizationBody))) as {
      source_control?: unknown; source_control_revision?: unknown; source_control_file_id?: unknown; final_source_revision?: unknown;
    };
    const expected = parseLibraryCoreControlPointerV1(body.source_control);
    if (expected.libraryId !== status.libraryId || expected.storageEpoch !== status.predecessorEpochId
      || typeof body.source_control_revision !== "string" || typeof body.source_control_file_id !== "string"
      || !/^[A-Za-z0-9_-]{1,1024}$/.test(body.source_control_file_id) || !Number.isSafeInteger(body.final_source_revision)) {
      throw new Error("Target consent checkpoint identity is invalid");
    }
    const adapter = createGoogleDriveLibraryCoreAdapterV1({
      ...request, libraryId: status.libraryId, controlFileId: body.source_control_file_id,
    });
    const control = await adapter.readControl();
    const pointer = parseControl(control);
    if (!pointer || control.revision !== body.source_control_revision || !controlPointersEqual(pointer, expected)) {
      throw new Error("Cloud authority changed since the Primary authorized this handoff");
    }
    await importCloudCheckpointIntoSqlite({
      adapter, controlRevision: body.source_control_revision, pointer: expected,
      follower: true, signal: request.signal, deadline: request.deadline,
    });
    const checkpoint = await describeNormalizedLibraryCheckpoint();
    const current = await readNormalizedLibraryHandoffStatus();
    if (!current || current.handoffId !== status.handoffId || current.installationRole !== "target"
      || current.phase !== "preparing" || current.canonicalAuthorization !== status.canonicalAuthorization
      || current.canonicalAuthorizationBody !== status.canonicalAuthorizationBody
      || checkpoint.libraryId !== String(expected.libraryId) || checkpoint.authorityEpoch !== String(expected.storageEpoch)
      || checkpoint.writerId !== String(expected.writerId) || checkpoint.sourceRevision !== body.final_source_revision
      || checkpoint.causalFrontierDigest !== expected.causalFrontierDigest) {
      throw new Error("Target checkpoint or local handoff continuity could not be verified");
    }
    throwIfPublicationCanceled(request.signal);
    return checkpoint;
  }, true);
}

/** Publish a prepared successor while native admission remains fenced. Returning
 * a verified cloud pointer is not permission to activate the local writer. */
export function publishSqliteLibraryHandoffTarget(input: {
  handoffId: string; accessToken: string; googleFetch?: GoogleDriveFetch; signal?: AbortSignal;
}): Promise<{ controlPointer: LibraryCoreControlPointerV1; controlRevision: string }> {
  requireLibraryTransferCapability();
  return runBoundedPublication(input, (request) => withCheckpointExport(async () => {
    const initial = await readNormalizedLibraryHandoffStatus();
    if (!initial || initial.handoffId !== input.handoffId || initial.installationRole !== "target"
      || initial.phase !== "cas_pending" || initial.successorEpochId === null
      || initial.canonicalAuthorizationBody === null || initial.canonicalAuthorization === null) {
      throw new Error("Successor publication requires a staged, authorized target");
    }
    const body = decodeLibraryCoreCanonicalValue(exactBytes(new TextEncoder().encode(initial.canonicalAuthorizationBody))) as {
      source_control?: unknown; source_control_revision?: unknown; source_control_file_id?: unknown; final_source_revision?: unknown;
    };
    const predecessor = parseLibraryCoreControlPointerV1(body.source_control);
    if (String(predecessor.libraryId) !== initial.libraryId || String(predecessor.storageEpoch) !== initial.predecessorEpochId
      || typeof body.source_control_revision !== "string" || typeof body.source_control_file_id !== "string"
      || !/^[A-Za-z0-9_-]{1,1024}$/.test(body.source_control_file_id) || !Number.isSafeInteger(body.final_source_revision)) {
      throw new Error("Successor publication predecessor consent is invalid");
    }
    const expectedRevision = body.source_control_revision;
    const requireTarget = async () => {
      throwIfPublicationCanceled(request.signal);
      const current = await readNormalizedLibraryHandoffStatus();
      if (!current || current.handoffId !== initial.handoffId || current.phase !== "cas_pending"
        || current.installationRole !== "target" || current.successorEpochId !== initial.successorEpochId
        || current.canonicalAuthorization !== initial.canonicalAuthorization
        || current.canonicalAuthorizationBody !== initial.canonicalAuthorizationBody) {
        throw new Error("Staged target changed during publication");
      }
      return current;
    };
    const matches = (read: LibraryCoreControlReadV1, expected: LibraryCoreControlPointerV1) => {
      const pointer = parseControl(read);
      return pointer !== null && controlPointersEqual(pointer, expected);
    };
    const encode = (value: unknown) => new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue));
    // A persisted proposal fixes transport object IDs as well as content digests.
    // Recover it directly; rebuilding a manifest could create another identity.
    if (initial.canonicalActivation !== null) {
      const proposal = decodeLibraryCoreCanonicalValue(exactBytes(new TextEncoder().encode(initial.canonicalActivation))) as {
        format?: unknown; handoff_id?: unknown; control_file_id?: unknown;
        expected_control_revision?: unknown; control?: unknown;
      };
      if (proposal.format !== "freed_library_handoff_activation_proposal_v1" || proposal.handoff_id !== input.handoffId
        || proposal.control_file_id !== body.source_control_file_id || proposal.expected_control_revision !== expectedRevision) {
        throw new Error("Persisted activation proposal is invalid");
      }
      const target = parseLibraryCoreControlPointerV1(proposal.control);
      const canonicalControl = encode(target);
      const native = await prepareNormalizedLibraryHandoffActivation(input.handoffId, proposal.control_file_id, canonicalControl);
      if (native !== initial.canonicalActivation) throw new Error("Native activation proposal changed");
      const adapter = createGoogleDriveLibraryCoreAdapterV1({ ...request,
        libraryId: initial.libraryId, controlFileId: proposal.control_file_id });
      let read = await adapter.readControl();
      if (!matches(read, target)) {
        if (read.revision !== expectedRevision || !matches(read, predecessor)) {
          throw new Error("Another authority change won the handoff");
        }
        await requireTarget();
        try {
          await adapter.compareAndSwapControl({ expectedRevision, bytes: new TextEncoder().encode(canonicalControl) });
        } catch {
          // A failed response is ambiguous. Only an exact durable readback wins.
        }
        read = await adapter.readControl();
      }
      if (read.revision === null || !matches(read, target)) {
        throw new Error("Proposed successor cloud head could not be verified");
      }
      await requireTarget();
      return { controlPointer: target, controlRevision: read.revision };
    }
    const certificate = await stageNormalizedLibraryTargetHandoff(input.handoffId);
    const checkpoint = await beginNormalizedLibraryCheckpointExport(input.handoffId);
    if (checkpoint.libraryId !== initial.libraryId || checkpoint.authorityEpoch !== initial.successorEpochId
      || checkpoint.sourceRevision !== body.final_source_revision) {
      throw new Error("Successor checkpoint does not match the staged transfer");
    }
    const controlFileId = body.source_control_file_id;
    const adapter = createGoogleDriveLibraryCoreAdapterV1({ ...request,
      libraryId: initial.libraryId, controlFileId });
    request.deadline?.beginCheckpoint(checkpoint.recordCount);
    const result = await reassignLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1",
      adapter: { ...adapter, async compareAndSwapControl(change) {
        await requireTarget();
        if (change.expectedRevision !== expectedRevision) throw new Error("Handoff predecessor revision changed");
        const canonicalControl = new TextDecoder("utf-8", { fatal: true }).decode(change.bytes);
        const proposal = await prepareNormalizedLibraryHandoffActivation(input.handoffId, controlFileId, canonicalControl);
        const current = await requireTarget();
        if (current.canonicalActivation !== proposal) throw new Error("Activation proposal was not durably recorded");
        return adapter.compareAndSwapControl(change);
      }, async verifyImmutable(receipt) {
        const verified = await adapter.verifyImmutable(receipt);
        if (verified.objectKey === receipt.descriptor.objectKey && verified.contentDigest === receipt.descriptor.contentDigest
          && verified.byteLength === receipt.descriptor.byteLength) request.deadline?.verifiedObject(verified.objectKey);
        return verified;
      } },
      descriptor: checkpoint,
      epochCertificate: await prepareWriterEpochCertificate({ canonicalCertificateJson: certificate,
        libraryId: initial.libraryId, targetStorageEpoch: initial.successorEpochId }),
      expectedControl: { pointer: predecessor, revision: expectedRevision }, generation: 0,
      handoffFrontiers: { kind: "cooperative_handoff_v1", predecessor: predecessor.causalFrontierDigest,
        successor: checkpoint.causalFrontierDigest },
      records: normalizedCheckpointRecords(checkpoint, request.signal, request.deadline?.advanceRecords, input.handoffId),
      subtle: crypto.subtle,
    });
    if (result.status === "conflict") throw new Error("Cloud authority changed during handoff publication");
    const read = await adapter.readControl();
    if (read.revision === null || read.revision !== result.revision || !matches(read, result.controlPointer)) {
      throw new Error("Successor cloud head could not be verified");
    }
    await requireTarget();
    return { controlPointer: result.controlPointer, controlRevision: read.revision };
  }), true);
}

let activePublication: Promise<LibraryCoreCloudPublishResult> | null = null;

export function publishCurrentSqliteLibraryToGoogleDrive(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  requirePrimaryLibraryCoreDesktopRole();
  if (input.signal?.aborted) {
    return Promise.reject(
      publicationAbortError("SQLite Library publication was canceled."),
    );
  }
  // Manual Sync now and the periodic coordinator must not replace each other's
  // native export cursor or race the same Drive control publication.
  if (activePublication !== null) return activePublication;
  if (checkpointExportInProgress) {
    return Promise.reject(checkpointExportBusyError());
  }
  const publication = runBoundedPublication(input, publishCurrentSqliteLibraryToGoogleDriveInternal).finally(() => {
    if (activePublication === publication) activePublication = null;
  });
  activePublication = publication;
  return publication;
}

async function prepareDesktopNormalizedFollowerEnrollment() {
  const status = await readNormalizedLibraryFollowerRuntimeStatus();
  if (status.state === "authority_recovery_required") {
    throw new Error("Primary changed. Previous enrollment and edits are preserved; recover enrollment before syncing edits.");
  }
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

let activeFollowerPass: Promise<LibraryCoreCloudPublishResult> | null = null;

export function syncSqliteLibraryFollowerGoogleDriveOnce(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  if (input.signal?.aborted) return Promise.reject(publicationAbortError("SQLite Library sync was canceled."));
  if (activeFollowerPass !== null) return activeFollowerPass;
  const pass = runBoundedPublication(input, syncSqliteLibraryFollowerGoogleDriveOnceInternal).finally(() => {
    if (activeFollowerPass === pass) activeFollowerPass = null;
  });
  activeFollowerPass = pass;
  return pass;
}

async function syncSqliteLibraryFollowerGoogleDriveOnceInternal(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
  readonly deadline?: ReturnType<typeof createCheckpointPublicationDeadline>;
}): Promise<LibraryCoreCloudPublishResult> {
  throwIfPublicationCanceled(input.signal);
  const installation = await refreshLibraryCoreDesktopRole();
  throwIfPublicationCanceled(input.signal);
  requireFollowerLibraryCoreDesktopRole();
  if (!installation.libraryId) throw new Error("Select a Library before consumer sync.");
  const discovered = await discoverPublishedGoogleDriveLibraryCoreControlV1({
    libraryId: installation.libraryId,
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
  throwIfPublicationCanceled(input.signal);
  if (
    before.libraryId !== pointer.libraryId ||
    before.authorityEpochId !== pointer.storageEpoch ||
    before.checkpointGeneration !== pointer.generation
  ) {
    await bootstrapCloudCheckpointIntoSqlite({
      adapter,
      controlRevision: control.revision,
      follower: true,
      signal: input.signal,
      deadline: input.deadline,
      pointer,
    });
  }
  const enrollment = await readNormalizedLibraryFollowerRuntimeStatus();
  // Recovery keeps the new canonical replica readable, but old signed intents
  // must not be relabeled or submitted through the successor's enrollment.
  if (enrollment.state !== "authority_recovery_required") {
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
  }
  throwIfPublicationCanceled(input.signal);
  const replica = await readNormalizedLibraryFollowerRuntimeStatus();
  const operationHeadFileId = await discoverGoogleDriveLibraryCoreOperationHeadV2({
    accessToken: input.accessToken, libraryId: pointer.libraryId, epochId: pointer.storageEpoch,
    googleFetch: input.googleFetch, signal: input.signal,
  });
  if (operationHeadFileId && replica.sourceRevision !== null) {
    await syncLibraryCoreNormalizedOperationsOnceV2({
      anchor: { libraryId: pointer.libraryId, storageEpoch: pointer.storageEpoch, writerId: pointer.writerId,
        checkpointDigest: pointer.manifest.descriptor.contentDigest, checkpointRevision: replica.sourceRevision },
      transport: createGoogleDriveLibraryCoreOperationAdapterV2({
        accessToken: input.accessToken, libraryId: pointer.libraryId, epochId: pointer.storageEpoch,
        writerId: pointer.writerId, controlFileId: discovered.controlFileId, operationHeadFileId,
        googleFetch: input.googleFetch, signal: input.signal,
      }),
      runtime: {
        async readRevision() {
          const response = await queryNormalizedLibrary({ entityIds: [],
            queryId: LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
            schemaVersion: LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION });
          return response.source.projectionRevision;
        },
        importPage: importNormalizedLibraryOperationPage,
      },
      now: Date.now, signal: input.signal,
    });
  }
  const descriptor = await describeNormalizedLibraryCloudIdentity();
  throwIfPublicationCanceled(input.signal);
  const follower = await readNormalizedLibraryFollowerRuntimeStatus();
  throwIfPublicationCanceled(input.signal);
  return { status: "follower_synced", revision: descriptor.sourceRevision, follower };
}

export async function startSqliteLibraryGoogleDriveFollowerSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly onError?: (error: unknown) => void;
  readonly onSynced?: (result: LibraryCoreCloudPublishResult) => Promise<void>;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  requireOrdinarySyncAllowed();
  stopSqliteLibraryCloudSync();
  const abortController = new AbortController();
  running = { abortController, timer: null };
  const sync = (accessToken: string) =>
    syncSqliteLibraryFollowerGoogleDriveOnce({
      accessToken,
      googleFetch: input.googleFetch,
      signal: abortController.signal,
    });
  const ownsLifecycle = () => running?.abortController === abortController && !abortController.signal.aborted;
  const scheduleNext = () => {
    if (ownsLifecycle()) {
      running!.timer = setTimeout(() => void poll().catch(console.error), FOLLOWER_SYNC_POLL_MS);
    }
  };
  const notifySynced = async (result: LibraryCoreCloudPublishResult) => {
    if (ownsLifecycle()) await input.onSynced?.(result);
  };
  const poll = async (): Promise<void> => {
    if (!ownsLifecycle()) return;
    if (readLibraryCoreDesktopRole() !== "follower") {
      stopSqliteLibraryCloudSync();
      return;
    }
    try {
      const result = await sync(await input.resolveAccessToken());
      await notifySynced(result);
    } catch (error) {
      if (ownsLifecycle()) input.onError?.(error);
      throw error;
    } finally {
      scheduleNext();
    }
  };
  try {
    const initial = await sync(input.accessToken);
    await notifySynced(initial);
    return initial;
  } catch (error) {
    if (ownsLifecycle()) input.onError?.(error);
    throw error;
  } finally {
    scheduleNext();
  }
}

export async function startSqliteLibraryGoogleDriveSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  requireOrdinarySyncAllowed();
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
          lastPublishedRevision: state.lastPublishedOperationRevision ?? state.lastPublishedRevision,
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
  activeSyncAbort?.();
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
