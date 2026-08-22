import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreIntentHeadV1,
  parseLibraryCoreResultHeadV1,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreResultHeadV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createLibraryCorePrimaryCoordinatorV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  createGoogleDriveLibraryCoreResultAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCoreIntentSegmentV1,
  importLibraryCoreResultSegmentV1,
  importLibraryCorePortableCheckpointV1,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
  provisionGoogleDriveLibraryCoreResultHeadV1,
  prepareLibraryCoreIntentSegmentV1,
  publishLibraryCoreIntentCandidateV1,
  publishLibraryCoreNormalizedCheckpointV2,
  publishLibraryCoreResultEntriesV1,
  reassignLibraryCoreNormalizedCheckpointV2,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePreparedImmutableObjectV1,
} from "@freed/sync/cloud/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud/library-core";
import { recordCloudProviderEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";
import {
  appendPortableSqliteLibraryItems,
  appendSqliteLibraryFollowerResultSegment,
  acknowledgePwaIntentResultOutbox,
  acceptPwaActorEnrollmentRequest,
  acceptPwaIntentTransaction,
  beginPortableSqliteLibraryImport,
  bootstrapSqliteLibraryAuthority,
  createSqliteLibraryBackup,
  describeNormalizedLibraryCheckpoint,
  finalizePortableSqliteLibraryImport,
  installSqliteLibraryFollowerActorEnrollment,
  listSqliteLibraryActorEnrollments,
  readSqliteLibrarySyncDescriptor,
  readNormalizedLibraryCheckpointPage,
  readPwaIntentResultOutbox,
  prepareSqliteLibraryFollowerActorRequest,
  readSqliteLibraryFollowerIntentOutboxCandidate,
  readSqliteLibraryFollowerResultImportCursor,
  readSqliteLibraryFollowerRuntimeStatus,
  reassignNormalizedLibraryWriterEpoch,
  restoreSqliteLibraryBackup,
  recordSqliteLibraryFollowerIntentPublication,
  setSqliteLibraryCloudWriterAdmission,
  sqliteLibraryStatus,
  type SqliteLibrarySyncDescriptor,
  type SqliteLibraryAuthorityBootstrap,
  type SqliteLibraryActorCheckpointState,
  type SqliteLibraryFollowerCheckpointActor,
  type SqliteLibraryIntentResultOutboxEntry,
  type SqliteLibraryPersistedCloudIdentity,
} from "./sqlite-library";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";
import {
  readLibraryCoreDesktopRole,
  requireFollowerLibraryCoreDesktopRole,
  requirePrimaryLibraryCoreDesktopRole,
} from "./library-core-desktop-role";

const STATE_FILE = "library-core-cloud.json";
const STATE_KEY = "state";
const FOLLOWER_SYNC_POLL_MS = 60_000;
const PUBLICATION_TIMEOUT_MS = 5 * 60_000;
const ACTIVATION_KEY = "freed.libraryCore.immutableGoogleDriveV1.enabled";
const EMPTY_LIBRARY_SOURCE_DIGEST = "0".repeat(64);

interface LocalLibraryCoreCloudStateV1 {
  readonly version: 1;
  readonly libraryId: string;
  readonly sourceDigest: string;
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

function isCloudState(value: unknown): value is LocalLibraryCoreCloudStateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LocalLibraryCoreCloudStateV1>;
  return (
    candidate.version === 1 &&
    typeof candidate.libraryId === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.libraryId) &&
    typeof candidate.sourceDigest === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.sourceDigest) &&
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
export async function readPersistedSqliteLibraryCloudIdentity(): Promise<
  SqliteLibraryPersistedCloudIdentity | null
> {
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (stored === null || stored === undefined) return null;
  if (!isCloudState(stored)) {
    throw new Error("The saved Library Core cloud identity is invalid");
  }
  return Object.freeze({
    libraryId: stored.libraryId,
    storageEpoch: stored.storageEpoch,
    writerId: stored.writerId,
    sourceDigest: stored.sourceDigest,
  });
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
  state: LocalLibraryCoreCloudStateV1,
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
  descriptor: SqliteLibrarySyncDescriptor,
): Promise<{
  readonly state: LocalLibraryCoreCloudStateV1;
  readonly currentWriterId: string;
  readonly bootstrap: SqliteLibraryAuthorityBootstrap;
}> {
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (stored !== null && stored !== undefined && !isCloudState(stored)) {
    throw new Error("The saved Library Core cloud identity is invalid");
  }
  let reusableState: LocalLibraryCoreCloudStateV1 | null = null;
  if (isCloudState(stored)) {
    if (stored.sourceDigest !== descriptor.sourceDigest) {
      if (
        stored.sourceDigest !== EMPTY_LIBRARY_SOURCE_DIGEST ||
        stored.lastPublishedRevision !== null
      ) {
        throw new Error(
          "The saved Library Core cloud identity belongs to another Library",
        );
      }
    } else {
      reusableState = Object.freeze({
        ...stored,
        lastPublishedActorDigest: stored.lastPublishedActorDigest ?? null,
        lastPublishedCheckpoint: checkpointReceiptForState(stored),
      });
    }
  }
  const bootstrap = await bootstrapSqliteLibraryAuthority({
    descriptor,
    persistedCloudIdentity:
      reusableState === null
        ? null
        : {
            libraryId: reusableState.libraryId,
            storageEpoch: reusableState.storageEpoch,
            writerId: reusableState.writerId,
            sourceDigest: reusableState.sourceDigest,
          },
  });
  const currentWriterId = bootstrap.actor.actor_id;
  if (reusableState !== null) {
    if (
      reusableState.libraryId !== bootstrap.authority.library_id ||
      reusableState.storageEpoch !== bootstrap.authority.epoch_id
    ) {
      throw new Error(
        "The saved Library Core cloud identity conflicts with accepted authority",
      );
    }
    return { state: reusableState, currentWriterId, bootstrap };
  }
  const state: LocalLibraryCoreCloudStateV1 = Object.freeze({
    version: 1,
    libraryId: bootstrap.authority.library_id,
    sourceDigest: descriptor.sourceDigest,
    storageEpoch: bootstrap.authority.epoch_id,
    writerId: currentWriterId,
    controlFileId: null,
    lastPublishedRevision: null,
    lastPublishedActorDigest: null,
    lastPublishedCheckpoint: null,
  });
  await persistCloudState(state);
  return { state, currentWriterId, bootstrap };
}

async function persistCloudState(
  state: LocalLibraryCoreCloudStateV1,
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
  return Object.freeze({
    version: 1,
    localRevision: input.localRevision,
    itemCount: input.itemCount,
    checkpointStoredByteLength: input.checkpointStoredByteLength,
    controlRevision: input.controlRevision,
    publishedAt: Date.now(),
    controlPointer: input.controlPointer,
  });
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
  let after: Parameters<typeof readNormalizedLibraryCheckpointPage>[0]["after"] =
    null;
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
  return Object.freeze({
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
  });
}

async function actorStateDigest(
  actors: readonly SqliteLibraryActorCheckpointState[],
): Promise<string> {
  return sha256Bytes(
    encodeLibraryCoreCanonicalValue(
      actors.map((actor) => ({
        accepted_chain_digest: actor.accepted_chain_digest,
        accepted_operation_id: actor.accepted_operation_id,
        accepted_sequence: actor.accepted_sequence,
        actor_id: actor.actor_id,
        enrollment_certificate_digest: actor.enrollment_certificate_digest,
      })),
    ),
  );
}

async function publishActorEnrollmentCertificates(input: {
  readonly actors: readonly SqliteLibraryActorCheckpointState[];
  readonly adapter: ReturnType<typeof createGoogleDriveLibraryCoreAdapterV1>;
  readonly epochId: string;
  readonly libraryId: string;
}): Promise<void> {
  for (const actor of input.actors) {
    const source = new TextEncoder().encode(
      actor.canonical_enrollment_certificate_json,
    );
    const contentDigest = await sha256Bytes(source);
    const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: source.byteLength,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: actor.actor_id,
        digest: contentDigest,
        epochId: input.epochId,
        kind: "actor_enrollment",
        libraryId: input.libraryId,
      }),
    });
    const uploaded = await input.adapter.putImmutable({ descriptor, source });
    await input.adapter.verifyImmutable({
      descriptor,
      transportObjectId: uploaded.transportObjectId,
    });
  }
}

async function acceptPendingPwaActorEnrollments(input: {
  readonly accessToken: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const requests =
    await discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1(input);
  for (const request of requests) {
    await acceptPwaActorEnrollmentRequest(request.bytes);
  }
}

function canonicalIntentTransactions(
  entries: readonly Readonly<{
    readonly canonical_envelope: Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
  }>[],
): readonly (readonly string[])[] {
  const transactions: string[][] = [];
  for (let index = 0; index < entries.length;) {
    const first = entries[index]!.canonical_envelope;
    const transactionId = first.transaction_id;
    const memberCount = first.transaction_member_count;
    if (
      typeof transactionId !== "string" ||
      !Number.isSafeInteger(memberCount) ||
      typeof memberCount !== "number" ||
      memberCount < 1 ||
      index + memberCount > entries.length ||
      first.transaction_member_index !== 0
    ) {
      throw new Error("PWA intent segment splits a canonical transaction");
    }
    const members = entries.slice(index, index + memberCount);
    for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
      const envelope = members[memberIndex]!.canonical_envelope;
      if (
        envelope.transaction_id !== transactionId ||
        envelope.transaction_member_count !== memberCount ||
        envelope.transaction_member_index !== memberIndex
      ) {
        throw new Error("PWA intent transaction members are reordered");
      }
    }
    transactions.push(
      members.map((member) =>
        new TextDecoder("utf-8", { fatal: true }).decode(
          encodeLibraryCoreCanonicalValue(
            member.canonical_envelope as LibraryCoreCanonicalValue,
          ),
        ),
      ),
    );
    index += memberCount;
  }
  return Object.freeze(
    transactions.map((transaction) => Object.freeze(transaction)),
  );
}

async function acceptPendingPwaReadIntents(input: {
  readonly accessToken: string;
  readonly actors: readonly SqliteLibraryActorCheckpointState[];
  readonly controlFileId: string;
  readonly desktopActorId: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  for (const actor of input.actors) {
    if (actor.actor_id === input.desktopActorId || actor.retired) continue;
    const locator = await discoverGoogleDriveLibraryCoreIntentHeadV1({
      accessToken: input.accessToken,
      actorId: actor.actor_id,
      epochId: input.epochId,
      googleFetch: input.googleFetch,
      libraryId: input.libraryId,
      signal: input.signal,
    });
    if (locator === null) continue;
    const adapter = createGoogleDriveLibraryCoreIntentAdapterV1({
      accessToken: input.accessToken,
      actorId: actor.actor_id,
      controlFileId: input.controlFileId,
      epochId: input.epochId,
      googleFetch: input.googleFetch,
      intentHeadFileId: locator.intentHeadFileId,
      libraryId: input.libraryId,
      signal: input.signal,
    });
    const head = await adapter.readIntentHead();
    if (head.head.epoch_id !== input.epochId) {
      throw new Error("PWA intent head belongs to a retired writer epoch");
    }
    const publishedThrough = head.head.next_intent_sequence - 1;
    if (publishedThrough <= actor.accepted_sequence) continue;
    const segments = await discoverGoogleDriveLibraryCoreIntentSegmentsV1({
      accessToken: input.accessToken,
      actorId: actor.actor_id,
      epochId: input.epochId,
      googleFetch: input.googleFetch,
      libraryId: input.libraryId,
      signal: input.signal,
    });
    if (segments.length === 0 || head.head.latest_segment === null) {
      throw new Error("PWA intent head references a missing immutable segment");
    }
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const previous = segments[index - 1];
      if (
        segment.firstIntentSequence !==
          (previous?.lastIntentSequence ?? 0) + 1 ||
        segment.lastIntentSequence >= head.head.next_intent_sequence
      ) {
        throw new Error("PWA intent segment chain has a gap or overlap");
      }
    }
    const latest = segments.at(-1)!;
    if (
      latest.lastIntentSequence !== publishedThrough ||
      latest.reference.descriptor.contentDigest !==
        head.head.latest_segment.descriptor.contentDigest ||
      latest.reference.descriptor.objectKey !==
        head.head.latest_segment.descriptor.objectKey ||
      latest.reference.transportObjectId !==
        head.head.latest_segment.transportObjectId
    ) {
      throw new Error("PWA intent segments do not match the actor head");
    }
    const firstPendingIndex = segments.findIndex(
      (segment) => segment.lastIntentSequence > actor.accepted_sequence,
    );
    if (firstPendingIndex < 0) continue;
    for (let index = firstPendingIndex; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const previous = segments[index - 1];
      await importLibraryCoreIntentSegmentV1({
        actorId: actor.actor_id,
        adapter,
        expectedFirstIntentSequence: segment.firstIntentSequence,
        expectedPreviousSegmentDigest:
          previous?.reference.descriptor.contentDigest ?? null,
        libraryId: input.libraryId,
        reference: segment.reference,
        storageEpoch: input.epochId,
        subtle: crypto.subtle,
        writer: {
          async appendIntentSegment({ entries, header }) {
            for (const transaction of canonicalIntentTransactions(entries)) {
              await acceptPwaIntentTransaction(transaction);
            }
            return Object.freeze({
              actorId: header.actor_id,
              firstIntentSequence: header.first_intent_sequence,
              importedOperationCount: header.operation_count,
              lastIntentSequence: header.last_intent_sequence,
              segmentDigest: header.segment_digest,
            });
          },
        },
      });
    }
  }
}

function resultEntryMatches(
  local: SqliteLibraryIntentResultOutboxEntry,
  remote: Readonly<{
    actor_id: string;
    intent_operation_id: string;
    intent_sequence: number;
    provider_receipt_digest: string | null;
    result_operation_id: string;
    result_sequence: number;
    status: "accepted" | "provider_completed" | "provider_failed";
  }>,
): boolean {
  return (
    local.actorId === remote.actor_id &&
    local.intentOperationId === remote.intent_operation_id &&
    local.intentSequence === remote.intent_sequence &&
    local.providerReceiptDigest === remote.provider_receipt_digest &&
    local.resultOperationId === remote.result_operation_id &&
    local.resultSequence === remote.result_sequence &&
    local.status === remote.status
  );
}

async function verifyPublishedResultPrefix(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly adapter: ReturnType<
    typeof createGoogleDriveLibraryCoreResultAdapterV1
  >;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly head: LibraryCoreResultHeadV1;
  readonly libraryId: string;
  readonly pending: readonly SqliteLibraryIntentResultOutboxEntry[];
  readonly signal?: AbortSignal;
}): Promise<readonly string[]> {
  if (input.head.next_result_sequence === 1) return Object.freeze([]);
  const segments = await discoverGoogleDriveLibraryCoreResultSegmentsV1({
    accessToken: input.accessToken,
    actorId: input.actorId,
    epochId: input.epochId,
    googleFetch: input.googleFetch,
    libraryId: input.libraryId,
    signal: input.signal,
  });
  const pendingBySequence = new Map(
    input.pending.map((entry) => [entry.resultSequence, entry] as const),
  );
  const confirmed = new Set<string>();
  let nextSequence = 1;
  let previousDigest: LibraryCoreResultHeadV1["latest_segment_digest"] = null;
  for (const segment of segments) {
    if (segment.firstResultSequence !== nextSequence) {
      throw new Error("PWA result segment chain has a gap or overlap");
    }
    await importLibraryCoreResultSegmentV1({
      actorId: input.actorId,
      adapter: input.adapter,
      expectedFirstResultSequence: nextSequence,
      expectedPreviousSegmentDigest: previousDigest,
      libraryId: input.libraryId,
      reference: segment.reference,
      storageEpoch: input.epochId,
      subtle: crypto.subtle,
      writer: {
        async appendResultSegment({ entries }) {
          for (const remote of entries) {
            const local = pendingBySequence.get(remote.result_sequence);
            if (local && !resultEntryMatches(local, remote)) {
              throw new Error(
                "published PWA result differs from the durable SQLite receipt",
              );
            }
            if (local) confirmed.add(local.resultOperationId);
          }
        },
      },
    });
    nextSequence = segment.lastResultSequence + 1;
    previousDigest = segment.reference.descriptor.contentDigest;
    if (nextSequence >= input.head.next_result_sequence) break;
  }
  if (
    nextSequence !== input.head.next_result_sequence ||
    previousDigest !== input.head.latest_segment_digest
  ) {
    throw new Error("PWA result objects do not match the actor result head");
  }
  for (const local of input.pending) {
    if (
      local.resultSequence < input.head.next_result_sequence &&
      !confirmed.has(local.resultOperationId)
    ) {
      throw new Error(
        "published PWA result head omits a durable SQLite receipt",
      );
    }
  }
  return Object.freeze([...confirmed]);
}

async function flushPwaIntentResultOutbox(input: {
  readonly accessToken: string;
  readonly controlFileId: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  for (let page = 0; page < 100; page += 1) {
    const pending = await readPwaIntentResultOutbox(
      {
        epochId: input.epochId,
        libraryId: input.libraryId,
      },
      256,
    );
    if (pending.length === 0) return;
    const actorIds = [...new Set(pending.map((entry) => entry.actorId))].sort();
    for (const actorId of actorIds) {
      const actorEntries = pending
        .filter((entry) => entry.actorId === actorId)
        .sort((left, right) => left.resultSequence - right.resultSequence);
      let locator = await discoverGoogleDriveLibraryCoreResultHeadV1({
        accessToken: input.accessToken,
        actorId,
        epochId: input.epochId,
        googleFetch: input.googleFetch,
        libraryId: input.libraryId,
        signal: input.signal,
      });
      if (locator === null) {
        locator = await provisionGoogleDriveLibraryCoreResultHeadV1({
          accessToken: input.accessToken,
          googleFetch: input.googleFetch,
          head: parseLibraryCoreResultHeadV1({
            actor_id: actorId,
            epoch_id: input.epochId,
            latest_segment: null,
            latest_segment_digest: null,
            library_id: input.libraryId,
            next_result_sequence: 1,
            protocol: "result_head_v1",
            protocol_version: 1,
            schema_version: 1,
          }),
          signal: input.signal,
        });
      }
      const adapter = createGoogleDriveLibraryCoreResultAdapterV1({
        accessToken: input.accessToken,
        actorId,
        controlFileId: input.controlFileId,
        epochId: input.epochId,
        googleFetch: input.googleFetch,
        libraryId: input.libraryId,
        resultHeadFileId: locator.resultHeadFileId,
        signal: input.signal,
      });
      let head = (await adapter.readResultHead()).head;
      if (head.epoch_id !== input.epochId) {
        throw new Error("PWA result head belongs to a retired writer epoch");
      }
      const recovered = await verifyPublishedResultPrefix({
        accessToken: input.accessToken,
        actorId,
        adapter,
        epochId: input.epochId,
        googleFetch: input.googleFetch,
        head,
        libraryId: input.libraryId,
        pending: actorEntries,
        signal: input.signal,
      });
      if (recovered.length > 0) {
        await acknowledgePwaIntentResultOutbox(recovered);
      }
      const unpublished = actorEntries.filter(
        (entry) => entry.resultSequence >= head.next_result_sequence,
      );
      if (unpublished.length === 0) continue;
      if (unpublished[0]!.resultSequence !== head.next_result_sequence) {
        throw new Error(
          "durable PWA result outbox does not extend the cloud result head",
        );
      }
      await publishLibraryCoreResultEntriesV1({
        adapter,
        entries: unpublished,
        subtle: crypto.subtle,
      });
      await acknowledgePwaIntentResultOutbox(
        unpublished.map((entry) => entry.resultOperationId),
      );
      head = (await adapter.readResultHead()).head;
      if (
        head.next_result_sequence !==
        unpublished.at(-1)!.resultSequence + 1
      ) {
        throw new Error(
          "PWA result head did not advance through published receipts",
        );
      }
    }
  }
  throw new Error("PWA result outbox exceeded the bounded flush budget");
}

function materializedRow(record: LibraryCorePortableCheckpointRecordV1): {
  readonly registryKey: string;
  readonly row: unknown;
} | null {
  if (record.kind === "logical_checkpoint_header") return null;
  // Actor state authenticates the checkpoint and its operation frontier, but
  // it belongs to the retiring writer epoch. A restored Desktop creates a
  // fresh epoch and actor after importing the materialized Library, so these
  // rows must be verified by the portable checkpoint reader and then omitted
  // from the new local authority instead of making ownership transfer
  // impossible for every real checkpoint.
  if (record.collection === "actor_states") return null;
  if (record.collection !== "materialized_rows") {
    throw new Error(
      `SQLite cloud import does not support ${record.collection} checkpoint rows yet`,
    );
  }
  const value = record.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite cloud import materialized row is invalid");
  }
  const row = value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  if (typeof row.registry_key !== "string" || !("row" in row)) {
    throw new Error("SQLite cloud import materialized row is invalid");
  }
  return { registryKey: row.registry_key, row: row.row };
}

async function bootstrapCloudCheckpointIntoSqlite(input: {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly pointer: LibraryCoreControlPointerV1;
  readonly sourceDigest: string;
  readonly follower?: Readonly<{
    controlRevision: string;
    actorId: string | null;
  }>;
}): Promise<SqliteLibrarySyncDescriptor> {
  const previousStatus = await sqliteLibraryStatus();
  const backup =
    previousStatus?.active === true
      ? await createSqliteLibraryBackup("manual")
      : null;
  let nativeImportStarted = false;
  let importedHeader: LibraryCorePortableCheckpointHeaderV1 | null = null;
  let checkpointActor: SqliteLibraryFollowerCheckpointActor | null = null;
  try {
    await importLibraryCorePortableCheckpointV1({
      adapter: input.adapter,
      generation: input.pointer.generation,
      libraryId: input.pointer.libraryId,
      manifest: input.pointer.manifest,
      storageEpoch: input.pointer.storageEpoch,
      subtle: crypto.subtle,
      writer: {
        async beginImport() {
          return "import";
        },
        async appendPage(pageIndex, records) {
          const feedItems: unknown[] = [];
          for (const record of records) {
            if (
              record.kind !== "logical_checkpoint_entry" ||
              record.collection !== "actor_states" ||
              input.follower?.actorId === null
            ) {
              continue;
            }
            const value = record.value as Readonly<
              Record<string, LibraryCoreCanonicalValue>
            >;
            if (value.actor_id === input.follower?.actorId) {
              checkpointActor = {
                actor_id: String(value.actor_id),
                accepted_sequence: Number(value.accepted_sequence),
                accepted_operation_id:
                  value.accepted_operation_id === null
                    ? null
                    : String(value.accepted_operation_id),
                accepted_chain_digest: String(value.accepted_chain_digest),
                enrollment_certificate_digest: String(
                  value.enrollment_certificate_digest,
                ),
              };
            }
          }
          if (!nativeImportStarted) {
            if (
              pageIndex !== 0 ||
              records[0]?.kind !== "logical_checkpoint_header"
            ) {
              throw new Error(
                "SQLite cloud import did not begin with its logical header",
              );
            }
            const header = records[0];
            const unsupportedCount = Object.entries(
              header.collection_counts,
            ).some(
              ([collection, count]) =>
                collection !== "materialized_rows" &&
                collection !== "actor_states" &&
                count !== 0,
            );
            if (unsupportedCount) {
              throw new Error(
                "SQLite cloud import contains unsupported Library collections",
              );
            }
            const rows = records
              .slice(1)
              .map(materializedRow)
              .filter((row) => row !== null);
            const shell = rows.find(
              (row) => row.registryKey === "00_library_shell",
            );
            if (shell === undefined) {
              throw new Error(
                "SQLite cloud import is missing the Library shell",
              );
            }
            await beginPortableSqliteLibraryImport({
              expectedItemCount: header.collection_counts.materialized_rows - 1,
              shell: shell.row,
              sourceCheckpoint: {
                objectKey: input.pointer.manifest.descriptor.objectKey,
                contentDigest: input.pointer.manifest.descriptor.contentDigest,
                transportObjectId: input.pointer.manifest.transportObjectId,
              },
              sourceDigest: input.sourceDigest,
              sourceGeneration: header.epoch,
              sourceRevision: header.materializer_position.ingest_sequence,
            });
            nativeImportStarted = true;
            importedHeader = header;
            for (const row of rows) {
              if (row.registryKey === "10_feed_items") feedItems.push(row.row);
              else if (row.registryKey !== "00_library_shell") {
                throw new Error(
                  `SQLite cloud import does not support ${row.registryKey}`,
                );
              }
            }
          } else {
            for (const record of records) {
              if (
                record.kind === "logical_checkpoint_entry" &&
                record.collection === "actor_states"
              ) {
                continue;
              }
              const row = materializedRow(record);
              if (row === null) {
                throw new Error(
                  "SQLite cloud import repeats its logical header",
                );
              }
              if (row.registryKey !== "10_feed_items") {
                throw new Error(
                  `SQLite cloud import does not support ${row.registryKey}`,
                );
              }
              feedItems.push(row.row);
            }
          }
          await appendPortableSqliteLibraryItems(feedItems);
        },
        async finalizeImport({ header, manifest }) {
          if (!nativeImportStarted || importedHeader === null) {
            throw new Error(
              "SQLite cloud import never initialized native staging",
            );
          }
          if (
            input.follower !== undefined &&
            header.accepted_authority === null
          ) {
            throw new Error(
              "Follower checkpoint has no accepted authority anchor",
            );
          }
          await finalizePortableSqliteLibraryImport(
            input.follower === undefined
              ? undefined
              : {
                  authority: header.accepted_authority!,
                  manifestObjectKey: input.pointer.manifest.descriptor.objectKey,
                  manifestTransportObjectId:
                    input.pointer.manifest.transportObjectId,
                  manifestContentDigest:
                    input.pointer.manifest.descriptor.contentDigest,
                  generation: input.pointer.generation,
                  remoteIngestSequence:
                    header.materializer_position.ingest_sequence,
                  remoteMaterializedDigest:
                    header.materializer_position.materialized_digest,
                  writerId: input.pointer.writerId,
                  controlRevision: input.follower.controlRevision,
                  checkpointActor,
                  installedAtMs: Date.now(),
                },
          );
          const descriptor = await readSqliteLibrarySyncDescriptor();
          return {
            frontierDigest: header.materializer_position.frontier_digest,
            ingestSequence: header.materializer_position.ingest_sequence,
            libraryId: header.library_id,
            materializedDigest:
              descriptor.materializedDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["materialized_digest"],
            recordCount: manifest.totalRecordCount,
            storageEpoch: header.epoch_id,
          };
        },
      },
    });
    return await readSqliteLibrarySyncDescriptor();
  } catch (error) {
    if (backup !== null) await restoreSqliteLibraryBackup(backup.backupId);
    throw error;
  }
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
  let descriptor = await readSqliteLibrarySyncDescriptor();
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
      state.lastPublishedRevision !== descriptor.revision
    ) {
      state = Object.freeze({
        ...state,
        lastPublishedRevision: descriptor.revision,
        storageEpoch: pointer.storageEpoch,
        writerId: pointer.writerId,
      });
      await persistCloudState(state);
    }
    return { status: "current", revision: descriptor.revision };
  }
  if (
    state.lastPublishedRevision !== descriptor.revision ||
    pointer.storageEpoch !== state.storageEpoch ||
    pointer.writerId !== state.writerId
  ) {
    descriptor = await bootstrapCloudCheckpointIntoSqlite({
      adapter,
      pointer,
      sourceDigest: state.sourceDigest,
    });
    state = Object.freeze({
      ...state,
      lastPublishedRevision: descriptor.revision,
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
  const targetState: LocalLibraryCoreCloudStateV1 = Object.freeze({
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
    readSqliteLibrarySyncDescriptor,
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
  await acceptPendingPwaActorEnrollments({
    accessToken: input.accessToken,
    epochId: loaded.bootstrap.authority.epoch_id,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const actors = await listSqliteLibraryActorEnrollments({
    epochId: loaded.bootstrap.authority.epoch_id,
    libraryId: loaded.bootstrap.authority.library_id,
  });
  await acceptPendingPwaReadIntents({
    accessToken: input.accessToken,
    actors,
    controlFileId: provisioned.controlFileId,
    desktopActorId: loaded.currentWriterId,
    epochId: loaded.bootstrap.authority.epoch_id,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  await flushPwaIntentResultOutbox({
    accessToken: input.accessToken,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.bootstrap.authority.epoch_id,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const updatedActors = await listSqliteLibraryActorEnrollments({
    epochId: loaded.bootstrap.authority.epoch_id,
    libraryId: loaded.bootstrap.authority.library_id,
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
  const publishedActorDigest = await actorStateDigest(updatedActors);
  if (
    state.lastPublishedRevision === normalizedCheckpoint.sourceRevision &&
    state.lastPublishedActorDigest === publishedActorDigest
  ) {
    return { status: "current", revision: normalizedCheckpoint.sourceRevision };
  }
  await publishActorEnrollmentCertificates({
    actors: updatedActors,
    adapter,
    epochId: state.storageEpoch,
    libraryId: state.libraryId,
  });
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
    lastPublishedActorDigest: publishedActorDigest,
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

function actorIdFromEnrollmentCertificate(bytes: Uint8Array): string | null {
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
  const actorId = (
    enrollmentBody as Readonly<Record<string, LibraryCoreCanonicalValue>>
  ).actor_id;
  return typeof actorId === "string" ? actorId : null;
}

async function enrollSqliteLibraryFollower(input: {
  readonly accessToken: string;
  readonly adapter: ReturnType<typeof createGoogleDriveLibraryCoreAdapterV1>;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<string | null> {
  const request = await prepareSqliteLibraryFollowerActorRequest();
  if (
    request.libraryId !== input.libraryId ||
    request.epochId !== input.epochId
  ) {
    throw new Error(
      "Follower actor request does not match the active Drive authority",
    );
  }
  requireFollowerLibraryCoreDesktopRole();
  const enrollments = await discoverGoogleDriveLibraryCoreActorEnrollmentsV1({
    accessToken: input.accessToken,
    epochId: input.epochId,
    googleFetch: input.googleFetch,
    libraryId: input.libraryId,
    signal: input.signal,
  });
  const enrollment = enrollments.find(
    (candidate) =>
      actorIdFromEnrollmentCertificate(candidate.bytes) === request.actorId,
  );
  if (enrollment !== undefined) {
    const canonical = new TextDecoder("utf-8", { fatal: true }).decode(
      enrollment.bytes,
    );
    await installSqliteLibraryFollowerActorEnrollment(canonical);
    return request.actorId;
  }

  const source = new TextEncoder().encode(
    request.canonicalEnrollmentRequestJson,
  );
  const contentDigest = await sha256Bytes(source);
  const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
    byteLength: source.byteLength,
    contentDigest,
    objectKey: createLibraryCoreImmutableObjectKey({
      actorId: request.actorId,
      digest: contentDigest,
      epochId: input.epochId,
      kind: "actor_enrollment_request",
      libraryId: input.libraryId,
    }),
  });
  requireFollowerLibraryCoreDesktopRole();
  const uploaded = await input.adapter.putImmutable({ descriptor, source });
  requireFollowerLibraryCoreDesktopRole();
  await input.adapter.verifyImmutable({
    descriptor,
    transportObjectId: uploaded.transportObjectId,
  });
  return null;
}

async function flushSqliteLibraryFollowerIntents(input: {
  readonly accessToken: string;
  readonly controlFileId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<void> {
  for (let segmentCount = 0; segmentCount < 64; segmentCount += 1) {
    const candidate = await readSqliteLibraryFollowerIntentOutboxCandidate();
    if (candidate === null) return;
    requireFollowerLibraryCoreDesktopRole();
    let locator = await discoverGoogleDriveLibraryCoreIntentHeadV1({
      accessToken: input.accessToken,
      actorId: candidate.actorId,
      epochId: candidate.epochId,
      googleFetch: input.googleFetch,
      libraryId: candidate.libraryId,
      signal: input.signal,
    });
    if (locator === null) {
      if (
        candidate.firstIntentSequence !== 1 ||
        candidate.previousSegmentDigest !== null
      ) {
        throw new Error(
          "Follower Drive intent head is missing for a noninitial segment",
        );
      }
      requireFollowerLibraryCoreDesktopRole();
      locator = await provisionGoogleDriveLibraryCoreIntentHeadV1({
        accessToken: input.accessToken,
        googleFetch: input.googleFetch,
        head: parseLibraryCoreIntentHeadV1({
          actor_id: candidate.actorId,
          epoch_id: candidate.epochId,
          latest_segment: null,
          library_id: candidate.libraryId,
          next_intent_sequence: 1,
          protocol: "intent_head_v1",
          protocol_version: 1,
          schema_version: candidate.schemaVersion,
        }),
        signal: input.signal,
      });
    }
    const adapter = createGoogleDriveLibraryCoreIntentAdapterV1({
      accessToken: input.accessToken,
      actorId: candidate.actorId,
      controlFileId: input.controlFileId,
      epochId: candidate.epochId,
      googleFetch: input.googleFetch,
      intentHeadFileId: locator.intentHeadFileId,
      libraryId: candidate.libraryId,
      signal: input.signal,
    });
    requireFollowerLibraryCoreDesktopRole();
    const expectedHead = (await adapter.readIntentHead()).head;
    if (
      expectedHead.next_intent_sequence !== candidate.firstIntentSequence ||
      (expectedHead.latest_segment?.descriptor.contentDigest ?? null) !==
        candidate.previousSegmentDigest
    ) {
      throw new Error(
        "Follower Drive intent head does not match the durable outbox",
      );
    }
    const prepared = await prepareLibraryCoreIntentSegmentV1({
      actorId: candidate.actorId,
      entries: candidate.entries.map((entry) => ({
        canonicalEnvelopeJson: entry.canonicalEnvelopeJson,
        intentSequence: entry.intentSequence,
        operationId: entry.operationId,
      })),
      epochId: candidate.epochId,
      libraryId: candidate.libraryId,
      previousSegmentDigest:
        candidate.previousSegmentDigest as LibraryCoreLowercaseHex64 | null,
      schemaVersion: candidate.schemaVersion,
      subtle: crypto.subtle,
    });
    requireFollowerLibraryCoreDesktopRole();
    const published = await publishLibraryCoreIntentCandidateV1({
      adapter,
      candidate: {
        body: prepared.body,
        expectedHead,
        expectedHeadDigest: sha256LowerHex(
          encodeLibraryCoreCanonicalValue(
            expectedHead as unknown as LibraryCoreCanonicalValue,
          ),
        ),
      },
      subtle: crypto.subtle,
    });
    if (published.status === "conflict") {
      throw new Error("Follower Drive intent head changed during publication");
    }
    await recordSqliteLibraryFollowerIntentPublication({
      actorId: candidate.actorId,
      epochId: candidate.epochId,
      firstIntentSequence: candidate.firstIntentSequence,
      lastIntentSequence: candidate.lastIntentSequence,
      libraryId: candidate.libraryId,
      previousSegmentDigest: candidate.previousSegmentDigest,
      publishedSegmentDigest:
        published.segmentReference.descriptor.contentDigest,
    });
  }
  throw new Error("Follower intent publication exceeded its bounded pass");
}

async function importSqliteLibraryFollowerResults(input: {
  readonly accessToken: string;
  readonly actorId: string;
  readonly controlFileId: string;
  readonly epochId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  requireFollowerLibraryCoreDesktopRole();
  const locator = await discoverGoogleDriveLibraryCoreResultHeadV1({
    accessToken: input.accessToken,
    actorId: input.actorId,
    epochId: input.epochId,
    googleFetch: input.googleFetch,
    libraryId: input.libraryId,
    signal: input.signal,
  });
  if (locator === null) return;
  const adapter = createGoogleDriveLibraryCoreResultAdapterV1({
    accessToken: input.accessToken,
    actorId: input.actorId,
    controlFileId: input.controlFileId,
    epochId: input.epochId,
    googleFetch: input.googleFetch,
    libraryId: input.libraryId,
    resultHeadFileId: locator.resultHeadFileId,
    signal: input.signal,
  });
  requireFollowerLibraryCoreDesktopRole();
  const head = (await adapter.readResultHead()).head;
  const cursor =
    (await readSqliteLibraryFollowerResultImportCursor({
      actorId: input.actorId,
      epochId: input.epochId,
      libraryId: input.libraryId,
    })) ?? { latestSegmentDigest: null, nextResultSequence: 1 };
  requireFollowerLibraryCoreDesktopRole();
  const discovered = await discoverGoogleDriveLibraryCoreResultSegmentsV1({
    accessToken: input.accessToken,
    actorId: input.actorId,
    epochId: input.epochId,
    googleFetch: input.googleFetch,
    libraryId: input.libraryId,
    signal: input.signal,
  });
  const segments = discovered.filter(
    (segment) => segment.lastResultSequence >= cursor.nextResultSequence,
  );
  if (segments.length > 64) {
    throw new Error("Follower result import exceeded its bounded pass");
  }
  let nextResultSequence = cursor.nextResultSequence;
  let previousSegmentDigest = cursor.latestSegmentDigest as
    | LibraryCoreLowercaseHex64
    | null;
  for (const segment of segments) {
    if (segment.firstResultSequence !== nextResultSequence) {
      throw new Error("Follower result segment chain has a gap or overlap");
    }
    requireFollowerLibraryCoreDesktopRole();
    await importLibraryCoreResultSegmentV1({
      actorId: input.actorId,
      adapter,
      expectedFirstResultSequence: nextResultSequence,
      expectedPreviousSegmentDigest: previousSegmentDigest,
      libraryId: input.libraryId,
      reference: segment.reference,
      storageEpoch: input.epochId,
      subtle: crypto.subtle,
      writer: {
        async appendResultSegment({ entries, header, reference }) {
          await appendSqliteLibraryFollowerResultSegment({
            actorId: input.actorId,
            entries: entries.map((entry) => ({
              intentOperationId: entry.intent_operation_id,
              intentSequence: entry.intent_sequence,
              providerReceiptDigest: entry.provider_receipt_digest,
              resultOperationId: entry.result_operation_id,
              resultSequence: entry.result_sequence,
              status: entry.status,
            })),
            epochId: input.epochId,
            firstResultSequence: header.first_result_sequence,
            lastResultSequence: header.last_result_sequence,
            libraryId: input.libraryId,
            previousSegmentDigest: header.previous_segment_digest,
            segmentDigest: reference.descriptor.contentDigest,
          });
        },
      },
    });
    nextResultSequence = segment.lastResultSequence + 1;
    previousSegmentDigest = segment.reference.descriptor.contentDigest;
    if (nextResultSequence >= head.next_result_sequence) break;
  }
  if (
    nextResultSequence !== head.next_result_sequence ||
    previousSegmentDigest !== head.latest_segment_digest
  ) {
    throw new Error(
      "Follower result objects do not match the actor result head",
    );
  }
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
  const before = await readSqliteLibraryFollowerRuntimeStatus();
  if (
    before.libraryId !== pointer.libraryId ||
    before.epochId !== pointer.storageEpoch ||
    before.checkpointGeneration !== pointer.generation
  ) {
    let sourceDigest = EMPTY_LIBRARY_SOURCE_DIGEST;
    try {
      sourceDigest = (await readSqliteLibrarySyncDescriptor()).sourceDigest;
    } catch {
      // A first follower checkpoint may replace an inactive local Library.
    }
    await bootstrapCloudCheckpointIntoSqlite({
      adapter,
      follower: {
        actorId: before.actorId,
        controlRevision: control.revision,
      },
      pointer,
      sourceDigest,
    });
  }
  const afterCheckpoint = await readSqliteLibraryFollowerRuntimeStatus();
  const actorId =
    afterCheckpoint.state === "active"
      ? afterCheckpoint.actorId
      : await enrollSqliteLibraryFollower({
          accessToken: input.accessToken,
          adapter,
          epochId: pointer.storageEpoch,
          googleFetch: input.googleFetch,
          libraryId: pointer.libraryId,
          signal: input.signal,
        });
  if (actorId !== null) {
    await flushSqliteLibraryFollowerIntents({
      accessToken: input.accessToken,
      controlFileId: discovered.controlFileId,
      googleFetch: input.googleFetch,
      signal: input.signal,
    });
    await importSqliteLibraryFollowerResults({
      accessToken: input.accessToken,
      actorId,
      controlFileId: discovered.controlFileId,
      epochId: pointer.storageEpoch,
      googleFetch: input.googleFetch,
      libraryId: pointer.libraryId,
      signal: input.signal,
    });
  }
  const descriptor = await readSqliteLibrarySyncDescriptor();
  return { status: "follower_synced", revision: descriptor.revision };
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
      isPrimary: () => readLibraryCoreDesktopRole() === "primary",
    },
    durableState: {
      async read() {
        const status = await sqliteLibraryStatus();
        const state = await readNativeJsonValue(STATE_FILE, STATE_KEY);
        if (status?.active !== true || !isCloudState(state)) return null;
        return {
          active: true,
          localRevision: status.revision,
          lastPublishedRevision: state.lastPublishedRevision,
        };
      },
    },
    credentials: {
      initialAccessToken: input.accessToken,
      resolveAccessToken: input.resolveAccessToken,
    },
    clock: { nowMs: Date.now },
    scheduler: {
      schedule(callback, delayMs) {
        return setTimeout(() => void callback(), delayMs);
      },
      cancel: clearTimeout,
    },
    fetch: { googleFetch: input.googleFetch },
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
      publish({ accessToken, googleFetch, signal }) {
        return publishCurrentSqliteLibraryToGoogleDrive({
          accessToken,
          googleFetch,
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
