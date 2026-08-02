/**
 * Closed contract for the Desktop persons-graph activity aggregate.
 *
 * Every bound is read from the live native reader rather than chosen here.
 * `library_core_feed_reader_runtime.rs` fixes the query identity, the combined
 * 5,000 source-key-plus-feed-URL ceiling, the recent-window rule, and the 8 MiB
 * response ceiling. `shadow_store.rs` fixes the summary shapes and the ordering
 * of each series.
 */
export const LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID = "persons_graph_v1" as const;
export const LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION = 1 as const;
/** Sources and RSS feed URLs share one ceiling; the native reader sums them. */
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES = 5_000;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_REQUEST_BYTES = 2 * 1_048_576;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;

export const LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_persons_graph_request_v1",
  schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID,
  canonicalKeys: Object.freeze([
    "queryId",
    "recentWindow",
    "rssFeedUrls",
    "schemaVersion",
    "sources",
  ]),
  recentWindowKeys: Object.freeze(["endMs", "startMs"]),
  sourceKeys: Object.freeze(["authorId", "platform"]),
  /** `sources.length + rssFeedUrls.length` is checked against one ceiling. */
  maximumCombinedSources:
    LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
  /** Unlike the timeline, an empty source set is admitted. */
  requiresNonEmptySources: false,
  maximumRequestBytes: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_REQUEST_BYTES,
});

export const LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_persons_graph_response_v1",
  schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID,
  canonicalKeys: Object.freeze([
    "queryId",
    "rss",
    "schemaVersion",
    "social",
    "source",
    "totalItemCount",
  ]),
  socialKeys: Object.freeze([
    "authorId",
    "avatarGlobalId",
    "avatarPublishedAt",
    "avatarUrl",
    "hasLocation",
    "itemCount",
    "latestActivityAt",
    "platform",
  ]),
  rssKeys: Object.freeze([
    "avatarGlobalId",
    "avatarPublishedAt",
    "avatarUrl",
    "feedUrl",
    "hasLocation",
    "itemCount",
    "latestActivityAt",
  ]),
  maximumResponseBytes: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_PERSONS_GRAPH_PROJECTION = Object.freeze({
  projectionId: "library_core_persons_graph_activity_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  /**
   * Two independently keyed series rather than one row order. `social` is keyed
   * by (platform, authorId) and `rss` by feedUrl.
   */
  orderedColumns: Object.freeze(["platform", "authorId", "feedUrl"]),
});

export const LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS = Object.freeze({
  social: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
    maximumUnicodeScalarsPerItem: 4_096,
    maximumUtf8BytesPerItem: 4_096,
  }),
  rss: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
    maximumUnicodeScalarsPerItem: 4_096,
    maximumUtf8BytesPerItem: 4_096,
  }),
});

/**
 * Why this query keeps `sort_contract_unresolved`.
 *
 * The response carries two independently ordered series: `social` comes from a
 * `BTreeMap<FriendSourceKey, _>`, so it is ascending by platform then authorId,
 * and `rss` comes from a `BTreeMap<String, _>` keyed by feed URL, so it is
 * ascending by feedUrl. `ResolvedQuerySortContract` describes one column list
 * with one final tie-break, which cannot express two key spaces at once.
 *
 * Declaring only the social order would be a plausible-looking placeholder that
 * silently says nothing about half the response, so the blocker stays open
 * until either the registry grows a per-series sort contract or this query is
 * split. The orderings themselves are recorded here so that later work does not
 * have to re-derive them.
 */
export const LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER = Object.freeze({
  social: Object.freeze({
    columns: Object.freeze(["platform", "authorId"]),
    direction: "asc",
    textCollation: "binary",
  }),
  rss: Object.freeze({
    columns: Object.freeze(["feedUrl"]),
    direction: "asc",
    textCollation: "binary",
  }),
  unresolvedReason: "multi_series_response_needs_per_series_sort_contract",
});

export interface LibraryCorePersonsGraphWindowV1 {
  readonly startMs: number;
  readonly endMs: number;
}

export interface LibraryCorePersonsGraphRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID;
  readonly recentWindow: LibraryCorePersonsGraphWindowV1;
  readonly rssFeedUrls: readonly string[];
  readonly schemaVersion: typeof LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION;
  readonly sources: readonly {
    readonly platform: string;
    readonly authorId: string;
  }[];
}
