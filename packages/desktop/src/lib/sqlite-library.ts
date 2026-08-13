/**
 * SQLite-only Freed Desktop Library runtime.
 *
 * Automerge is allowed to appear exactly once: the migration caller supplies
 * one already-hydrated legacy snapshot. After activation every operation in
 * this module talks directly to native SQLite.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createDefaultPreferences,
  friendFromPerson,
  hasSampleDataFingerprint,
  type FeedItem,
  type ReachOutLog,
  type UserPreferences,
} from "@freed/shared";
import { decodeJson, encodeJson } from "@freed/shared/projection";
import type { LibraryCoreAcceptedAuthorityStateV1 } from "@freed/shared/library-core";
import type {
  CommittedDocSnapshot,
  DocChangeEvent,
  DocState,
  WorkerRequest,
} from "./automerge-types";
import { recordRuntimeHealthEvent } from "./runtime-health-events";
import { mergeSqliteFeedItem } from "./sqlite-feed-item-merge";

export interface SqliteStatus {
  active: boolean;
  revision: number;
  expectedItemCount: number;
  importedItemCount: number;
  sourceGeneration: number;
  sourceRevision: number;
  sourceDigest: string;
}

export interface SqliteLibrarySyncDescriptor {
  revision: number;
  itemCount: number;
  sourceDigest: string;
  shellJson: string;
  materializedDigest: string;
}

export interface SqliteLibrarySyncPage {
  revision: number;
  itemsJson: string[];
  nextOffset: number | null;
}

export type SqliteLibraryAcceptedAuthority =
  LibraryCoreAcceptedAuthorityStateV1;

export interface SqliteLibraryAuthorityBootstrap {
  readonly authority: SqliteLibraryAcceptedAuthority;
  readonly actor: Readonly<{
    readonly actor_id: string;
    readonly actor_public_key: string;
    readonly enrollment_operation_id: string;
    readonly enrollment_certificate_digest: string;
    readonly canonical_enrollment_certificate_json: string;
    readonly actor_chain_genesis: string;
  }>;
}

export interface SqliteLibraryWriterEpochReassignment
  extends SqliteLibraryAuthorityBootstrap {
  readonly canonicalEpochCertificateJson: string;
}

export interface SqliteLibraryActorCheckpointState {
  readonly actor_id: string;
  readonly accepted_sequence: number;
  readonly accepted_operation_id: string | null;
  readonly accepted_chain_digest: string;
  readonly enrollment_certificate_digest: string;
  readonly retired: false;
  readonly retirement_certificate_digest: null;
  readonly canonical_enrollment_certificate_json: string;
}

export interface SqliteLibraryIntentResultOutboxEntry {
  readonly resultOperationId: string;
  readonly actorId: string;
  readonly resultSequence: number;
  readonly intentOperationId: string;
  readonly intentSequence: number;
  readonly status: "accepted" | "provider_completed" | "provider_failed";
  readonly providerReceiptDigest: string | null;
  readonly enqueuedAtMs: number;
}

export interface SqliteLibraryCloudWriterAdmissionStatus {
  readonly configured: boolean;
  readonly allowed: boolean;
  readonly localWriterId: string | null;
  readonly activeWriterId: string | null;
  readonly storageEpoch: string | null;
  readonly controlRevision: string | null;
  readonly verifiedAtMs: number | null;
}

export async function setSqliteLibraryCloudWriterAdmission(input: {
  readonly localWriterId: string;
  readonly activeWriterId: string;
  readonly storageEpoch: string;
  readonly controlRevision: string;
}): Promise<SqliteLibraryCloudWriterAdmissionStatus> {
  return invoke<SqliteLibraryCloudWriterAdmissionStatus>(
    "set_sqlite_library_cloud_writer_admission",
    { request: { ...input, verifiedAtMs: Date.now() } },
  );
}

export async function sqliteLibraryCloudWriterAdmissionStatus(): Promise<
  SqliteLibraryCloudWriterAdmissionStatus
> {
  return invoke<SqliteLibraryCloudWriterAdmissionStatus>(
    "sqlite_library_cloud_writer_admission_status",
  );
}

export interface PortableSqliteLibraryImportRequest {
  expectedItemCount: number;
  shell: unknown;
  sourceDigest: string;
  sourceGeneration: number;
  sourceRevision: number;
}

interface SqliteShell {
  shellJson: string;
  revision: number;
  itemCount: number;
  unreadCount: number;
  archivableCount: number;
  countsByPlatform: Record<string, number>;
  unreadByPlatform: Record<string, number>;
}

interface SqliteQueryResult {
  itemsJson: string[];
  nextOffset: number | null;
  totalCount: number;
}

interface SqliteSearchMatch {
  itemJson: string;
  score: number;
}

interface SqliteSearchPage {
  matches: SqliteSearchMatch[];
  nextAfterGlobalId: string | null;
}

export interface SqliteLibraryBackupSummary {
  backupId: string;
  fileName: string;
  createdAtMs: number;
  revision: number;
  itemCount: number;
  reason: "auto" | "manual";
  byteLength: number;
  sha256: string;
}

export interface SqliteLibraryBackupChunk {
  readonly backupId: string;
  readonly bytes: number[];
  readonly nextOffset: number | null;
  readonly offset: number;
  readonly sha256: string;
  readonly totalByteLength: number;
}

let sqliteActive = false;

const LEGACY_IMPORT_MAX_BATCH_ITEMS = 128;
const LEGACY_IMPORT_MAX_BATCH_BYTES = 512 * 1_024;

interface EncodedImportItem {
  readonly globalId: string;
  readonly json: string;
  readonly sourceIndex: number;
  readonly utf8Bytes: number;
}

function replaceUnpairedSurrogates(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index] + value[index + 1];
        index += 1;
      } else {
        normalized += "\ufffd";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      normalized += "\ufffd";
    } else {
      normalized += value[index];
    }
  }
  return normalized;
}

function normalizeLegacyUnicode(value: unknown): unknown {
  if (typeof value === "string") return replaceUnpairedSurrogates(value);
  if (Array.isArray(value)) return value.map(normalizeLegacyUnicode);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        replaceUnpairedSurrogates(key),
        normalizeLegacyUnicode(entry),
      ]),
    );
  }
  return value;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function* legacyImportBatches(
  items: readonly FeedItem[],
): Generator<EncodedImportItem[]> {
  let batch: EncodedImportItem[] = [];
  let batchBytes = 0;
  const encoder = new TextEncoder();

  for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
    const item = items[sourceIndex];
    if (!item) continue;
    // Old provider captures can contain isolated UTF-16 surrogate halves.
    // JavaScript permits them, but Rust strings and SQLite's UTF-8 boundary do
    // not. Preserve the record and replace only those invalid scalar values.
    const json = encodeJson(normalizeLegacyUnicode(item));
    const encoded: EncodedImportItem = {
      globalId: item.globalId,
      json,
      sourceIndex,
      utf8Bytes: encoder.encode(json).byteLength,
    };
    if (
      batch.length > 0 &&
      (batch.length >= LEGACY_IMPORT_MAX_BATCH_ITEMS ||
        batchBytes + encoded.utf8Bytes > LEGACY_IMPORT_MAX_BATCH_BYTES)
    ) {
      yield batch;
      batch = [];
      batchBytes = 0;
    }
    batch.push(encoded);
    batchBytes += encoded.utf8Bytes;
  }
  if (batch.length > 0) yield batch;
}

async function appendLegacyImportBatch(
  batch: readonly EncodedImportItem[],
  updatedAtMs: number,
): Promise<void> {
  try {
    await invoke("append_sqlite_library_import", {
      request: {
        // Keep the nested JSON bytes opaque across Tauri's own JSON command
        // envelope. This preserves non-BMP text exactly between WebKit and Rust.
        itemsBase64: batch.map((item) => encodeUtf8Base64(item.json)),
        updatedAtMs,
      },
    });
  } catch (error) {
    // Tauri transports one JSON request through WebKit. If a platform rejects
    // a multi-record request despite the byte bound, split it without losing
    // import progress. A single-record failure reports the exact source item.
    if (batch.length > 1) {
      const midpoint = Math.ceil(batch.length / 2);
      await appendLegacyImportBatch(batch.slice(0, midpoint), updatedAtMs);
      await appendLegacyImportBatch(batch.slice(midpoint), updatedAtMs);
      return;
    }
    const item = batch[0];
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite Library import rejected item ${item?.globalId ?? "unknown"} at source index ${item?.sourceIndex.toLocaleString() ?? "unknown"} (${item?.utf8Bytes.toLocaleString() ?? "unknown"} bytes): ${message}`,
      { cause: error },
    );
  }
}

export function isSqliteLibraryActive(): boolean {
  return sqliteActive;
}

function emptyShell(): Omit<DocState, "items"> {
  return {
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
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
    docItemCount: 0,
  };
}

function shellFromState(state: DocState): Omit<DocState, "items"> {
  const { items: _items, ...shell } = state;
  return shell;
}

function stateFromShell(result: SqliteShell, items: FeedItem[] = []): DocState {
  const decoded = decodeJson(result.shellJson) as Partial<DocState>;
  const base = { ...emptyShell(), ...decoded };
  const friends = Object.fromEntries(
    Object.values(base.persons).map((person) => [
      person.id,
      friendFromPerson(person, base.accounts),
    ]),
  );
  return {
    ...base,
    items,
    friends,
    searchCorpusVersion: result.revision,
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: result.unreadCount,
    unreadCountByPlatform: result.unreadByPlatform,
    totalItemCount: result.itemCount,
    itemCountByPlatform: result.countsByPlatform,
    totalArchivableCount: result.archivableCount,
    docItemCount: result.itemCount,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sqliteLibraryStatus(): Promise<SqliteStatus | null> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const status = await invoke<SqliteStatus | null>("sqlite_library_status");
  sqliteActive = status?.active === true;
  return status;
}

export async function readSqliteLibrarySyncDescriptor(): Promise<SqliteLibrarySyncDescriptor> {
  return invoke<SqliteLibrarySyncDescriptor>("read_sqlite_library_sync_descriptor");
}

/** Establish and read the active SQLite Library's signed authority and Desktop actor. */
export async function bootstrapSqliteLibraryAuthority(): Promise<SqliteLibraryAuthorityBootstrap> {
  const installationWitness = await invoke<string>("get_desktop_installation_witness");
  if (!/^[a-f0-9]{64}$/.test(installationWitness)) {
    throw new TypeError("Freed Desktop returned an invalid installation witness");
  }
  return invoke<SqliteLibraryAuthorityBootstrap>(
    "bootstrap_sqlite_library_authority",
    {
      request: {
        installationWitness,
        acceptedAtMs: Date.now(),
      },
    },
  );
}

/** Create or replay the signed native epoch used by one exact writer CAS. */
export async function reassignSqliteLibraryWriterEpoch(input: {
  readonly canonicalSourceControlJson: string;
  readonly libraryId: string;
  readonly targetWriterId: string;
}): Promise<SqliteLibraryWriterEpochReassignment> {
  const installationWitness = await invoke<string>("get_desktop_installation_witness");
  if (!/^[a-f0-9]{64}$/.test(installationWitness)) {
    throw new TypeError("Freed Desktop returned an invalid installation witness");
  }
  return invoke<SqliteLibraryWriterEpochReassignment>(
    "reassign_sqlite_library_writer_epoch",
    {
      request: {
        ...input,
        installationWitness,
        acceptedAtMs: Date.now(),
      },
    },
  );
}

/** Countersign and enroll one proof-only PWA actor request in native SQLite. */
export async function acceptPwaActorEnrollmentRequest(
  canonicalRequestBytes: Uint8Array,
): Promise<SqliteLibraryAuthorityBootstrap["actor"]> {
  if (canonicalRequestBytes.byteLength === 0 || canonicalRequestBytes.byteLength > 65_536) {
    throw new RangeError("PWA actor enrollment request has an invalid size");
  }
  return invoke<SqliteLibraryAuthorityBootstrap["actor"]>(
    "accept_pwa_actor_enrollment_request",
    {
      request: {
        canonicalRequestJson: new TextDecoder("utf-8", { fatal: true }).decode(
          canonicalRequestBytes,
        ),
      },
    },
  );
}

/** Admit one complete signed PWA intent transaction into SQLite. */
export async function acceptPwaIntentTransaction(
  canonicalEnvelopeJson: readonly string[],
): Promise<readonly SqliteLibraryIntentResultOutboxEntry[]> {
  if (canonicalEnvelopeJson.length === 0 || canonicalEnvelopeJson.length > 1_000) {
    throw new RangeError("PWA intent transaction has an invalid member count");
  }
  return invoke<SqliteLibraryIntentResultOutboxEntry[]>("accept_pwa_intent_transaction", {
    request: {
      canonicalEnvelopeJson: [...canonicalEnvelopeJson],
      committedAtMs: Date.now(),
    },
  });
}

export async function readPwaIntentResultOutbox(
  input: Readonly<{ libraryId: string; epochId: string }>,
  limit = 256,
): Promise<readonly SqliteLibraryIntentResultOutboxEntry[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new RangeError("PWA result outbox page limit is invalid");
  }
  return invoke<SqliteLibraryIntentResultOutboxEntry[]>(
    "read_pwa_intent_result_outbox",
    { request: { ...input, limit } },
  );
}

export async function acknowledgePwaIntentResultOutbox(
  resultOperationIds: readonly string[],
): Promise<void> {
  if (resultOperationIds.length < 1 || resultOperationIds.length > 256) {
    throw new RangeError("PWA result acknowledgement count is invalid");
  }
  return invoke("acknowledge_pwa_intent_result_outbox", {
    request: {
      resultOperationIds: [...resultOperationIds],
      acknowledgedAtMs: Date.now(),
    },
  });
}

export async function listSqliteLibraryActorEnrollments(input: {
  readonly libraryId: string;
  readonly epochId: string;
}): Promise<readonly SqliteLibraryActorCheckpointState[]> {
  return invoke<SqliteLibraryActorCheckpointState[]>(
    "list_sqlite_library_actor_enrollments",
    { request: input },
  );
}

export async function readSqliteLibrarySyncPage(input: {
  revision: number;
  offset: number;
  limit?: number;
}): Promise<SqliteLibrarySyncPage> {
  return invoke<SqliteLibrarySyncPage>("read_sqlite_library_sync_page", {
    request: {
      revision: input.revision,
      offset: input.offset,
      limit: input.limit ?? 128,
    },
  });
}

export async function beginPortableSqliteLibraryImport(
  request: PortableSqliteLibraryImportRequest,
): Promise<void> {
  await invoke("begin_sqlite_library_import", {
    request: {
      expectedItemCount: request.expectedItemCount,
      shellJson: encodeJson(request.shell),
      sourceDigest: request.sourceDigest,
      sourceGeneration: request.sourceGeneration,
      sourceRevision: request.sourceRevision,
      startedAtMs: Date.now(),
    },
  });
  sqliteActive = false;
}

export async function appendPortableSqliteLibraryItems(
  items: readonly unknown[],
): Promise<void> {
  if (items.length === 0) return;
  for (let start = 0; start < items.length; start += 1_000) {
    await invoke("append_sqlite_library_import", {
      request: {
        itemsBase64: items
          .slice(start, start + 1_000)
          .map((item) => encodeUtf8Base64(encodeJson(item))),
        updatedAtMs: Date.now(),
      },
    });
  }
}

export async function finalizePortableSqliteLibraryImport(): Promise<SqliteStatus> {
  const status = await invoke<SqliteStatus>("finalize_sqlite_library_import", {
    activatedAtMs: Date.now(),
  });
  sqliteActive = status.active;
  return status;
}

export async function loadSqliteLibraryState(): Promise<DocState> {
  const result = await invoke<SqliteShell>("read_sqlite_library_shell");
  sqliteActive = true;
  // Browser E2E tests deliberately keep the legacy renderer projection so
  // their UI assertions can exercise cards, maps, and mutations without a
  // native process. Production Freed Desktop never takes this branch and
  // continues to hold only bounded SQLite pages in renderer memory.
  if (import.meta.env.VITE_TEST_TAURI === "1") {
    const items: FeedItem[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await querySqliteItems({ offset, limit: 128, showHidden: true });
      items.push(...page.items);
      offset = page.nextOffset;
    }
    return stateFromShell(result, items);
  }
  return stateFromShell(result);
}

/** Import one exact legacy snapshot in bounded item batches, then activate it. */
export async function importLegacyLibraryIntoSqlite(
  state: DocState,
  source: CommittedDocSnapshot,
): Promise<DocState> {
  const sourceDigest = await sha256Hex(source.binary);
  await invoke("begin_sqlite_library_import", {
    request: {
      sourceGeneration: source.revision.generation,
      sourceRevision: source.revision.saveRevision,
      sourceDigest,
      expectedItemCount: state.items.length,
      shellJson: encodeJson(shellFromState(state)),
      startedAtMs: Date.now(),
    },
  });

  try {
    for (const batch of legacyImportBatches(state.items)) {
      await appendLegacyImportBatch(batch, Date.now());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordRuntimeHealthEvent({
      event: "sqlite_library_migration_failed",
      itemCount: state.items.length,
      message: message.slice(0, 1_024),
      sourceGeneration: source.revision.generation,
      sourceRevision: source.revision.saveRevision,
    });
    throw error;
  }
  await invoke("finalize_sqlite_library_import", { activatedAtMs: Date.now() });
  sqliteActive = true;
  return loadSqliteLibraryState();
}

async function replaceShell(state: DocState): Promise<void> {
  await invoke("replace_sqlite_library_shell", {
    request: { shellJson: encodeJson(shellFromState(state)) },
  });
}

async function upsertSqliteItems(items: readonly FeedItem[]): Promise<void> {
  if (items.length === 0) return;
  for (let start = 0; start < items.length; start += 1_000) {
    await invoke("upsert_sqlite_library_items", {
      request: {
        itemsBase64: items
          .slice(start, start + 1_000)
          .map((item) => encodeUtf8Base64(encodeJson(item))),
        updatedAtMs: Date.now(),
      },
    });
  }
}

export async function readSqliteItems(ids: readonly string[]): Promise<FeedItem[]> {
  if (ids.length === 0) return [];
  const encoded = await invoke<string[]>("read_sqlite_library_items", {
    request: { ids: [...ids] },
  });
  return encoded.map((item) => decodeJson(item) as FeedItem);
}

async function insertMissingSqliteItems(items: readonly FeedItem[]): Promise<FeedItem[]> {
  if (items.length === 0) return [];
  const existing = new Set(
    (await readSqliteItems(items.map((item) => item.globalId))).map((item) => item.globalId),
  );
  const missing = items.filter((item) => !existing.has(item.globalId));
  await upsertSqliteItems(missing);
  return missing;
}

async function mergeIncomingSqliteItems(items: readonly FeedItem[]): Promise<FeedItem[]> {
  if (items.length === 0) return [];
  const existing = new Map(
    (await readSqliteItems(items.map((item) => item.globalId)))
      .map((item) => [item.globalId, item] as const),
  );
  const merged = items.map((incoming) => {
    const current = existing.get(incoming.globalId);
    if (!current) return incoming;
    return mergeSqliteFeedItem(current, incoming);
  });
  await upsertSqliteItems(merged);
  return merged;
}

export async function querySqliteItems(options: {
  query?: string;
  platform?: string;
  authorId?: string;
  feedUrl?: string;
  saved?: boolean;
  archived?: boolean;
  showHidden?: boolean;
  offset?: number;
  limit?: number;
} = {}): Promise<{ items: FeedItem[]; nextOffset: number | null; totalCount: number }> {
  const result = await invoke<SqliteQueryResult>("query_sqlite_library_items", {
    request: {
      query: options.query ?? null,
      platform: options.platform ?? null,
      authorId: options.authorId ?? null,
      feedUrl: options.feedUrl ?? null,
      saved: options.saved ?? null,
      archived: options.archived ?? null,
      showHidden: options.showHidden ?? false,
      offset: options.offset ?? 0,
      limit: options.limit ?? 64,
    },
  });
  return {
    items: result.itemsJson.map((item) => decodeJson(item) as FeedItem),
    nextOffset: result.nextOffset,
    totalCount: result.totalCount,
  };
}

export async function searchSqliteItemsPage(
  query: string,
  afterGlobalId: string | null,
  limit = 32,
): Promise<{
  matches: Array<{ item: FeedItem; score: number }>;
  nextAfterGlobalId: string | null;
}> {
  const page = await invoke<SqliteSearchPage>("search_sqlite_library_items", {
    request: { query, afterGlobalId, limit },
  });
  return {
    matches: page.matches.map(({ itemJson, score }) => ({
      item: decodeJson(itemJson) as FeedItem,
      score,
    })),
    nextAfterGlobalId: page.nextAfterGlobalId,
  };
}

async function mutateItems(
  mutation: string,
  options: {
    ids?: readonly string[];
    platform?: string;
    feedUrl?: string;
    timestampMs?: number;
    maxAgeMs?: number;
  } = {},
): Promise<number> {
  const ids = options.ids ?? [];
  const timestampMs = options.timestampMs ?? Date.now();
  const invokeBatch = (batch: readonly string[]) =>
    invoke<number>("mutate_sqlite_library_items", {
      request: {
        mutation,
        ids: [...batch],
        platform: options.platform ?? null,
        feedUrl: options.feedUrl ?? null,
        timestampMs,
        maxAgeMs: options.maxAgeMs ?? null,
      },
    });
  if (ids.length === 0) return invokeBatch([]);
  let affected = 0;
  for (let start = 0; start < ids.length; start += 1_000) {
    affected += await invokeBatch(ids.slice(start, start + 1_000));
  }
  return affected;
}

function deepMerge<T>(current: T, update: Partial<T>): T {
  if (!current || !update || typeof current !== "object" || typeof update !== "object") {
    return update as T;
  }
  const next = { ...(current as Record<string, unknown>) };
  for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
    const previous = next[key];
    next[key] =
      previous && value && typeof previous === "object" && typeof value === "object"
        && !Array.isArray(previous) && !Array.isArray(value)
        ? deepMerge(previous, value)
        : value;
  }
  return next as T;
}

async function latestState(): Promise<DocState> {
  return loadSqliteLibraryState();
}

async function saveMetadataMutation(
  current: DocState,
  update: (next: DocState) => void,
): Promise<void> {
  const next: DocState = {
    ...current,
    feeds: { ...current.feeds },
    persons: { ...current.persons },
    accounts: { ...current.accounts },
    friends: { ...current.friends },
    preferences: { ...current.preferences },
  };
  update(next);
  await replaceShell(next);
}

export async function dispatchSqliteMutation(
  message: WorkerRequest,
  current: DocState,
): Promise<{ state: DocState; event: DocChangeEvent; result?: unknown }> {
  const timestamp = Date.now();
  let changedIds: string[] = [];
  let source: DocChangeEvent["source"] = "state_update";
  let result: unknown;

  switch (message.type) {
    case "ADD_FEED_ITEM": {
      const inserted = await insertMissingSqliteItems([message.item]);
      changedIds = inserted.map((item) => item.globalId);
      break;
    }
    case "ADD_FEED_ITEMS":
    case "BATCH_IMPORT_ITEMS": {
      const inserted = await insertMissingSqliteItems(message.items);
      changedIds = inserted.map((item) => item.globalId);
      break;
    }
    case "RECONCILE_YOUTUBE_CAPTURE":
    case "RECONCILE_FOLLOW_ROSTER_CAPTURE": {
      const merged = await mergeIncomingSqliteItems(message.items);
      await saveMetadataMutation(current, (next) => {
        const incomingIds = new Set(message.accounts.map((account) => account.id));
        for (const account of message.accounts) {
          const existing = next.accounts[account.id];
          next.accounts[account.id] = existing ? { ...existing, ...account } : account;
        }
        if (message.type === "RECONCILE_YOUTUBE_CAPTURE" && message.options.rosterComplete) {
          for (const [id, account] of Object.entries(next.accounts)) {
            if (
              account.provider === "youtube" && account.discoveredFrom === "follow_roster" &&
              !incomingIds.has(id)
            ) {
              next.accounts[id] = {
                ...account,
                followRosterActive: false,
                followRosterSyncedAt: message.options.capturedAt,
                updatedAt: message.options.capturedAt,
              };
            }
          }
        }
      });
      changedIds = merged.map((item) => item.globalId);
      break;
    }
    case "ADD_SAMPLE_LIBRARY_DATA":
      await insertMissingSqliteItems(message.items);
      await saveMetadataMutation(current, (next) => {
        for (const feed of message.feeds) next.feeds[feed.url] = feed;
        for (const person of message.persons) next.persons[person.id] = person;
        for (const account of message.accounts) next.accounts[account.id] = account;
      });
      changedIds = message.items.map((item) => item.globalId);
      break;
    case "CLEAR_SAMPLE_DATA": {
      const samplePersonIds = new Set(
        Object.values(current.persons)
          .filter(hasSampleDataFingerprint)
          .map((person) => person.id),
      );
      const summary = {
        feeds: Object.values(current.feeds).filter(hasSampleDataFingerprint).length,
        items: await mutateItems("clear_sample", { timestampMs: timestamp }),
        persons: samplePersonIds.size,
        accounts: Object.values(current.accounts).filter(hasSampleDataFingerprint).length,
        total: 0,
      };
      summary.total = summary.feeds + summary.items + summary.persons + summary.accounts;
      await saveMetadataMutation(current, (next) => {
        for (const [url, feed] of Object.entries(next.feeds)) {
          if (hasSampleDataFingerprint(feed)) delete next.feeds[url];
        }
        for (const [id, account] of Object.entries(next.accounts)) {
          if (hasSampleDataFingerprint(account)) {
            delete next.accounts[id];
          } else if (account.personId && samplePersonIds.has(account.personId)) {
            next.accounts[id] = { ...account, personId: undefined, updatedAt: timestamp };
          }
        }
        for (const personId of samplePersonIds) delete next.persons[personId];
      });
      result = summary;
      break;
    }
    case "UPDATE_FEED_ITEM": {
      const [item] = await readSqliteItems([message.globalId]);
      if (item) await upsertSqliteItems([deepMerge(item, message.updates)]);
      changedIds = [message.globalId];
      break;
    }
    case "MARK_AS_READ":
      await mutateItems("mark_read", { ids: [message.globalId], timestampMs: timestamp });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "MARK_ITEMS_AS_READ":
      await mutateItems("mark_read", { ids: message.globalIds, timestampMs: timestamp });
      changedIds = [...message.globalIds];
      source = "item_patch";
      break;
    case "MARK_ALL_AS_READ":
      await mutateItems("mark_all_read", { platform: message.platform, timestampMs: timestamp });
      break;
    case "TOGGLE_SAVED":
      await mutateItems("toggle_saved", { ids: [message.globalId], timestampMs: timestamp });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "TOGGLE_ARCHIVED":
      await mutateItems("toggle_archived", { ids: [message.globalId], timestampMs: timestamp });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "ARCHIVE_ITEMS":
      await mutateItems("archive", { ids: message.globalIds, timestampMs: timestamp });
      changedIds = [...message.globalIds];
      source = "item_patch";
      break;
    case "TOGGLE_LIKED":
      await mutateItems("toggle_liked", { ids: [message.globalId], timestampMs: timestamp });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "CONFIRM_LIKED_SYNCED":
      await mutateItems("confirm_liked", {
        ids: [message.globalId], timestampMs: message.syncedAt ?? timestamp,
      });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "CONFIRM_SEEN_SYNCED":
      await mutateItems("confirm_seen", {
        ids: [message.globalId], timestampMs: message.syncedAt ?? timestamp,
      });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "REMOVE_FEED_ITEM":
      await mutateItems("delete", { ids: [message.globalId], timestampMs: timestamp });
      changedIds = [message.globalId];
      break;
    case "ARCHIVE_ALL_READ_UNSAVED":
      await mutateItems("archive_all_read_unsaved", {
        platform: message.platform, feedUrl: message.feedUrl, timestampMs: timestamp,
      });
      break;
    case "UNARCHIVE_SAVED_ITEMS":
      await mutateItems("unarchive_saved", { timestampMs: timestamp });
      break;
    case "DELETE_ALL_ARCHIVED":
      await mutateItems("delete_all_archived", { timestampMs: timestamp });
      break;
    case "PRUNE_ARCHIVED_ITEMS":
      await mutateItems("prune_archived", { maxAgeMs: message.maxAgeMs, timestampMs: timestamp });
      break;
    case "ADD_RSS_FEED":
      await saveMetadataMutation(current, (next) => { next.feeds[message.feed.url] = message.feed; });
      break;
    case "UPDATE_RSS_FEED":
      await saveMetadataMutation(current, (next) => {
        const feed = next.feeds[message.url];
        if (feed) next.feeds[message.url] = { ...feed, ...message.updates };
      });
      break;
    case "REMOVE_RSS_FEED":
      if (message.includeItems) {
        await mutateItems("delete_rss", {
          feedUrl: message.url,
          timestampMs: timestamp,
        });
      }
      await saveMetadataMutation(current, (next) => { delete next.feeds[message.url]; });
      break;
    case "REMOVE_ALL_FEEDS":
      if (message.includeItems) {
        await mutateItems("delete_rss", { timestampMs: timestamp });
      }
      await saveMetadataMutation(current, (next) => { next.feeds = {}; });
      break;
    case "UPDATE_PREFERENCES":
      await saveMetadataMutation(current, (next) => {
        next.preferences = deepMerge<UserPreferences>(next.preferences, message.updates);
      });
      source = "preferences_patch";
      break;
    case "ADD_PERSON":
      await saveMetadataMutation(current, (next) => { next.persons[message.person.id] = message.person; });
      break;
    case "ADD_PERSONS":
      await saveMetadataMutation(current, (next) => {
        for (const person of message.persons) next.persons[person.id] = person;
      });
      break;
    case "UPDATE_PERSON":
      await saveMetadataMutation(current, (next) => {
        const person = next.persons[message.personId];
        if (person) next.persons[message.personId] = { ...person, ...message.updates };
      });
      break;
    case "UPSERT_CONNECTION_PERSONS":
      await saveMetadataMutation(current, (next) => {
        for (const candidate of message.candidates) {
          next.persons[candidate.person.id] = candidate.person;
          for (const accountId of candidate.accountIds) {
            const account = next.accounts[accountId];
            if (account) next.accounts[accountId] = { ...account, personId: candidate.person.id };
          }
        }
      });
      break;
    case "REMOVE_PERSON":
      await saveMetadataMutation(current, (next) => {
        delete next.persons[message.personId];
        for (const [id, account] of Object.entries(next.accounts)) {
          if (account.personId === message.personId) next.accounts[id] = { ...account, personId: undefined };
        }
      });
      break;
    case "LOG_REACH_OUT":
      await saveMetadataMutation(current, (next) => {
        const person = next.persons[message.personId];
        if (person) {
          const log: ReachOutLog[] = [message.entry, ...(person.reachOutLog ?? [])].slice(0, 20);
          next.persons[message.personId] = { ...person, reachOutLog: log, updatedAt: timestamp };
        }
      });
      break;
    case "ADD_ACCOUNT":
      await saveMetadataMutation(current, (next) => { next.accounts[message.account.id] = message.account; });
      break;
    case "ADD_ACCOUNTS":
      await saveMetadataMutation(current, (next) => {
        for (const account of message.accounts) next.accounts[account.id] = account;
      });
      break;
    case "UPDATE_ACCOUNT":
      await saveMetadataMutation(current, (next) => {
        const account = next.accounts[message.accountId];
        if (account) next.accounts[message.accountId] = { ...account, ...message.updates };
      });
      break;
    case "REMOVE_ACCOUNT":
      await saveMetadataMutation(current, (next) => { delete next.accounts[message.accountId]; });
      break;
    case "BATCH_REFRESH_FEEDS":
      await mergeIncomingSqliteItems(message.items);
      await saveMetadataMutation(current, (next) => {
        for (const update of message.feeds) {
          const feed = next.feeds[update.url];
          if (feed) next.feeds[update.url] = { ...feed, ...update };
        }
      });
      changedIds = message.items.map((item) => item.globalId);
      break;
    case "HEAL_UNTITLED_FEEDS":
      await saveMetadataMutation(current, (next) => {
        for (const [url, feed] of Object.entries(next.feeds)) {
          if (feed.title !== "Untitled Feed" && feed.title !== feed.url) continue;
          try {
            const title = new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
            if (title && title !== feed.title) next.feeds[url] = { ...feed, title };
          } catch {
            // A malformed legacy feed URL remains unchanged.
          }
        }
      });
      break;
    case "DEDUPLICATE_ITEMS":
    case "BACKFILL_CONTENT_SIGNALS":
    case "UPDATE_RELAY_CLIENT_COUNT":
      break;
    default:
      throw new Error(`SQLite Library does not implement ${message.type}`);
  }

  const state = await latestState();
  const changedItems = changedIds.length > 0 ? await readSqliteItems(changedIds) : [];
  const event: DocChangeEvent = source === "item_patch"
    ? {
        source,
        mutation: message.type,
        changedItemIds: changedIds,
        changedItems,
        requiresFullScan: false,
      }
    : source === "preferences_patch"
      ? {
          source,
          mutation: message.type,
          changedItemIds: null,
          changedItems: [],
          requiresFullScan: false,
        }
      : {
          source: "state_update",
          mutation: message.type,
          changedItemIds: null,
          requiresFullScan: true,
        };
  return { state, event, result };
}

export async function createSqliteLibraryBackup(
  reason: "auto" | "manual",
): Promise<SqliteLibraryBackupSummary> {
  return invoke<SqliteLibraryBackupSummary>("create_sqlite_library_backup", {
    createdAtMs: Date.now(),
    reason,
  });
}

export async function listSqliteLibraryBackups(): Promise<SqliteLibraryBackupSummary[]> {
  return invoke<SqliteLibraryBackupSummary[]>("list_sqlite_library_backups");
}

export async function readSqliteLibraryBackupChunk(input: {
  readonly backupId: string;
  readonly offset: number;
  readonly limit?: number;
}): Promise<SqliteLibraryBackupChunk> {
  return invoke<SqliteLibraryBackupChunk>("read_sqlite_library_backup_chunk", {
    request: {
      backupId: input.backupId,
      offset: input.offset,
      limit: input.limit ?? 1_048_576,
    },
  });
}

export async function restoreSqliteLibraryBackup(
  backupId: string,
): Promise<SqliteLibraryBackupSummary> {
  const restored = await invoke<SqliteLibraryBackupSummary>(
    "restore_sqlite_library_backup",
    { backupId },
  );
  sqliteActive = true;
  return restored;
}

export async function clearSqliteLibraryBackups(): Promise<void> {
  await invoke("clear_sqlite_library_backups");
}

export async function clearSqliteLibrary(): Promise<void> {
  await invoke("clear_sqlite_library");
  sqliteActive = false;
}
