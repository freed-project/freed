import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreResultHeadV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
  type LibraryCoreResultHeadV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  createGoogleDriveLibraryCoreResultAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  importLibraryCoreIntentSegmentV1,
  importLibraryCoreResultSegmentV1,
  importLibraryCorePortableCheckpointV1,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreResultHeadV1,
  publishLibraryCorePortableCheckpointV1,
  publishLibraryCoreResultEntriesV1,
  reassignLibraryCorePortableCheckpointV1,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePreparedImmutableObjectV1,
} from "@freed/sync/cloud/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud/library-core";
import { decodeJson } from "@freed/shared/projection";
import type { FeedItem } from "@freed/shared";
import { recordCloudProviderEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";
import {
  appendPortableSqliteLibraryItems,
  acknowledgePwaIntentResultOutbox,
  acceptPwaActorEnrollmentRequest,
  acceptPwaIntentTransaction,
  beginPortableSqliteLibraryImport,
  bootstrapSqliteLibraryAuthority,
  createSqliteLibraryBackup,
  finalizePortableSqliteLibraryImport,
  listSqliteLibraryActorEnrollments,
  readSqliteLibrarySyncDescriptor,
  readSqliteLibrarySyncPage,
  readPwaIntentResultOutbox,
  reassignSqliteLibraryWriterEpoch,
  restoreSqliteLibraryBackup,
  setSqliteLibraryCloudWriterAdmission,
  sqliteLibraryStatus,
  type SqliteLibrarySyncDescriptor,
  type SqliteLibraryAuthorityBootstrap,
  type SqliteLibraryActorCheckpointState,
  type SqliteLibraryIntentResultOutboxEntry,
} from "./sqlite-library";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";
import {
  mirrorSqliteLibraryBackupsToGoogleDrive,
  resetSqliteLibraryDriveBackupMirror,
} from "./library-core-drive-backups";

const STATE_FILE = "library-core-cloud.json";
const STATE_KEY = "state";
const LOCAL_REVISION_POLL_MS = 15_000;
const INBOUND_ACTOR_POLL_MS = 60_000;
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
}

export type LibraryCoreCloudPublishResult =
  | { readonly status: "published"; readonly revision: number }
  | { readonly status: "current"; readonly revision: number }
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
    typeof candidate.sourceDigest === "string" &&
    typeof candidate.storageEpoch === "string" &&
    typeof candidate.writerId === "string" &&
    (candidate.controlFileId === null ||
      typeof candidate.controlFileId === "string") &&
    (candidate.lastPublishedRevision === null ||
      (typeof candidate.lastPublishedRevision === "number" &&
        Number.isSafeInteger(candidate.lastPublishedRevision) &&
        candidate.lastPublishedRevision >= 0)) &&
    (candidate.lastPublishedActorDigest === undefined ||
      candidate.lastPublishedActorDigest === null ||
      /^[a-f0-9]{64}$/.test(candidate.lastPublishedActorDigest))
  );
}

async function loadOrCreateCloudState(
  descriptor: SqliteLibrarySyncDescriptor,
): Promise<{
  readonly state: LocalLibraryCoreCloudStateV1;
  readonly currentWriterId: string;
  readonly bootstrap: SqliteLibraryAuthorityBootstrap;
}> {
  const bootstrap = await bootstrapSqliteLibraryAuthority();
  const currentWriterId = bootstrap.actor.actor_id;
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
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
      return {
        state: Object.freeze({
          ...stored,
          lastPublishedActorDigest: stored.lastPublishedActorDigest ?? null,
        }),
        currentWriterId,
        bootstrap,
      };
    }
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

let backupMirrorChain: Promise<void> = Promise.resolve();

function scheduleClosedSqliteBackupMirror(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}): void {
  backupMirrorChain = backupMirrorChain.then(async () => {
    try {
      const result = await mirrorSqliteLibraryBackupsToGoogleDrive({
        ...input,
        googleFetch: input.googleFetch ?? fetch,
      });
      if (result.uploaded > 0 || result.removed > 0) {
        console.info(
          `[library-core-backups] mirrored ${result.uploaded.toLocaleString()} and removed ${result.removed.toLocaleString()} old Drive generations`,
        );
      }
    } catch (error) {
      console.error("[library-core-backups] Drive mirror failed", error);
    }
  });
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

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function canonicalValue(value: unknown): LibraryCoreCanonicalValue {
  return value as LibraryCoreCanonicalValue;
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

async function* checkpointEntries(
  descriptor: SqliteLibrarySyncDescriptor,
  actors: readonly SqliteLibraryActorCheckpointState[],
): AsyncIterable<LibraryCorePortableCheckpointEntryV1> {
  let ordinal = 0;
  yield {
    kind: "logical_checkpoint_entry",
    collection: "materialized_rows",
    ordinal,
    value: {
      primary_key: "shell",
      registry_key: "00_library_shell",
      row: canonicalValue(decodeJson(descriptor.shellJson)),
    },
  };
  ordinal += 1;

  let offset = 0;
  for (;;) {
    const page = await readSqliteLibrarySyncPage({
      revision: descriptor.revision,
      offset,
    });
    for (const encoded of page.itemsJson) {
      const item = decodeJson(encoded) as FeedItem;
      yield {
        kind: "logical_checkpoint_entry",
        collection: "materialized_rows",
        ordinal,
        value: {
          primary_key: item.globalId,
          registry_key: "10_feed_items",
          row: canonicalValue(item),
        },
      };
      ordinal += 1;
    }
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  if (ordinal !== descriptor.itemCount + 1) {
    throw new Error("SQLite Library changed during checkpoint export");
  }
  for (let actorOrdinal = 0; actorOrdinal < actors.length; actorOrdinal += 1) {
    const actor = actors[actorOrdinal]!;
    yield {
      kind: "logical_checkpoint_entry",
      collection: "actor_states",
      ordinal: actorOrdinal,
      value: {
        accepted_chain_digest: actor.accepted_chain_digest,
        accepted_operation_id: actor.accepted_operation_id,
        accepted_sequence: actor.accepted_sequence,
        actor_id: actor.actor_id,
        enrollment_certificate_digest: actor.enrollment_certificate_digest,
        retired: actor.retired,
        retirement_certificate_digest: actor.retirement_certificate_digest,
      },
    };
  }
}

async function checkpointHeader(
  state: LocalLibraryCoreCloudStateV1,
  descriptor: SqliteLibrarySyncDescriptor,
  bootstrap: SqliteLibraryAuthorityBootstrap,
  actorCount: number,
  preservedFrontierDigest?: string,
): Promise<LibraryCorePortableCheckpointHeaderV1> {
  const frontierDigest =
    preservedFrontierDigest ??
    (await sha256Text(
      [
        state.libraryId,
        state.storageEpoch,
        String(descriptor.revision),
        descriptor.materializedDigest,
      ].join("\n"),
    ));
  return {
    kind: "logical_checkpoint_header",
    format: "freed_logical_checkpoint_v1",
    library_id:
      state.libraryId as LibraryCorePortableCheckpointHeaderV1["library_id"],
    epoch: bootstrap.authority.epoch,
    epoch_id:
      state.storageEpoch as LibraryCorePortableCheckpointHeaderV1["epoch_id"],
    schema_version: 2,
    field_registry_version: 1,
    canonical_codec_version: 1,
    anchor_kind: "accepted_authority",
    accepted_authority: bootstrap.authority,
    source_transition_digest: null,
    source_manifest_digest: null,
    transition_candidate_anchor: null,
    promoted_receipt_digests: [],
    materializer_position: {
      frontier_digest:
        frontierDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["frontier_digest"],
      ingest_sequence: descriptor.revision,
      materialized_digest:
        descriptor.materializedDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["materialized_digest"],
    },
    collection_counts: {
      accepted_frontier: 0,
      quarantined_frontier: 0,
      materialized_rows: descriptor.itemCount + 1,
      field_clocks: 0,
      relationships: 0,
      tombstones: 0,
      actor_states: actorCount,
      receipt_records: 0,
      blob_roots: 0,
      excluded_registry_keys: 0,
    },
  };
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
}): Promise<SqliteLibrarySyncDescriptor> {
  const previousStatus = await sqliteLibraryStatus();
  const backup =
    previousStatus?.active === true
      ? await createSqliteLibraryBackup("manual")
      : null;
  let nativeImportStarted = false;
  let importedHeader: LibraryCorePortableCheckpointHeaderV1 | null = null;
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
          await finalizePortableSqliteLibraryImport();
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
  const reassigned = await reassignSqliteLibraryWriterEpoch({
    canonicalSourceControlJson,
    libraryId: state.libraryId,
    targetWriterId: loaded.currentWriterId,
  });
  const targetStorageEpoch = reassigned.authority.epoch_id;
  const targetState: LocalLibraryCoreCloudStateV1 = Object.freeze({
    ...state,
    lastPublishedRevision: null,
    storageEpoch: targetStorageEpoch,
    writerId: loaded.currentWriterId,
  });
  const actors = await listSqliteLibraryActorEnrollments({
    epochId: reassigned.authority.epoch_id,
    libraryId: reassigned.authority.library_id,
  });
  const result = await reassignLibraryCorePortableCheckpointV1({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    entries: checkpointEntries(descriptor, actors),
    epochCertificate: await prepareWriterEpochCertificate({
      canonicalCertificateJson: reassigned.canonicalEpochCertificateJson,
      libraryId: state.libraryId,
      targetStorageEpoch,
    }),
    expectedControl: { pointer, revision: controlRead.revision },
    generation: 0,
    header: await checkpointHeader(
      targetState,
      descriptor,
      reassigned,
      actors.length,
      pointer.causalFrontierDigest,
    ),
    subtle: crypto.subtle,
    writerId: loaded.currentWriterId,
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
      lastPublishedActorDigest: await actorStateDigest(actors),
      lastPublishedRevision: descriptor.revision,
    }),
  );
  await setSqliteLibraryCloudWriterAdmission({
    localWriterId: loaded.currentWriterId,
    activeWriterId: loaded.currentWriterId,
    storageEpoch: targetStorageEpoch,
    controlRevision: result.revision,
  });
  return { status: "writer_transferred", revision: descriptor.revision };
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
  const updatedDescriptor = await readSqliteLibrarySyncDescriptor();
  const publishedActorDigest = await actorStateDigest(updatedActors);
  if (
    state.lastPublishedRevision === updatedDescriptor.revision &&
    state.lastPublishedActorDigest === publishedActorDigest
  ) {
    scheduleClosedSqliteBackupMirror({
      accessToken: input.accessToken,
      googleFetch: input.googleFetch,
      libraryId: state.libraryId,
      signal: input.signal,
    });
    return { status: "current", revision: updatedDescriptor.revision };
  }
  await publishActorEnrollmentCertificates({
    actors: updatedActors,
    adapter,
    epochId: state.storageEpoch,
    libraryId: state.libraryId,
  });
  const generation = pointer === null ? 0 : pointer.generation + 1;
  const result = await publishLibraryCorePortableCheckpointV1({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    entries: checkpointEntries(updatedDescriptor, updatedActors),
    expectedControl: { revision: controlRead.revision, pointer },
    generation,
    header: await checkpointHeader(
      state,
      updatedDescriptor,
      loaded.bootstrap,
      updatedActors.length,
    ),
    subtle: crypto.subtle,
    writerId: state.writerId,
  });
  if (result.status !== "committed") {
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
    lastPublishedRevision: updatedDescriptor.revision,
  });
  await persistCloudState(state);
  scheduleClosedSqliteBackupMirror({
    accessToken: input.accessToken,
    googleFetch: input.googleFetch,
    libraryId: state.libraryId,
    signal: input.signal,
  });
  return { status: "published", revision: updatedDescriptor.revision };
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
  return runBoundedPublication(input);
}

export async function startSqliteLibraryGoogleDriveSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  stopSqliteLibraryCloudSync();
  resetSqliteLibraryDriveBackupMirror();
  const abortController = new AbortController();
  running = { abortController, timer: null };
  const publish = async (
    accessToken: string,
  ): Promise<LibraryCoreCloudPublishResult> =>
    publishCurrentSqliteLibraryToGoogleDrive({
      accessToken,
      googleFetch: input.googleFetch,
      signal: abortController.signal,
    });
  const initial = await publish(input.accessToken);
  if (initial.status === "ownership_required") {
    stopSqliteLibraryCloudSync();
    return initial;
  }
  let lastInboundActorPollAt = Date.now();

  const poll = async (): Promise<void> => {
    if (
      running?.abortController !== abortController ||
      abortController.signal.aborted
    )
      return;
    try {
      const status = await sqliteLibraryStatus();
      const state = await readNativeJsonValue(STATE_FILE, STATE_KEY);
      const now = Date.now();
      if (
        status?.active === true &&
        isCloudState(state) &&
        (state.lastPublishedRevision !== status.revision ||
          now - lastInboundActorPollAt >= INBOUND_ACTOR_POLL_MS)
      ) {
        lastInboundActorPollAt = now;
        const result = await publish(await input.resolveAccessToken());
        if (result.status === "ownership_required") {
          stopSqliteLibraryCloudSync();
          return;
        }
      }
    } finally {
      if (
        running?.abortController === abortController &&
        !abortController.signal.aborted
      ) {
        running.timer = setTimeout(
          () => void poll().catch(console.error),
          LOCAL_REVISION_POLL_MS,
        );
      }
    }
  };
  running.timer = setTimeout(
    () => void poll().catch(console.error),
    LOCAL_REVISION_POLL_MS,
  );
  return initial;
}

export function stopSqliteLibraryCloudSync(): void {
  const current = running;
  running = null;
  current?.abortController.abort();
  if (current?.timer !== null && current?.timer !== undefined) {
    clearTimeout(current.timer);
  }
}
