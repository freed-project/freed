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
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_PROJECTION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA,
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
import {
  LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS,
  LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION,
  LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA,
  LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA,
  LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY,
} from "./saved-analytics-contracts.js";
import {
  LIBRARY_CORE_PERSON_TIMELINE_NESTED_BOUNDS,
  LIBRARY_CORE_PERSON_TIMELINE_PROJECTION,
  LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA,
  LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA,
  LIBRARY_CORE_PERSON_TIMELINE_SOURCE_IDENTITY,
} from "./person-timeline-contracts.js";
import {
  LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS,
  LIBRARY_CORE_PERSONS_GRAPH_PROJECTION,
  LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA,
  LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA,
  LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY,
} from "./persons-graph-contracts.js";
import {
  LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_PERSON_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_PERSON_DETAIL_PROJECTION,
  LIBRARY_CORE_PERSON_DETAIL_REQUEST_SCHEMA,
  LIBRARY_CORE_PERSON_DETAIL_RESPONSE_SCHEMA,
  LIBRARY_CORE_PERSON_DETAIL_SOURCE_IDENTITY,
} from "./person-detail-contracts.js";
import {
  LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
  LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA,
  LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";
import {
  LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_ITEM_READER_BODY_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_READER_BODY_PROJECTION,
  LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA,
  LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA,
  LIBRARY_CORE_ITEM_READER_BODY_SOURCE_IDENTITY,
} from "./item-reader-body-contracts.js";
import {
  LIBRARY_CORE_ITEM_SCAN_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_SCAN_PROJECTION,
  LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA,
  LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA,
  LIBRARY_CORE_ITEM_SCAN_SOURCE_IDENTITY,
} from "./item-scan-contracts.js";
import {
  LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
  LIBRARY_CORE_CHANGE_FEED_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS,
  LIBRARY_CORE_CHANGE_FEED_PROJECTION,
  LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA,
  LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA,
  LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY,
} from "./change-feed-contracts.js";
import {
  LIBRARY_CORE_SURFACE_ITEMS_NESTED_BOUNDS,
  LIBRARY_CORE_SURFACE_ITEMS_PROJECTION,
  LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA,
  LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA,
  LIBRARY_CORE_SURFACE_ITEMS_SOURCE_IDENTITY,
} from "./surface-items-contracts.js";
import {
  LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS,
  LIBRARY_CORE_FACET_SUMMARY_PROJECTION,
  LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA,
  LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA,
  LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY,
} from "./facet-summary-contracts.js";
import {
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_NESTED_BOUNDS,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_PROJECTION,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA,
  LIBRARY_CORE_PREFERENCES_SNAPSHOT_SOURCE_IDENTITY,
} from "./preferences-snapshot-contracts.js";
import type { LibraryCoreQueryId } from "./sqlite-contract.generated.js";

export {
  LIBRARY_CORE_QUERY_IDS,
  type LibraryCoreQueryId,
} from "./sqlite-contract.generated.js";

export type LibraryCoreQueryAdapter = "desktop_sqlite" | "pwa_sqlite_opfs";

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
  InteractiveCursorIntent | DurableCheckpointCursorIntent;

interface QueryCancellationContract {
  readonly required: true;
  readonly identitySchema: null;
  readonly releasesSnapshot: true;
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
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSON_DETAIL_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA
    | null;
  readonly responseSchema:
    | typeof LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSON_DETAIL_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA
    | null;
  readonly projection:
    | typeof LIBRARY_CORE_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION
    | typeof LIBRARY_CORE_FACET_SUMMARY_PROJECTION
    | typeof LIBRARY_CORE_PERSONS_GRAPH_PROJECTION
    | typeof LIBRARY_CORE_PERSON_DETAIL_PROJECTION
    | typeof LIBRARY_CORE_ITEM_DETAIL_PROJECTION
    | typeof LIBRARY_CORE_ITEM_READER_BODY_PROJECTION
    | typeof LIBRARY_CORE_ITEM_SCAN_PROJECTION
    | typeof LIBRARY_CORE_CHANGE_FEED_PROJECTION
    | typeof LIBRARY_CORE_CHANGE_FEED_PROJECTION
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_PROJECTION
    | null;
  readonly sourceIdentity:
    | typeof LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PERSON_DETAIL_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_ITEM_READER_BODY_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_SOURCE_IDENTITY
    | null;
  readonly nestedBounds:
    | typeof LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS
    | typeof LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PERSON_DETAIL_NESTED_BOUNDS
    | typeof LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS
    | typeof LIBRARY_CORE_ITEM_READER_BODY_NESTED_BOUNDS
    | typeof LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS
    | typeof LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_NESTED_BOUNDS
    | null;
  readonly stableSort: ResolvedQuerySortContract | null;
  readonly tieBreakKey: string | null;
  readonly sortNotApplicable: boolean;
  readonly defaultLimit: number;
  readonly maximumLimit: number;
  readonly maximumRows: number;
  readonly maximumResponseBytes: number;
  readonly cursor: QueryCursorIntent;
  readonly fullContentAllowed: boolean;
  readonly cancellation: QueryCancellationContract;
  readonly totalCountIntent: "exact" | "none" | "snapshot_exact";
  readonly rendererCachePool: typeof LIBRARY_CORE_RENDERER_CACHE_POOL.id | null;
  readonly invalidationKeyIntent: readonly string[];
  readonly intendedAdapters: readonly LibraryCoreQueryAdapter[];
  readonly blockers: NonEmptyQueryBlockers;
}

export type LibraryCoreQueryDefinition =
  PlannedBlockedLibraryCoreQueryDefinition;

const ALL_INTENDED_ADAPTERS = [
  "desktop_sqlite",
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
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PERSON_DETAIL_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA;
  readonly responseSchema?:
    | typeof LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PERSON_DETAIL_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA;
  readonly projection?:
    | typeof LIBRARY_CORE_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION
    | typeof LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION
    | typeof LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION
    | typeof LIBRARY_CORE_PERSONS_GRAPH_PROJECTION
    | typeof LIBRARY_CORE_PERSON_DETAIL_PROJECTION
    | typeof LIBRARY_CORE_ITEM_DETAIL_PROJECTION
    | typeof LIBRARY_CORE_ITEM_READER_BODY_PROJECTION
    | typeof LIBRARY_CORE_ITEM_SCAN_PROJECTION
    | typeof LIBRARY_CORE_CHANGE_FEED_PROJECTION
    | typeof LIBRARY_CORE_FACET_SUMMARY_PROJECTION
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_PROJECTION;
  readonly sourceIdentity?:
    | typeof LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PERSON_DETAIL_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_ITEM_READER_BODY_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_SOURCE_IDENTITY;
  readonly nestedBounds?:
    | typeof LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS
    | typeof LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PERSON_DETAIL_NESTED_BOUNDS
    | typeof LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS
    | typeof LIBRARY_CORE_ITEM_READER_BODY_NESTED_BOUNDS
    | typeof LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS
    | typeof LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS
    | typeof LIBRARY_CORE_PREFERENCES_SNAPSHOT_NESTED_BOUNDS;
  /**
   * Supplying both clears `sort_contract_unresolved` for this query. They move
   * together on purpose: an ordering without a tie-break is not stable, and a
   * keyset cursor built on an unstable order drops and repeats rows.
   */
  readonly stableSort?: ResolvedQuerySortContract;
  readonly tieBreakKey?: string;
  readonly sortNotApplicable?: boolean;
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
  if (input.sortNotApplicable && stableSort !== null) {
    throw new Error("a query cannot declare both an ordering and no row order");
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
    sortNotApplicable: input.sortNotApplicable === true,
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
          return stableSort === null && input.sortNotApplicable !== true;
        }
        return true;
      }),
      ...(input.additionalBlockers ?? []),
    ]),
  };
}

/**
 * SQLite query registry shared by Freed Desktop and the OPFS-backed PWA.
 * Every entry has a bounded result contract. Historical whole-document reads
 * are deletion targets and cannot appear in this runtime registry.
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
  background_item_page_v1: plannedQuery({
    // Background metadata traversal. Reader bodies use item_reader_body_v1.
    defaultLimit: 64,
    maximumLimit: 64,
    maximumRows: 64,
    maximumResponseBytes: 2 * MIB,
    cursor: interactiveCursor("keyset"),
    totalCountIntent: "none",
    rendererCache: false,
    invalidationKeyIntent: ["library:item-scan"],
    currentKinds: [
      "ProjectionReadSession::item_scan",
      "read_library_core_item_scan_page",
      "scanLibraryCoreItems",
    ],
    requestSchema: LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_ITEM_SCAN_PROJECTION,
    sourceIdentity: LIBRARY_CORE_ITEM_SCAN_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_ITEM_SCAN_NESTED_BOUNDS,
    // Keyset on the unique globalId primary key, ascending. The generated
    // lower-bound expression lets the primary key satisfy the order without a
    // temporary B-tree.
    stableSort: {
      columns: [{ column: "globalId", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  change_feed_v1: plannedQuery({
    defaultLimit: 128,
    maximumLimit: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["change-feed"],
    requestSchema: LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_CHANGE_FEED_PROJECTION,
    sourceIdentity: LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS,
    stableSort: {
      columns: [
        { column: "revision", direction: "asc" },
        { column: "ordinal", direction: "asc" },
      ],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "ordinal",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
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
  feed_browse_page_v3: plannedQuery({
    defaultLimit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
    maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
    totalCountIntent: "snapshot_exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed:browse", "feed-facets"],
    currentKinds: [
      "read_library_core_feed_browse_page",
      "openBoundedDesktopFeedReader",
    ],
    requestSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_PROJECTION,
    sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
    // Both traversal directions read the same canonical order. A backward page
    // is the exact mirror of the forward keyset predicate, walked through the
    // same unique index, so the two directions cannot disagree about ordering.
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
    maximumResponseBytes: LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["item:{global_id}"],
    currentKinds: [
      "ProjectionReadSession::item_detail",
      "read_library_core_item_detail",
    ],
    requestSchema: LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
    sourceIdentity: LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
    // A point lookup on the unique globalId primary key.
    stableSort: {
      columns: [{ column: "globalId", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "globalId",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  item_reader_body_v1: plannedQuery({
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 6,
    maximumResponseBytes: LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES,
    cursor: interactiveCursor("stream_offset"),
    fullContentAllowed: true,
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["item-body:{global_id}:{content_digest}"],
    currentKinds: [
      "NormalizedQueryRequestV1::ItemReaderBody",
      "PwaLibraryCoreSqliteEngine.query:item_reader_body_v1",
    ],
    requestSchema: LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_ITEM_READER_BODY_PROJECTION,
    sourceIdentity: LIBRARY_CORE_ITEM_READER_BODY_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_ITEM_READER_BODY_NESTED_BOUNDS,
    stableSort: {
      columns: [{ column: "chunkIndex", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "chunkIndex",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  library_facet_summary_v1: plannedQuery({
    // Whole-corpus aggregate, no paging. Traced from the native reader and the
    // shadow store: exact counts plus at most 4,096 tags of 1,024 bytes.
    defaultLimit: 1,
    maximumLimit: 1,
    maximumRows: 1,
    totalCountIntent: "exact",
    rendererCache: true,
    invalidationKeyIntent: ["feed-facets"],
    currentKinds: [
      "ProjectionReadSession::facet_summary",
      "read_library_core_facet_summary",
      "readLibraryFacetSummary",
    ],
    requestSchema: LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_FACET_SUMMARY_PROJECTION,
    sourceIdentity: LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS,
    sortNotApplicable: true,
    // The response is one aggregate row. Its nested tag set is independently
    // ordered by the exact binary UTF-8 contract declared in
    // LIBRARY_CORE_FACET_SUMMARY_TAG_ORDER.
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  library_surface_items_v1: plannedQuery({
    // Map and Story Wall candidate rows. Traced ceilings: 1,000 map items and
    // 250 Story Wall items, selected by surface kind.
    defaultLimit: 250,
    maximumLimit: 1_000,
    maximumRows: 1_000,
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["library-surface:{surface}"],
    currentKinds: [
      "ProjectionReadSession::surface_items",
      "read_library_core_surface_items",
      "readLibrarySurfaceItems",
    ],
    requestSchema: LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_SURFACE_ITEMS_PROJECTION,
    sourceIdentity: LIBRARY_CORE_SURFACE_ITEMS_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_SURFACE_ITEMS_NESTED_BOUNDS,
    fullContentAllowed: true,
    // stableSort and tieBreakKey stay null on purpose. Both surfaces read
    // ORDER BY sortAt DESC, globalId ASC, but declaring a sort contract asserts
    // the order is index-satisfiable and for the Map surface it is not:
    // EXPLAIN QUERY PLAN answers it with USE TEMP B-TREE FOR ORDER BY. Tracked
    // in issue #1323; the intended order is recorded in
    // LIBRARY_CORE_SURFACE_ITEMS_INTENDED_ORDER.
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
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
    maximumResponseBytes: LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["person:{person_id}"],
    currentKinds: [
      "query_normalized_v1::person_detail_v1",
      "PwaLibraryCoreSqliteEngine.query::person_detail_v1",
    ],
    requestSchema: LIBRARY_CORE_PERSON_DETAIL_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_PERSON_DETAIL_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_PERSON_DETAIL_PROJECTION,
    sourceIdentity: LIBRARY_CORE_PERSON_DETAIL_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_PERSON_DETAIL_NESTED_BOUNDS,
    sortNotApplicable: true,
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
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
    requestSchema: LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_PERSON_TIMELINE_PROJECTION,
    sourceIdentity: LIBRARY_CORE_PERSON_TIMELINE_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_PERSON_TIMELINE_NESTED_BOUNDS,
    // Identical to feed_page_v1: the timeline pages the same shadow rows with
    // `ORDER BY sortAt DESC, globalId ASC`. `sortAt` rather than `publishedAt`
    // for the same reason given there.
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
    requestSchema: LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_PERSONS_GRAPH_PROJECTION,
    sourceIdentity: LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS,
    // stableSort and tieBreakKey stay null on purpose. The response carries two
    // independently keyed series (social by platform+authorId, rss by feedUrl)
    // and ResolvedQuerySortContract expresses one column list with one final
    // tie-break. Declaring only one series would say nothing about the other,
    // so sort_contract_unresolved stays open. The real orderings are recorded
    // in LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER.
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
  }),
  preferences_snapshot_v1: plannedQuery({
    defaultLimit: LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
    maximumLimit: LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
    maximumRows: LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_ROWS,
    maximumResponseBytes:
      LIBRARY_CORE_PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES,
    cursor: interactiveCursor("single_page"),
    totalCountIntent: "none",
    rendererCache: true,
    invalidationKeyIntent: ["preferences"],
    currentKinds: ["preferences_snapshot_v1"],
    requestSchema: LIBRARY_CORE_PREFERENCES_SNAPSHOT_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_PREFERENCES_SNAPSHOT_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_PREFERENCES_SNAPSHOT_PROJECTION,
    sourceIdentity: LIBRARY_CORE_PREFERENCES_SNAPSHOT_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_PREFERENCES_SNAPSHOT_NESTED_BOUNDS,
    stableSort: {
      columns: [{ column: "path", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "path",
    resolvedImplementationBlockers: ["runtime_adapter_unimplemented"],
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
    requestSchema: LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA,
    responseSchema: LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA,
    projection: LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION,
    sourceIdentity: LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY,
    nestedBounds: LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS,
    // Both count series come from a BTreeMap keyed by label, so they arrive in
    // ascending binary label order. Labels are map keys and therefore unique,
    // which makes label a valid final tie-break.
    stableSort: {
      columns: [{ column: "label", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    },
    tieBreakKey: "label",
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
