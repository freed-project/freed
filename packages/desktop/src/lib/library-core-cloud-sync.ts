import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreFollowerActorRequestReceiptV2,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreResultHeadV1,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreResultHeadV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreNormalizedFollowerTransportV2,
  createLibraryCorePrimaryCoordinatorV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  createGoogleDriveLibraryCoreResultAdapterV1,
  createLibraryCoreNormalizedCheckpointWriterV2,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCoreIntentSegmentV1,
  importLibraryCoreResultSegmentV1,
  importLibraryCoreNormalizedCheckpointV2,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreResultHeadV1,
  publishLibraryCoreNormalizedCheckpointV2,
  publishLibraryCoreResultEntriesV1,
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
  acknowledgePwaIntentResultOutbox,
  acceptPwaActorEnrollmentRequest,
  acceptPwaIntentTransaction,
  beginNormalizedLibraryCheckpointImport,
  describeNormalizedLibraryCloudIdentity,
  describeNormalizedLibraryCheckpoint,
  installNormalizedLibraryFollowerActorEnrollment,
  importNormalizedLibraryFollowerResultTransport,
  listSqliteLibraryActorEnrollments,
  readNormalizedLibraryCheckpointPage,
  readPwaIntentResultOutbox,
  prepareNormalizedLibraryFollowerActorRequest,
  pageNormalizedLibraryFollowerTransport,
  readNormalizedLibraryFollowerRuntimeStatus,
  readNormalizedLibraryFollowerTransportContext,
  reassignNormalizedLibraryWriterEpoch,
  recordNormalizedLibraryFollowerIntentTransportPublication,
  setSqliteLibraryCloudWriterAdmission,
  type NormalizedLibraryCloudIdentity,
  type SqliteLibraryActorCheckpointState,
  type SqliteLibraryIntentResultOutboxEntry,
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
  await acceptPendingPwaActorEnrollments({
    accessToken: input.accessToken,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const actors = await listSqliteLibraryActorEnrollments({
    epochId: loaded.identity.authorityEpoch,
    libraryId: loaded.identity.libraryId,
  });
  await acceptPendingPwaReadIntents({
    accessToken: input.accessToken,
    actors,
    controlFileId: provisioned.controlFileId,
    desktopActorId: loaded.currentWriterId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  await flushPwaIntentResultOutbox({
    accessToken: input.accessToken,
    controlFileId: provisioned.controlFileId,
    epochId: loaded.identity.authorityEpoch,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  const updatedActors = await listSqliteLibraryActorEnrollments({
    epochId: loaded.identity.authorityEpoch,
    libraryId: loaded.identity.libraryId,
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
      isPrimary: () => readLibraryCoreDesktopRole() === "primary",
    },
    durableState: {
      async read() {
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
