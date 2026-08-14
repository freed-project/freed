/**
 * Idempotency of `mergeFeedItemInto`.
 *
 * `mergeFeedItemInto` is reached from `deduplicateDocFeedItems` and from all
 * three provider capture reconcilers, so the same source can be merged into the
 * same target many times over a library's life. That makes idempotency a real
 * operational property rather than a theoretical nicety: a rule that grows a
 * value on every pass would inflate without bound.
 *
 * Measured, every semantic field is idempotent. Counters take a max, timestamps
 * take a min or a max, collections union by identity, and fill-if-absent rules
 * stop filling once present. Merging one source twice produces exactly what
 * merging it once produces.
 *
 * One field is not, and it is the reason this module exists.
 */

/**
 * The single field that changes on a semantically empty merge.
 *
 * `mergeFeedItemInto` ends by calling `applySemanticEnrichmentToItem`, which
 * calls `applyContentSignalsToItem` with freshly inferred signals and assigns
 * `target.inferredAt = clean.inferredAt` unconditionally. That value comes from
 * the wall clock, so it differs on every call even when the inferred signals
 * are identical to the ones already stored.
 *
 * Automerge records a put for every assignment rather than diffing, so each
 * pass appends operations to the change history for work that changed nothing.
 */
export const FEED_ITEM_MERGE_NON_IDEMPOTENT_FIELD =
  "contentSignals.inferredAt" as const;

/**
 * Measured cost of one semantically empty reconcile pass.
 *
 * Two hundred items were built into an Automerge document, enrichment was
 * settled so the first pass could not be doing real work, and each item was
 * then merged with an identical copy of itself five times. Every pass appended
 * a change of the same size, which is the signature of a fixed per-item write
 * rather than a converging one.
 *
 * These numbers describe one measurement on synthetic items, not a guarantee.
 * They are recorded so the tradeoff can be discussed with a magnitude attached
 * instead of an adjective. See
 * https://github.com/freed-project/freed/issues/1331.
 */
export const FEED_ITEM_MERGE_EMPTY_PASS_MEASUREMENT = Object.freeze({
  items: 200,
  /** Bytes of one appended change per pass, uncompressed. */
  changeBytesPerPass: 1_732,
  /** `changeBytesPerPass / items`, rounded. */
  changeBytesPerItemPerPass: 8.7,
  /** Growth of the compressed saved document, which dedupes far better. */
  savedBytesPerItemPerPass: 1.4,
});
