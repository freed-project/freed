export const LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION = 1 as const;

export const LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_V1 = Object.freeze({
  schemaVersion: LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  order: Object.freeze([
    Object.freeze({ direction: "desc", field: "roundedPriority" }),
    Object.freeze({ direction: "desc", field: "publishedAt" }),
    Object.freeze({ collation: "binary", direction: "asc", field: "globalId" }),
  ]),
  executor: "bounded_sqlite_keyset_query",
});
