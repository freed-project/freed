import {
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";

/**
 * Closed contract for the Map and Story Wall candidate reader.
 *
 * Every bound is read from the live native reader. `shadow_store.rs` fixes the
 * per-surface ceilings and the selected columns; the surface predicate is
 * evaluated inside SQLite so the renderer never receives non-candidates.
 */
export const LIBRARY_CORE_SURFACE_ITEMS_QUERY_ID =
  "library_surface_items_v1" as const;
export const LIBRARY_CORE_SURFACE_ITEMS_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_MAP_ITEMS = 1_000;
export const LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_STORY_WALL_ITEMS = 250;

const LIBRARY_CORE_SURFACE_KINDS = Object.freeze([
  "map",
  "story_wall",
] as const);

export type LibraryCoreSurfaceKindV1 =
  (typeof LIBRARY_CORE_SURFACE_KINDS)[number];

export const LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_surface_items_request_v1",
  schemaVersion: LIBRARY_CORE_SURFACE_ITEMS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SURFACE_ITEMS_QUERY_ID,
  canonicalKeys: Object.freeze([
    "limit",
    "queryId",
    "schemaVersion",
    "surface",
  ]),
  surfaceKinds: LIBRARY_CORE_SURFACE_KINDS,
  /** The ceiling depends on which surface is asked for. */
  maximumItemsBySurface: Object.freeze({
    map: LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_MAP_ITEMS,
    story_wall: LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_STORY_WALL_ITEMS,
  }),
});

export const LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_surface_items_response_v1",
  schemaVersion: LIBRARY_CORE_SURFACE_ITEMS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SURFACE_ITEMS_QUERY_ID,
  canonicalKeys: Object.freeze([
    "queryId",
    "rows",
    "schemaVersion",
    "source",
    "surface",
  ]),
  maximumRows: LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_MAP_ITEMS,
});

/**
 * The surface reader selects the same columns as the single-item lookup and the
 * bounded scan, including the content and preserved bodies. Reused by reference
 * so the three cannot drift apart.
 */
export const LIBRARY_CORE_SURFACE_ITEMS_PROJECTION =
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION;
export const LIBRARY_CORE_SURFACE_ITEMS_SOURCE_IDENTITY =
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY;
export const LIBRARY_CORE_SURFACE_ITEMS_NESTED_BOUNDS =
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS;

/**
 * Why this query keeps `sort_contract_unresolved`.
 *
 * Both surfaces read `ORDER BY sortAt DESC, globalId ASC`, but a declared sort
 * contract asserts the order is index-satisfiable, and for one surface it is
 * not. Verified with `EXPLAIN QUERY PLAN` against the real SQL:
 *
 *   Story Wall  SCAN feed_items USING INDEX feed_items_friends_timeline
 *   Map         SCAN feed_items | USE TEMP B-TREE FOR ORDER BY
 *
 * Story Wall leads with `hidden IS NOT 1 AND archived IS NOT 1`, matching the
 * index prefix, so it walks the index in order. Map's predicate is a pure OR
 * chain of `json_type`, `json_extract`, and `GLOB` with no indexable leading
 * term, so SQLite scans every row and sorts the matches.
 *
 * Declaring the order here would claim an index-satisfiable sort the store does
 * not achieve for Map. The blocker stays open until issue #1323 lands a derived
 * `hasLocation` column and a `(hasLocation, sortAt DESC, globalId ASC)` index.
 * The intended order is recorded below so that work does not re-derive it.
 */
export const LIBRARY_CORE_SURFACE_ITEMS_INTENDED_ORDER = Object.freeze({
  columns: Object.freeze([
    Object.freeze({ column: "sortAt", direction: "desc" }),
    Object.freeze({ column: "globalId", direction: "asc" }),
  ]),
  textCollation: "binary",
  tieBreakKey: "globalId",
  indexSatisfiedBySurface: Object.freeze({ map: false, story_wall: true }),
  unresolvedReason: "map_surface_requires_temp_b_tree_see_issue_1323",
});

export interface LibraryCoreSurfaceItemsRequestV1 {
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_SURFACE_ITEMS_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_SURFACE_ITEMS_SCHEMA_VERSION;
  readonly surface: LibraryCoreSurfaceKindV1;
}
