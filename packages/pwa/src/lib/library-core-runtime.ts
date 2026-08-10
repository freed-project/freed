import {
  createDefaultPreferences,
  friendFromPerson,
  type Account,
  type FeedItem,
  type Person,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  libraryCoreFeedCardToItemV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreControlPointerV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import type { FilterOptions } from "@freed/shared";
import type { BoundedFeedReader } from "@freed/ui/context";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  importLibraryCorePortableCheckpointV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
  publishLibraryCoreIntentCandidateV1,
} from "@freed/sync/cloud";
import type { DocState } from "./automerge-types";
import { registerPwaFactoryResetQuiesceHandler } from "./factory-reset-coordinator";
import { createPwaLibraryCorePortableCheckpointStore } from "./library-core-portable-checkpoint-store";

export const PWA_LIBRARY_CORE_ENABLED_KEY =
  "freed.libraryCore.pwaIndexedDbV1.enabled";

const DATABASE_NAME = "freed-library-core-portable-v1";
const MAXIMUM_INITIAL_FEED_ITEMS = 512;
const COLLECTION_PAGE_LIMIT = 128;
const MAXIMUM_INTENT_SEGMENTS_PER_SYNC = 128;

type LibraryCoreStateListener = (state: DocState) => void;

const listeners = new Set<LibraryCoreStateListener>();
let lastState: DocState | null = null;

let portableStore: ReturnType<
  typeof createPwaLibraryCorePortableCheckpointStore
> | null = null;

function getPortableStore(): ReturnType<
  typeof createPwaLibraryCorePortableCheckpointStore
> {
  portableStore ??= createPwaLibraryCorePortableCheckpointStore({
    databaseName: DATABASE_NAME,
    indexedDb: globalThis.indexedDB,
    keyRange: globalThis.IDBKeyRange,
    subtle: globalThis.crypto.subtle,
  });
  return portableStore;
}

function emptyState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  };
}

function stateFromShell(
  shell: Readonly<Record<string, LibraryCoreCanonicalValue>>,
  items: FeedItem[],
): DocState {
  const base = { ...emptyState(), ...shell } as DocState;
  const persons = base.persons as Record<string, Person>;
  const accounts = base.accounts as Record<string, Account>;
  return {
    ...base,
    items,
    friends: Object.fromEntries(
      Object.values(persons).map((person) => [
        person.id,
        friendFromPerson(person, accounts),
      ]),
    ),
  };
}

function materializedEntry(
  value: LibraryCoreCanonicalValue,
): { readonly registryKey: string; readonly row: unknown } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  if (
    typeof record.registry_key !== "string" ||
    typeof record.row !== "object" ||
    record.row === null ||
    Array.isArray(record.row)
  ) {
    return null;
  }
  return { registryKey: record.registry_key, row: record.row };
}

async function readSelectedState(): Promise<DocState | null> {
  const store = getPortableStore();
  const shell = await store.readSelectedMaterializedRow(
    "00_library_shell",
    "shell",
  );
  if (!shell) return null;

  const items: FeedItem[] = [];
  let afterOrdinal: number | null = null;
  do {
    const page = await store.readSelectedCollectionPage({
      afterOrdinal,
      collection: "materialized_rows",
      limit: COLLECTION_PAGE_LIMIT,
    });
    for (const entry of page.entries) {
      const materialized = materializedEntry(entry.value);
      if (materialized?.registryKey === "10_feed_items") {
        items.push(materialized.row as FeedItem);
        if (items.length >= MAXIMUM_INITIAL_FEED_ITEMS) break;
      }
    }
    afterOrdinal = page.nextOrdinal;
  } while (afterOrdinal !== null && items.length < MAXIMUM_INITIAL_FEED_ITEMS);

  return stateFromShell(shell, items);
}

function publishState(state: DocState): void {
  lastState = state;
  for (const listener of listeners) listener(state);
}

export function isPwaLibraryCoreEnabled(): boolean {
  try {
    return localStorage.getItem(PWA_LIBRARY_CORE_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribePwaLibraryCoreState(
  listener: LibraryCoreStateListener,
): () => void {
  listeners.add(listener);
  if (lastState) listener(lastState);
  return () => listeners.delete(listener);
}

export async function initializePwaLibraryCoreState(): Promise<DocState> {
  const state = (await readSelectedState()) ?? emptyState();
  publishState(state);
  return state;
}

/** Queue a signed, durable PWA read-state intent without touching Automerge. */
export async function enqueuePwaLibraryCoreReadAssignments(
  globalIds: readonly string[],
): Promise<void> {
  if (globalIds.length === 0) return;
  await getPortableStore().enqueueReadAssignments({
    entityIds: globalIds,
    readAtMs: Date.now(),
  });
}

function supportsPortableFeedFilter(filter: FilterOptions): boolean {
  const normalized = normalizeLibraryCoreFeedBrowseFilterV1(filter);
  return !normalized.archivedOnly && normalized.authorId === null &&
    normalized.feedUrl === null && normalized.platform === null &&
    !normalized.savedOnly && !normalized.showHidden &&
    normalized.signals.length === 0 && normalized.socialContentFilter === "all" &&
    normalized.tags.length === 0;
}

/** Open the complete ordinary feed directly from the selected IndexedDB generation. */
export async function openPwaLibraryCoreFeedReader(
  filter: FilterOptions,
): Promise<BoundedFeedReader> {
  if (!supportsPortableFeedFilter(filter)) {
    throw new Error("This SQLite Library filter does not have a bounded PWA reader yet");
  }
  const store = getPortableStore();
  const readerSessionId = crypto.randomUUID();
  let cursor: string | null = null;
  let closed = false;
  let lastCancellationId = crypto.randomUUID();
  let firstPage: Awaited<ReturnType<typeof store.readSelectedFeedPage>> | null =
    await store.readSelectedFeedPage({
      cancellationId: lastCancellationId,
      cursor: null,
      limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
  if (!firstPage.ok) throw new Error(firstPage.message);
  cursor = firstPage.value.nextCursor;
  const totalCount = firstPage.value.totalCount;
  return Object.freeze({
    totalCount,
    async readNext() {
      if (closed) return Object.freeze([]);
      if (firstPage) {
        const page = firstPage;
        firstPage = null;
        if (!page.ok) throw new Error(page.message);
        return Object.freeze(page.value.rows.map(libraryCoreFeedCardToItemV1));
      }
      if (cursor === null) return Object.freeze([]);
      lastCancellationId = crypto.randomUUID();
      const page = await store.readSelectedFeedPage({
        cancellationId: lastCancellationId,
        cursor,
        limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
        queryId: "feed_page_v1",
        readerSessionId,
        schemaVersion: 1,
      });
      if (!page.ok) throw new Error(page.message);
      cursor = page.value.nextCursor;
      return Object.freeze(page.value.rows.map(libraryCoreFeedCardToItemV1));
    },
    async close() {
      store.cancelSelectedFeedReader(readerSessionId, lastCancellationId);
      closed = true;
      firstPage = null;
      cursor = null;
    },
  });
}

/**
 * Import the sole published immutable Desktop checkpoint into IndexedDB.
 * This path is dormant unless the explicit local activation key is set.
 */
export async function syncPwaLibraryCoreFromGoogleDrive(input: {
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}): Promise<DocState> {
  const discovered = await discoverPublishedGoogleDriveLibraryCoreControlV1({
    accessToken: input.accessToken,
    signal: input.signal,
  });
  if (!discovered) {
    throw new Error("No published SQLite Library was found in Google Drive");
  }
  const decoded = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(discovered.control.bytes),
  );
  const pointer = parseLibraryCoreControlPointerV1(decoded);
  if (pointer.libraryId !== discovered.libraryId) {
    throw new Error("Discovered Library identity changed during control read");
  }
  const adapter = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: input.accessToken,
    controlFileId: discovered.controlFileId,
    libraryId: pointer.libraryId,
    signal: input.signal,
  });
  await importLibraryCorePortableCheckpointV1({
    adapter,
    generation: pointer.generation,
    libraryId: pointer.libraryId,
    manifest: pointer.manifest,
    storageEpoch: pointer.storageEpoch,
    subtle: crypto.subtle,
    writer: getPortableStore(),
  });
  const store = getPortableStore();
  const acceptedAuthority = await store.readSelectedAcceptedAuthorityState();
  if (acceptedAuthority === null) {
    throw new Error("Imported SQLite Library checkpoint has no accepted authority");
  }
  const enrollments = await discoverGoogleDriveLibraryCoreActorEnrollmentsV1({
    accessToken: input.accessToken,
    epochId: acceptedAuthority.epoch_id,
    libraryId: acceptedAuthority.library_id,
    signal: input.signal,
  });
  for (const enrollment of enrollments) {
    await store.installActorEnrollment({
      acceptedAuthorityState: acceptedAuthority,
      certificateBytes: enrollment.bytes,
    });
  }
  const enrollment = await store.preparePwaActorEnrollmentRequest();
  if (enrollment && enrollment.publishedReference === null) {
    const uploaded = await adapter.putImmutable(enrollment.immutableObject);
    const reference = Object.freeze({
      descriptor: enrollment.immutableObject.descriptor,
      transportObjectId: uploaded.transportObjectId,
    });
    await adapter.verifyImmutable(reference);
    await store.recordPwaActorEnrollmentRequestPublication({
      actorId: enrollment.actorId,
      authorityStateDigest: enrollment.authorityStateDigest,
      libraryId: enrollment.acceptedAuthorityState.library_id as unknown as LibraryCoreOperationInstanceId,
      reference,
    });
  }
  const pendingActors = await store.readPendingIntentActors({
    epochId: pointer.storageEpoch,
    libraryId: pointer.libraryId,
  });
  for (const actor of pendingActors) {
    let candidate = await store.readUnpublishedIntentSegmentCandidate(actor);
    if (candidate === null) continue;
    const provisioned = await provisionGoogleDriveLibraryCoreIntentHeadV1({
      accessToken: input.accessToken,
      head: candidate.expectedHead,
      signal: input.signal,
    });
    const intentAdapter = createGoogleDriveLibraryCoreIntentAdapterV1({
      accessToken: input.accessToken,
      actorId: actor.actorId,
      controlFileId: discovered.controlFileId,
      intentHeadFileId: provisioned.intentHeadFileId,
      libraryId: pointer.libraryId,
      signal: input.signal,
    });
    let publishedSegmentCount = 0;
    while (candidate !== null) {
      if (publishedSegmentCount >= MAXIMUM_INTENT_SEGMENTS_PER_SYNC) {
        throw new Error("PWA intent publication exceeded its sync bound");
      }
      const published = await publishLibraryCoreIntentCandidateV1({
        adapter: intentAdapter,
        candidate,
        subtle: crypto.subtle,
      });
      if (published.status === "conflict") {
        throw new Error(
          `PWA intent head changed for actor ...${actor.actorId.slice(-8)}`,
        );
      }
      await store.recordIntentSegmentPublication(published);
      publishedSegmentCount += 1;
      candidate = await store.readUnpublishedIntentSegmentCandidate(actor);
    }
  }
  const state = await readSelectedState();
  if (!state) {
    throw new Error("Imported SQLite Library checkpoint has no readable shell");
  }
  publishState(state);
  return state;
}

registerPwaFactoryResetQuiesceHandler(
  "library-core-indexeddb",
  async () => {
    await portableStore?.quiesce();
    portableStore = null;
    lastState = null;
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(DATABASE_NAME);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("SQLite Library reset failed")),
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => reject(new Error("SQLite Library reset was blocked by another tab")),
        { once: true },
      );
    });
  },
  25,
);
