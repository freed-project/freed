import {
  decodeLibraryCoreCanonicalValue,
  parseLibraryCoreControlPointerV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  provisionGoogleDriveLibraryCoreControlV1,
  publishLibraryCorePortableCheckpointV1,
  type GoogleDriveFetch,
  type LibraryCoreControlReadV1,
} from "@freed/sync/cloud";
import { decodeJson } from "@freed/shared/projection";
import type { FeedItem } from "@freed/shared";
import { getOrCreateDesktopClientRegistration } from "./desktop-client-registration";
import {
  readSqliteLibrarySyncDescriptor,
  readSqliteLibrarySyncPage,
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
): Promise<LibraryCorePortableCheckpointHeaderV1> {
  const frontierDigest = await sha256Text([
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
