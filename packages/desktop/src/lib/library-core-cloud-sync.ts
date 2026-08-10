import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreControlPointerV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  importLibraryCorePortableCheckpointV1,
  provisionGoogleDriveLibraryCoreControlV1,
  publishLibraryCorePortableCheckpointV1,
  reassignLibraryCorePortableCheckpointV1,
  type GoogleDriveFetch,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePreparedImmutableObjectV1,
} from "@freed/sync/cloud";
import { decodeJson } from "@freed/shared/projection";
import type { FeedItem } from "@freed/shared";
import { getOrCreateDesktopClientRegistration } from "./desktop-client-registration";
import {
  appendPortableSqliteLibraryItems,
  beginPortableSqliteLibraryImport,
  createSqliteLibraryBackup,
  finalizePortableSqliteLibraryImport,
  readSqliteLibrarySyncDescriptor,
  readSqliteLibrarySyncPage,
  restoreSqliteLibraryBackup,
  sqliteLibraryStatus,
  type SqliteLibrarySyncDescriptor,
} from "./sqlite-library";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";

const STATE_FILE = "library-core-cloud.json";
const STATE_KEY = "state";
const LOCAL_REVISION_POLL_MS = 15_000;
const ACTIVATION_KEY = "freed.libraryCore.immutableGoogleDriveV1.enabled";

interface LocalLibraryCoreCloudStateV1 {
  readonly version: 1;
  readonly libraryId: string;
  readonly sourceDigest: string;
  readonly storageEpoch: string;
  readonly writerId: string;
  readonly controlFileId: string | null;
  readonly lastPublishedRevision: number | null;
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

/** Remain provider-silent until the reviewed Drive activation gate is set. */
export function isSqliteLibraryGoogleDriveSyncEnabled(): boolean {
  try {
    return window.localStorage.getItem(ACTIVATION_KEY) === "1";
  } catch {
    return false;
  }
}

function isCloudState(value: unknown): value is LocalLibraryCoreCloudStateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LocalLibraryCoreCloudStateV1>;
  return candidate.version === 1
    && typeof candidate.libraryId === "string"
    && typeof candidate.sourceDigest === "string"
    && typeof candidate.storageEpoch === "string"
    && typeof candidate.writerId === "string"
    && (candidate.controlFileId === null || typeof candidate.controlFileId === "string")
    && (candidate.lastPublishedRevision === null
      || (typeof candidate.lastPublishedRevision === "number"
        && Number.isSafeInteger(candidate.lastPublishedRevision)
        && candidate.lastPublishedRevision >= 0));
}

async function loadOrCreateCloudState(
  descriptor: SqliteLibrarySyncDescriptor,
): Promise<{
  readonly state: LocalLibraryCoreCloudStateV1;
  readonly currentWriterId: string;
}> {
  const registration = await getOrCreateDesktopClientRegistration();
  const currentWriterId = `desktop-${registration.id}`;
  const stored = await readNativeJsonValue(STATE_FILE, STATE_KEY);
  if (isCloudState(stored)) {
    if (stored.sourceDigest !== descriptor.sourceDigest) {
      throw new Error("The saved Library Core cloud identity belongs to another Library");
    }
    return { state: stored, currentWriterId };
  }
  const state: LocalLibraryCoreCloudStateV1 = Object.freeze({
    version: 1,
    libraryId: `library-${descriptor.sourceDigest.slice(0, 40)}`,
    sourceDigest: descriptor.sourceDigest,
    storageEpoch: `epoch-${crypto.randomUUID()}`,
    writerId: currentWriterId,
    controlFileId: null,
    lastPublishedRevision: null,
  });
  await persistCloudState(state);
  return { state, currentWriterId };
}

async function persistCloudState(state: LocalLibraryCoreCloudStateV1): Promise<void> {
  await writeNativeJsonValue(
    STATE_FILE,
    STATE_KEY,
    state,
    "library-core-cloud-sync",
  );
}

function exactBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function parseControl(read: LibraryCoreControlReadV1): LibraryCoreControlPointerV1 | null {
  if (read.bytes === null) {
    throw new Error("Library Core control file has no bytes");
  }
  const value = decodeLibraryCoreCanonicalValue(exactBytes(read.bytes));
  if (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 0
  ) {
    return null;
  }
  return parseLibraryCoreControlPointerV1(value);
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

async function* checkpointEntries(
  descriptor: SqliteLibrarySyncDescriptor,
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
}

async function checkpointHeader(
  state: LocalLibraryCoreCloudStateV1,
  descriptor: SqliteLibrarySyncDescriptor,
  preservedFrontierDigest?: string,
): Promise<LibraryCorePortableCheckpointHeaderV1> {
  const frontierDigest = preservedFrontierDigest ?? await sha256Text([
      state.libraryId,
      state.storageEpoch,
      String(descriptor.revision),
      descriptor.materializedDigest,
    ].join("\n"));
  return {
    kind: "logical_checkpoint_header",
    format: "freed_logical_checkpoint_v1",
    library_id: state.libraryId as LibraryCorePortableCheckpointHeaderV1["library_id"],
    epoch: 1,
    epoch_id: state.storageEpoch as LibraryCorePortableCheckpointHeaderV1["epoch_id"],
    schema_version: 2,
    field_registry_version: 1,
    canonical_codec_version: 1,
    anchor_kind: "accepted_authority",
    source_transition_digest: null,
    source_manifest_digest: null,
    transition_candidate_anchor: null,
    promoted_receipt_digests: [],
    materializer_position: {
      frontier_digest: frontierDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["frontier_digest"],
      ingest_sequence: descriptor.revision,
      materialized_digest: descriptor.materializedDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["materialized_digest"],
    },
    collection_counts: {
      accepted_frontier: 0,
      quarantined_frontier: 0,
      materialized_rows: descriptor.itemCount + 1,
      field_clocks: 0,
      relationships: 0,
      tombstones: 0,
      actor_states: 0,
      receipt_records: 0,
      blob_roots: 0,
      excluded_registry_keys: 0,
    },
  };
}

async function prepareWriterEpochCertificate(input: {
  readonly libraryId: string;
  readonly source: LibraryCoreControlPointerV1;
  readonly targetStorageEpoch: string;
  readonly targetWriterId: string;
}): Promise<LibraryCorePreparedImmutableObjectV1<Uint8Array>> {
  const source = encodeLibraryCoreCanonicalValue({
    kind: "writer_epoch_reassignment_v1",
    library_id: input.libraryId,
    protocol_version: 1,
    source_frontier_digest: input.source.causalFrontierDigest,
    source_generation: input.source.generation,
    source_storage_epoch: input.source.storageEpoch,
    source_writer_id: input.source.writerId,
    target_storage_epoch: input.targetStorageEpoch,
    target_writer_id: input.targetWriterId,
  });
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

function materializedRow(record: LibraryCorePortableCheckpointRecordV1): {
  readonly registryKey: string;
  readonly row: unknown;
} | null {
  if (record.kind === "logical_checkpoint_header") return null;
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
  const backup = previousStatus?.active === true
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
            if (pageIndex !== 0 || records[0]?.kind !== "logical_checkpoint_header") {
              throw new Error("SQLite cloud import did not begin with its logical header");
            }
            const header = records[0];
            const unsupportedCount = Object.entries(header.collection_counts)
              .some(([collection, count]) =>
                collection !== "materialized_rows" && count !== 0,
              );
            if (unsupportedCount) {
              throw new Error("SQLite cloud import contains unsupported Library collections");
            }
            const rows = records.slice(1).map(materializedRow).filter((row) => row !== null);
            const shell = rows.find((row) => row.registryKey === "00_library_shell");
            if (shell === undefined) {
              throw new Error("SQLite cloud import is missing the Library shell");
            }
            await beginPortableSqliteLibraryImport({
              expectedItemCount: header.collection_counts.materialized_rows - 1,
              shell: shell.row,
              sourceDigest: input.sourceDigest,
              sourceGeneration: header.epoch,
              sourceRevision: header.materializer_position.ingest_sequence,
            });
            nativeImportStarted = true;
            importedHeader = header;
            for (const row of rows) {
              if (row.registryKey === "10_feed_items") feedItems.push(row.row);
              else if (row.registryKey !== "00_library_shell") {
                throw new Error(`SQLite cloud import does not support ${row.registryKey}`);
              }
            }
          } else {
            for (const record of records) {
              const row = materializedRow(record);
              if (row === null) {
                throw new Error("SQLite cloud import repeats its logical header");
              }
              if (row.registryKey !== "10_feed_items") {
                throw new Error(`SQLite cloud import does not support ${row.registryKey}`);
              }
              feedItems.push(row.row);
            }
          }
          await appendPortableSqliteLibraryItems(feedItems);
        },
        async finalizeImport({ header, manifest }) {
          if (!nativeImportStarted || importedHeader === null) {
            throw new Error("SQLite cloud import never initialized native staging");
          }
          await finalizePortableSqliteLibraryImport();
          const descriptor = await readSqliteLibrarySyncDescriptor();
          return {
            frontierDigest: header.materializer_position.frontier_digest,
            ingestSequence: header.materializer_position.ingest_sequence,
            libraryId: header.library_id,
            materializedDigest: descriptor.materializedDigest as LibraryCorePortableCheckpointHeaderV1["materializer_position"]["materialized_digest"],
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
    state = Object.freeze({ ...state, controlFileId: provisioned.controlFileId });
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
    return { status: "current", revision: descriptor.revision };
  }
  if (
    state.lastPublishedRevision !== descriptor.revision
    || pointer.storageEpoch !== state.storageEpoch
    || pointer.writerId !== state.writerId
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

  const targetStorageEpoch = `epoch-${crypto.randomUUID()}`;
  const targetState: LocalLibraryCoreCloudStateV1 = Object.freeze({
    ...state,
    lastPublishedRevision: null,
    storageEpoch: targetStorageEpoch,
    writerId: loaded.currentWriterId,
  });
  const result = await reassignLibraryCorePortableCheckpointV1({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    entries: checkpointEntries(descriptor),
    epochCertificate: await prepareWriterEpochCertificate({
      libraryId: state.libraryId,
      source: pointer,
      targetStorageEpoch,
      targetWriterId: loaded.currentWriterId,
    }),
    expectedControl: { pointer, revision: controlRead.revision },
    generation: 0,
    header: await checkpointHeader(
      targetState,
      descriptor,
      pointer.causalFrontierDigest,
    ),
    subtle: crypto.subtle,
    writerId: loaded.currentWriterId,
  });
  if (result.status === "conflict") {
    return {
      status: "ownership_required",
      currentWriterId: result.currentControlPointer?.writerId ?? pointer.writerId,
      localWriterId: loaded.currentWriterId,
    };
  }
  await persistCloudState(Object.freeze({
    ...targetState,
    lastPublishedRevision: descriptor.revision,
  }));
  return { status: "writer_transferred", revision: descriptor.revision };
}

async function publishCurrentSqliteLibraryToGoogleDriveInternal(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  const descriptor = await readSqliteLibrarySyncDescriptor();
  const loaded = await loadOrCreateCloudState(descriptor);
  let state = loaded.state;
  if (state.writerId !== loaded.currentWriterId) {
    return {
      status: "ownership_required",
      currentWriterId: state.writerId,
      localWriterId: loaded.currentWriterId,
    };
  }
  if (state.lastPublishedRevision === descriptor.revision) {
    return { status: "current", revision: descriptor.revision };
  }

  const provisioned = await provisionGoogleDriveLibraryCoreControlV1({
    accessToken: input.accessToken,
    libraryId: state.libraryId,
    googleFetch: input.googleFetch,
    signal: input.signal,
  });
  if (state.controlFileId !== provisioned.controlFileId) {
    state = Object.freeze({ ...state, controlFileId: provisioned.controlFileId });
    await persistCloudState(state);
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    libraryId: state.libraryId,
    controlFileId: provisioned.controlFileId,
    googleFetch: input.googleFetch,
    signal: input.signal,
  });
  const controlRead = await adapter.readControl();
  const pointer = parseControl(controlRead);
  if (pointer !== null && pointer.writerId !== state.writerId) {
    return {
      status: "ownership_required",
      currentWriterId: pointer.writerId,
      localWriterId: state.writerId,
    };
  }
  const generation = pointer === null ? 0 : pointer.generation + 1;
  const result = await publishLibraryCorePortableCheckpointV1({
    activeTransport: "google_drive_app_data_v1",
    adapter,
    entries: checkpointEntries(descriptor),
    expectedControl: { revision: controlRead.revision, pointer },
    generation,
    header: await checkpointHeader(state, descriptor),
    subtle: crypto.subtle,
    writerId: state.writerId,
  });
  if (result.status !== "committed") {
    throw new Error("Library Core cloud authority changed during publication");
  }
  state = Object.freeze({
    ...state,
    lastPublishedRevision: descriptor.revision,
  });
  await persistCloudState(state);
  return { status: "published", revision: descriptor.revision };
}

let publicationChain: Promise<void> = Promise.resolve();

export function publishCurrentSqliteLibraryToGoogleDrive(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreCloudPublishResult> {
  const result = publicationChain.then(() =>
    publishCurrentSqliteLibraryToGoogleDriveInternal(input),
  );
  publicationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function startSqliteLibraryGoogleDriveSync(input: {
  readonly accessToken: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly resolveAccessToken: () => Promise<string>;
}): Promise<LibraryCoreCloudPublishResult> {
  stopSqliteLibraryCloudSync();
  const abortController = new AbortController();
  running = { abortController, timer: null };
  const publish = async (accessToken: string): Promise<LibraryCoreCloudPublishResult> =>
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

  const poll = async (): Promise<void> => {
    if (running?.abortController !== abortController || abortController.signal.aborted) return;
    try {
      const status = await sqliteLibraryStatus();
      const state = await readNativeJsonValue(STATE_FILE, STATE_KEY);
      if (
        status?.active === true
        && isCloudState(state)
        && state.lastPublishedRevision !== status.revision
      ) {
        const result = await publish(await input.resolveAccessToken());
        if (result.status === "ownership_required") {
          stopSqliteLibraryCloudSync();
          return;
        }
      }
    } finally {
      if (running?.abortController === abortController && !abortController.signal.aborted) {
        running.timer = setTimeout(() => void poll().catch(console.error), LOCAL_REVISION_POLL_MS);
      }
    }
  };
  running.timer = setTimeout(() => void poll().catch(console.error), LOCAL_REVISION_POLL_MS);
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
