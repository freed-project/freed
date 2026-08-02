import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
} from "./feed-page-contracts.js";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA,
} from "./feed-browse-page-contracts.js";
import {
  LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_SAVED_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SAVED_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA,
  LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA,
  LIBRARY_CORE_SAVED_FEED_PAGE_SOURCE_IDENTITY,
} from "./saved-feed-page-contracts.js";

export const LIBRARY_CORE_QUERY_IDS = [
  "account_detail_v1",
  "change_feed_v1",
  "content_fetch_claim_v1",
  "export_enumeration_v1",
  "feed_browse_page_v1",
  "feed_browse_page_v2",
  "feed_facets_v1",
  "feed_page_v1",
  "feed_subscription_page_v1",
  "item_detail_v1",
  "item_reader_body_v1",
  "legacy_direct_document_diagnostics",
  "legacy_direct_document_export",
  "legacy_direct_document_hydration",
  "legacy_worker_all_item_ids",
  "legacy_worker_broadcast_binary",
  "legacy_worker_compare_document",
  "legacy_worker_document_binary",
  "legacy_worker_document_heads",
  "legacy_worker_feeds_patch",
  "legacy_worker_item_html",
  "legacy_worker_item_patch",
  "legacy_worker_item_preserved_text",
  "legacy_worker_preferences_patch",
  "legacy_worker_saved_youtube_urls",
  "legacy_worker_state_update",
  "map_markers_v1",
  "person_detail_v1",
  "person_timeline_v1",
  "persons_graph_v1",
  "preferences_snapshot_v1",
  "provider_action_claim_v1",
  "provider_media_page_v1",
  "repair_work_claim_v1",
  "saved_analytics_v1",
  "saved_feed_page_v1",
  "search_page_v1",
  "semantic_classification_claim_v1",
  "story_wall_candidates_v1",
] as const;

export type LibraryCoreQueryId = (typeof LIBRARY_CORE_QUERY_IDS)[number];

export type LibraryCoreQueryAdapter =
  | "desktop_sqlite"
  | "pwa_indexeddb"
  | "pwa_sqlite_opfs";

export type LegacyQueryBoundary =
  | "desktop_automerge_worker"
  | "desktop_and_pwa_automerge_workers"
  | "direct_automerge_document"
  | "pwa_automerge_worker";

export type LibraryCoreQueryBlocker =
  | "adapter_proof_missing"
  | "durable_checkpoint_contract_unresolved"
  | "nested_bounds_unresolved"
  | "projection_unresolved"
  | "request_schema_unresolved"
  | "response_schema_unresolved"
  | "runtime_adapter_unimplemented"
  | "sort_contract_unresolved"
  | "source_identity_unresolved";

type NonEmptyQueryBlockers = readonly [
  LibraryCoreQueryBlocker,
  ...LibraryCoreQueryBlocker[],
];

const MIB = 1_048_576;
const ORDINARY_RESPONSE_MAX_BYTES = 2 * MIB;

/**
 * One renderer-wide pool. Individual queries receive no private reservation,
 * so opening several views cannot add their nominal maxima together.
 */
export const LIBRARY_CORE_RENDERER_CACHE_POOL = {
  id: "renderer_dto_shared_v1",
  settledMaximumBytes: 48 * MIB,
  burstMaximumBytes: 64 * MIB,
  eviction: "cross_query_lru",
  perQueryReservations: false,
  retainedFeedPagesMaximum: 2,
  retainedCompactSummariesMaximum: 512,
  retainedReaderBodiesMaximum: 16,
  retainedReaderBodyBytesMaximum: 16 * MIB,
} as const;

/**
 * One pool for every interactive query snapshot. Export, backup, and migration
 * are excluded because they require durable checkpoints.
 */
export const LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL = {
  id: "interactive_snapshot_shared_v1",
  maximumAgeMs: 60_000,
  maximumPinnedBytesAcrossQueries: 16 * MIB,
  releaseOn: ["cancellation", "disconnect", "cursor_exhaustion", "expiry"],
  expiryResult: "CURSOR_STALE",
} as const;

interface InteractiveCursorIntent {
  readonly kind: "interactive";
  readonly pagination: "keyset" | "single_page" | "stream_offset";
  readonly version: 1;
  readonly opaque: true;
  readonly snapshotPool: typeof LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL.id;
}

interface DurableCheckpointCursorIntent {
  readonly kind: "durable_checkpoint";
  readonly version: 1;
  readonly opaque: true;
  readonly checkpointSchema: null;
}

type QueryCursorIntent =
  | InteractiveCursorIntent
  | DurableCheckpointCursorIntent;

interface QueryCancellationContract {
  readonly required: true;
  readonly identitySchema: null;
  readonly releasesSnapshot: true;
}

interface QuerySourceInventory {
  readonly boundary: "library_core" | LegacyQueryBoundary;
  readonly currentKinds: readonly string[];
}

export interface ResolvedQuerySortColumn {
  readonly column: string;
  readonly direction: "asc" | "desc";
}

/**
 * A resolved ordering, stated so an adapter can satisfy it with an index rather
 * than a sort.
 *
 * Every field here exists because getting it wrong is silent. Columns are
 * columns and never expressions, because a leading expression such as
 * `publishedAt IS NULL` is not index-satisfiable and quietly turns each keyset
 * page into a sort of the whole remaining set: the page stays bounded while the
 * work behind it grows with the corpus. Text comparison is pinned to BINARY
 * because a cursor that compares differently from the database skips or repeats
 * rows at the page boundary, and JavaScript's `localeCompare` treats ids that
 * differ only in case as equal where SQLite does not. The null ordering is
 * declared rather than assumed so that a later nullable sort column cannot be
 * added without confronting the first rule.
 */
export interface ResolvedQuerySortContract {
  readonly columns: readonly [
    ResolvedQuerySortColumn,
    ...ResolvedQuerySortColumn[],
  ];
  readonly textCollation: "binary";
  readonly nullOrdering: "all_sort_columns_not_null";
}

export interface PlannedBlockedLibraryCoreQueryDefinition {
  readonly status: "planned_blocked";
  readonly querySchemaVersion: 1;
  readonly source: {
    readonly boundary: "library_core";
    readonly currentKinds: readonly string[];
  };
  readonly requestSchema:
    | typeof LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA
    | null;
  readonly responseSchema:
    | typeof LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA
    | null;
  readonly projection:
    | typeof LIBRARY_CORE_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION
    | null;
  readonly sourceIdentity:
    | typeof LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY
    | null;
  readonly nestedBounds:
    | typeof LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS
    | null;
  readonly stableSort: ResolvedQuerySortContract | null;
  readonly tieBreakKey: string | null;
  readonly defaultLimit: number;
  readonly maximumLimit: number;
  readonly maximumRows: number;
  readonly maximumResponseBytes: number;
  readonly cursor: QueryCursorIntent;
  readonly fullContentAllowed: boolean;
  readonly cancellation: QueryCancellationContract;
  readonly totalCountIntent: "exact" | "none" | "snapshot_exact";
  readonly rendererCachePool:
    | typeof LIBRARY_CORE_RENDERER_CACHE_POOL.id
    | null;
  readonly invalidationKeyIntent: readonly string[];
  readonly intendedAdapters: readonly LibraryCoreQueryAdapter[];
  readonly blockers: NonEmptyQueryBlockers;
}

export interface LegacyUnboundedQueryDefinition {
  readonly status: "legacy_unbounded";
  readonly querySchemaVersion: 0;
  readonly source: QuerySourceInventory & {
    readonly boundary: LegacyQueryBoundary;
  };
  readonly consumers: readonly string[];
  readonly projection: "*";
  readonly fullContentAllowed: boolean;
  readonly activationBlocker:
    | "decodes_full_document"
    | "materializes_full_collection"
    | "missing_hard_byte_bound"
    | "missing_hard_row_bound"
    | "missing_snapshot_bound";
}

export type LibraryCoreQueryDefinition =
  | PlannedBlockedLibraryCoreQueryDefinition
  | LegacyUnboundedQueryDefinition;

const ALL_INTENDED_ADAPTERS = [
  "desktop_sqlite",
  "pwa_indexeddb",
  "pwa_sqlite_opfs",
] as const satisfies readonly LibraryCoreQueryAdapter[];

const BASE_QUERY_BLOCKERS = [
  "request_schema_unresolved",
  "response_schema_unresolved",
  "projection_unresolved",
  "source_identity_unresolved",
  "nested_bounds_unresolved",
  "sort_contract_unresolved",
  "adapter_proof_missing",
  "runtime_adapter_unimplemented",
] as const satisfies NonEmptyQueryBlockers;

const requiredCancellation = {
  required: true,
  identitySchema: null,
  releasesSnapshot: true,
} as const;

const interactiveCursor = (
  pagination: InteractiveCursorIntent["pagination"],
): InteractiveCursorIntent => ({
  kind: "interactive",
  pagination,
  version: 1,
  opaque: true,
  snapshotPool: LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL.id,
});

interface PlannedQueryInput {
  readonly defaultLimit: number;
  readonly maximumLimit: number;
  readonly maximumRows: number;
  readonly maximumResponseBytes?: number;
  readonly cursor?: QueryCursorIntent;
  readonly fullContentAllowed?: boolean;
  readonly totalCountIntent: "exact" | "none" | "snapshot_exact";
  readonly rendererCache: boolean;
  readonly invalidationKeyIntent: readonly string[];
  readonly intendedAdapters?: readonly LibraryCoreQueryAdapter[];
  readonly additionalBlockers?: readonly LibraryCoreQueryBlocker[];
  readonly resolvedImplementationBlockers?: readonly Extract<
    LibraryCoreQueryBlocker,
    "runtime_adapter_unimplemented"
  >[];
  readonly currentKinds?: readonly string[];
  readonly requestSchema?:
    | typeof LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA;
  readonly responseSchema?:
    | typeof LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA;
  readonly projection?:
    | typeof LIBRARY_CORE_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION;
  readonly sourceIdentity?: typeof LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
  readonly nestedBounds?: typeof LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS;
  /**
   * Supplying both clears `sort_contract_unresolved` for this query. They move
   * together on purpose: an ordering without a tie-break is not stable, and a
   * keyset cursor built on an unstable order drops and repeats rows.
   */
  readonly stableSort?: ResolvedQuerySortContract;
  readonly tieBreakKey?: string;
}

function nonEmptyBlockers(
  blockers: readonly LibraryCoreQueryBlocker[],
): NonEmptyQueryBlockers {
  const [first, ...rest] = blockers;
  if (!first) {
    throw new Error("a planned query must declare at least one blocker");
  }
  return [first, ...rest];
}

function plannedQuery(
  input: PlannedQueryInput,
): PlannedBlockedLibraryCoreQueryDefinition {
  const stableSort = input.stableSort ?? null;
  const tieBreakKey = input.tieBreakKey ?? null;
  const requestSchema = input.requestSchema ?? null;
  const responseSchema = input.responseSchema ?? null;
  const projection = input.projection ?? null;
  const sourceIdentity = input.sourceIdentity ?? null;
  const nestedBounds = input.nestedBounds ?? null;

  if ((stableSort === null) !== (tieBreakKey === null)) {
    throw new Error(
      "a resolved sort contract requires both stableSort and tieBreakKey",
    );
  }
  if (stableSort && tieBreakKey) {
    // The tie-break has to be the final ordering term, not merely present
    // somewhere in it. If an earlier column followed it, rows sharing every
    // preceding value would still have no defined order between them and the
    // cursor would have nothing unique to resume from.
    const last = stableSort.columns[stableSort.columns.length - 1];
    if (last?.column !== tieBreakKey) {
      throw new Error(
        `tie-break ${tieBreakKey} must be the last sort column, found ${last?.column}`,
      );
    }
  }

  return {
    status: "planned_blocked",
    querySchemaVersion: 1,
    source: {
      boundary: "library_core",
      currentKinds: input.currentKinds ?? [],
    },
    requestSchema,
    responseSchema,
    projection,
    sourceIdentity,
    nestedBounds,
    stableSort,
    tieBreakKey,
    defaultLimit: input.defaultLimit,
    maximumLimit: input.maximumLimit,
    maximumRows: input.maximumRows,
    maximumResponseBytes:
      input.maximumResponseBytes ?? ORDINARY_RESPONSE_MAX_BYTES,
    cursor: input.cursor ?? interactiveCursor("keyset"),
    fullContentAllowed: input.fullContentAllowed ?? false,
    cancellation: requiredCancellation,
    totalCountIntent: input.totalCountIntent,
    rendererCachePool: input.rendererCache
      ? LIBRARY_CORE_RENDERER_CACHE_POOL.id
      : null,
    invalidationKeyIntent: input.invalidationKeyIntent,
    intendedAdapters: input.intendedAdapters ?? ALL_INTENDED_ADAPTERS,
    blockers: nonEmptyBlockers([
      ...BASE_QUERY_BLOCKERS.filter((blocker) => {
        if (
          blocker === "runtime_adapter_unimplemented" &&
          input.resolvedImplementationBlockers?.includes(blocker)
        ) {
          return false;
        }
        if (blocker === "request_schema_unresolved") {
          return requestSchema === null;
        }
        if (blocker === "response_schema_unresolved") {
          return responseSchema === null;
        }
        if (blocker === "projection_unresolved") {
          return projection === null;
        }
        if (blocker === "source_identity_unresolved") {
          return sourceIdentity === null;
        }
        if (blocker === "nested_bounds_unresolved") {
          return nestedBounds === null;
        }
        if (blocker === "sort_contract_unresolved") {
          return stableSort === null;
        }
        return true;
      }),
      ...(input.additionalBlockers ?? []),
    ]),
  };
}

function legacyUnboundedQuery(
  boundary: LegacyQueryBoundary,
  currentKinds: readonly string[],
  consumers: readonly string[],
  activationBlocker: LegacyUnboundedQueryDefinition["activationBlocker"],
  fullContentAllowed: boolean,
): LegacyUnboundedQueryDefinition {
  return {
    status: "legacy_unbounded",
    querySchemaVersion: 0,
    source: { boundary, currentKinds },
    consumers,
    projection: "*",
    fullContentAllowed,
    activationBlocker,
  };
}

/**
 * Dormant query census only.
 *
 * Top-level limits come from the approved architecture, but each replacement
 * query remains blocked until its request, response, projection, source
 * identity, nested bounds, and sort contract are executable and adapter proofs
 * exist. The legacy entries name every known unbounded transport and consumer
 * that must disappear before read cutover.
 */
export const LIBRARY_CORE_QUERY_REGISTRY = {
  account_detail_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["account:{account_id}", "person:{person_id}"],
  }),
  change_feed_v1: plannedQuery({
    defaultLimit: 128,
    maximumLimit: 512,
    maximumRows: 512,
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["change-feed"],
  }),
  content_fetch_claim_v1: plannedQuery({
    defaultLimit: 25,
    maximumLimit: 50,
    maximumRows: 50,
    totalCountIntent: "none",
    rendererCache: false,
    invalidationKeyIntent: ["content-fetch-queue"],
  }),
  export_enumeration_v1: plannedQuery({
    defaultLimit: 128,
    maximumLimit: 512,
    maximumRows: 512,
    cursor: {
      kind: "durable_checkpoint",
      version: 1,
      opaque: true,
      checkpointSchema: null,
    },
    fullContentAllowed: true,
    totalCountIntent: "snapshot_exact",
    rendererCache: false,
    invalidationKeyIntent: ["export-checkpoint:{checkpoint_id}"],
    additionalBlockers: ["durable_checkpoint_contract_unresolved"],
  }),
  feed_browse_page_v1: plannedQuery({
    defaultLimit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
    maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed:browse", "feed-facets"],
    currentKinds: [
      "PwaLibraryCoreFeedReaderRuntime.readBrowseFeedPage",
      "READ_LIBRARY_CORE_FEED_BROWSE_PAGE",
    ],
    requestSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION,
    sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
    stableSort: {
      columns: [
        { column: "priority", direction: "desc" },
        { column: "publishedAt", direction: "desc" },
        { column: "sourceSequence", direction: "asc" },
        { column: "globalId", direction: "asc" },
      ],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
  }),
  feed_browse_page_v2: plannedQuery({
    defaultLimit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
    maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed:friends", "feed-facets"],
    currentKinds: [
      "read_library_core_feed_browse_page",
      "openBoundedDesktopFriendsFeedReader",
    ],
    requestSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION,
    sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
    stableSort: {
      columns: [
        { column: "priority", direction: "desc" },
        { column: "publishedAt", direction: "desc" },
        { column: "sourceSequence", direction: "asc" },
        { column: "globalId", direction: "asc" },
      ],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  feed_facets_v1: plannedQuery({
    defaultLimit: 128,
    maximumLimit: 512,
    maximumRows: 512,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed-facets"],
  }),
  feed_page_v1: plannedQuery({
    defaultLimit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
    maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed:default", "feed-facets"],
    currentKinds: [
      "ProjectionReadSession::feed_page",
      "read_library_core_feed_page",
      "PwaLibraryCoreFeedReaderRuntime.readFeedPage",
      "READ_LIBRARY_CORE_FEED_PAGE",
    ],
    requestSchema: LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_FEED_PAGE_PROJECTION,
    sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
    // Newest first, then by id so the order is total. `sortAt` is the shadow
    // store's derived sort key rather than `publishedAt`: the authoritative
    // column stays nullable because absence is data the projection must be able
    // to reproduce, and ordering by it would need a null-handling expression
    // that no index can satisfy. See SORT_AT_ABSENT in shadow-store.ts.
    stableSort: {
      columns: [
        { column: "sortAt", direction: "desc" },
        { column: "globalId", direction: "asc" },
      ],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  feed_subscription_page_v1: plannedQuery({
    defaultLimit: 64,
    maximumLimit: 128,
    maximumRows: 128,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["rss-feeds"],
  }),
  item_detail_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["item:{global_id}"],
  }),
  item_reader_body_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    maximumResponseBytes: 256 * 1_024,
    cursor: interactiveCursor("stream_offset"),
    fullContentAllowed: true,
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["item-body:{global_id}:{content_digest}"],
  }),
  legacy_direct_document_diagnostics: legacyUnboundedQuery(
    "direct_automerge_document",
    ["A.toJS", "A.view", "Object.values", "summarizeDocContentSignals"],
    ["debug diagnostics", "runtime-health summaries", "support evidence"],
    "decodes_full_document",
    true,
  ),
  legacy_direct_document_export: legacyUnboundedQuery(
    "direct_automerge_document",
    ["A.save", "document export enumeration"],
    ["import-export", "manual export", "snapshot backup"],
    "missing_snapshot_bound",
    true,
  ),
  legacy_direct_document_hydration: legacyUnboundedQuery(
    "direct_automerge_document",
    ["A.view", "Object.values(feedItems)", "rankFeedItems"],
    ["Desktop Zustand hydration", "PWA Zustand hydration"],
    "materializes_full_collection",
    true,
  ),
  legacy_worker_all_item_ids: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["GET_ALL_ITEM_IDS", "ALL_ITEM_IDS"],
    ["Desktop import deduplication"],
    "missing_hard_row_bound",
    false,
  ),
  legacy_worker_broadcast_binary: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["BROADCAST_REQUEST"],
    ["Desktop relay broadcast"],
    "missing_hard_byte_bound",
    true,
  ),
  legacy_worker_compare_document: legacyUnboundedQuery(
    "desktop_and_pwa_automerge_workers",
    ["COMPARE_DOC", "DOC_RELATIONSHIP"],
    ["cloud reconciliation", "relay reconciliation"],
    "missing_hard_byte_bound",
    true,
  ),
  legacy_worker_document_binary: legacyUnboundedQuery(
    "desktop_and_pwa_automerge_workers",
    ["GET_DOC_BINARY", "DOC_BINARY"],
    ["cloud upload", "relay broadcast", "snapshot backup", "factory reset"],
    "missing_hard_byte_bound",
    true,
  ),
  legacy_worker_document_heads: legacyUnboundedQuery(
    "desktop_and_pwa_automerge_workers",
    ["GET_HEADS", "DOC_HEADS"],
    ["cloud upload loop accounting", "relay reconciliation"],
    "missing_hard_row_bound",
    false,
  ),
  legacy_worker_feeds_patch: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["FEEDS_PATCH"],
    ["Desktop Zustand feed map"],
    "missing_hard_row_bound",
    false,
  ),
  legacy_worker_item_html: legacyUnboundedQuery(
    "desktop_and_pwa_automerge_workers",
    ["GET_ITEM_LEGACY_HTML", "ITEM_LEGACY_HTML"],
    ["Desktop reader", "PWA reader"],
    "missing_hard_byte_bound",
    true,
  ),
  legacy_worker_item_patch: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["ITEM_PATCH"],
    ["Desktop Zustand item projection", "provider outbox change subscription"],
    "missing_hard_row_bound",
    true,
  ),
  legacy_worker_item_preserved_text: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["GET_ITEM_PRESERVED_TEXT", "ITEM_PRESERVED_TEXT"],
    ["Desktop reader", "content fetch accounting"],
    "missing_hard_byte_bound",
    true,
  ),
  legacy_worker_preferences_patch: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["PREFERENCES_PATCH"],
    ["Desktop Zustand preferences", "semantic-classifier scheduling"],
    "missing_hard_row_bound",
    false,
  ),
  legacy_worker_saved_youtube_urls: legacyUnboundedQuery(
    "desktop_automerge_worker",
    ["GET_SAVED_YOUTUBE_URLS", "SAVED_YOUTUBE_URLS"],
    ["YouTube capture deduplication"],
    "missing_hard_row_bound",
    false,
  ),
  legacy_worker_state_update: legacyUnboundedQuery(
    "desktop_and_pwa_automerge_workers",
    ["STATE_UPDATE", "DocState"],
    [
      "Desktop Zustand hydration",
      "PWA Zustand hydration",
      "content-fetch full-list scan",
      "provider-outbox full-list scan",
      "semantic-classifier corpus scheduling",
    ],
    "materializes_full_collection",
    true,
  ),
  map_markers_v1: plannedQuery({
    defaultLimit: 500,
    maximumLimit: 1_000,
    maximumRows: 1_000,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["map:{normalized_filter_digest}"],
  }),
  person_detail_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["person:{person_id}"],
  }),
  person_timeline_v1: plannedQuery({
    defaultLimit: 50,
    maximumLimit: 100,
    maximumRows: 100,
    maximumResponseBytes: 2 * MIB,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["person-timeline:{person_id}"],
    currentKinds: [
      "ProjectionReadSession::person_timeline",
      "read_library_core_person_timeline",
    ],
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  persons_graph_v1: plannedQuery({
    defaultLimit: 1_000,
    maximumLimit: 5_000,
    maximumRows: 5_000,
    maximumResponseBytes: 8 * MIB,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["friends-graph:{normalized_filter_digest}"],
    currentKinds: [
      "ProjectionReadSession::friends_graph_activity",
      "read_library_core_persons_graph",
    ],
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  preferences_snapshot_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["preferences"],
  }),
  provider_action_claim_v1: plannedQuery({
    defaultLimit: 10,
    maximumLimit: 25,
    maximumRows: 25,
    totalCountIntent: "none",
    rendererCache: false,
    invalidationKeyIntent: ["provider-action-queue"],
  }),
  provider_media_page_v1: plannedQuery({
    defaultLimit: 100,
    maximumLimit: 250,
    maximumRows: 250,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["provider-media:{provider}:{account_id}"],
  }),
  repair_work_claim_v1: plannedQuery({
    defaultLimit: 25,
    maximumLimit: 50,
    maximumRows: 50,
    totalCountIntent: "none",
    rendererCache: false,
    invalidationKeyIntent: ["repair-work-queue"],
  }),
  saved_analytics_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    maximumResponseBytes: 8 * MIB,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "exact",
    rendererCache: true,
    invalidationKeyIntent: ["saved-overview"],
    currentKinds: [
      "ProjectionReadSession::saved_analytics",
      "read_library_core_saved_analytics",
    ],
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  saved_feed_page_v1: plannedQuery({
    defaultLimit: LIBRARY_CORE_SAVED_FEED_PAGE_DEFAULT_LIMIT,
    maximumLimit: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed:saved", "feed-facets"],
    currentKinds: [
      "read_library_core_saved_feed_page",
      "openBoundedDesktopSavedFeedReader",
    ],
    requestSchema: LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION,
    sourceIdentity: LIBRARY_CORE_SAVED_FEED_PAGE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_SAVED_FEED_PAGE_NESTED_BOUNDS,
    stableSort: {
      columns: [
        { column: "sortGroup", direction: "desc" },
        { column: "sortPrimary", direction: "desc" },
        { column: "sortSecondary", direction: "asc" },
        { column: "globalId", direction: "asc" },
      ],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  search_page_v1: plannedQuery({
    defaultLimit: 50,
    maximumLimit: 100,
    maximumRows: 100,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["search:{normalized_query_digest}"],
  }),
  semantic_classification_claim_v1: plannedQuery({
    defaultLimit: 50,
    maximumLimit: 100,
    maximumRows: 100,
    totalCountIntent: "none",
    rendererCache: false,
    invalidationKeyIntent: ["semantic-classification-queue"],
  }),
  story_wall_candidates_v1: plannedQuery({
    defaultLimit: 100,
    maximumLimit: 250,
    maximumRows: 250,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["story-wall:{normalized_filter_digest}"],
  }),
} as const satisfies Readonly<
  Record<LibraryCoreQueryId, LibraryCoreQueryDefinition>
>;
