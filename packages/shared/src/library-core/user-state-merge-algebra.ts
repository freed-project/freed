/**
 * The de facto merge algebra for feed item user state.
 *
 * `mergeUserState` in `packages/shared/src/schema.ts` is the single point where
 * two copies of one item's user state converge. It runs today, on real data,
 * reached from `deduplicateDocFeedItems` and from the three provider capture
 * reconcilers (`reconcileProviderEssayItems`, `reconcileFollowRosterCapture`,
 * `reconcileYouTubeCapture`).
 *
 * That makes it the authoritative statement of how each synchronized user-state
 * leaf already converges, whatever the Library Core operation registry has or
 * has not declared. This module records those rules so the replacement protocol
 * has something traced to compare against instead of a blank field, and so the
 * behavior cannot drift unobserved.
 *
 * Nothing here changes behavior. These are descriptions, and the accompanying
 * test suite holds `mergeUserState` to them.
 */

export type LibraryCoreUserStateMergeRule =
  /** `target || source`. Once true anywhere, true everywhere. */
  | "boolean_or"
  /** `boolean_or`, except a false result is stored as absent rather than false. */
  | "boolean_or_absent_when_false"
  /** Defined wins over absent; otherwise the smaller value. */
  | "timestamp_min"
  /**
   * Defined wins over absent. If either side is positive, the larger positive
   * wins and non-positive values lose. If both are non-positive, the smaller
   * wins. Non-positive values encode a pending or failed sync, so a real
   * receipt always beats one.
   */
  | "synced_timestamp"
  /**
   * Not independently mergeable. `likedAt` and `likedSyncedAt` converge as a
   * pair in `mergeLikedIntentState`: when both sides carry a distinct finite
   * `likedAt`, the later one wins and drags its own `likedSyncedAt` along, so
   * the receipt can never outlive the like it belongs to. Otherwise the two
   * leaves fall back to `timestamp_min` and `synced_timestamp` separately.
   */
  | "liked_intent_pair"
  /** Set union, preserving the target's existing order and appending new values. */
  | "string_set_union";

/**
 * One entry per synchronized `userState` leaf, traced from `mergeUserState`.
 *
 * `highlights` is deliberately absent. It merges through `mergeHighlights`,
 * which is a record-level rule rather than a leaf rule, and folding it in here
 * would misrepresent it as one.
 */
export const LIBRARY_CORE_USER_STATE_MERGE_ALGEBRA = Object.freeze({
  hidden: "boolean_or",
  saved: "boolean_or",
  archived: "boolean_or",
  liked: "boolean_or_absent_when_false",
  readAt: "timestamp_min",
  savedAt: "timestamp_min",
  archivedAt: "timestamp_min",
  likedAt: "liked_intent_pair",
  likedSyncedAt: "liked_intent_pair",
  seenSyncedAt: "synced_timestamp",
  tags: "string_set_union",
}) satisfies Readonly<Record<string, LibraryCoreUserStateMergeRule>>;

/**
 * `saved` and `archived` merge independently, so merging a saved copy with an
 * archived copy yields an item that is both.
 *
 * This is not an accident and it is not a bug to be quietly fixed. The mutators
 * enforce the exclusion one device at a time: `toggleSaved` clears archive
 * state, and `toggleArchived` refuses to run on a saved item. Convergence does
 * not, and the product answers that with repair rather than prevention. The
 * shadow store counts the condition as `saved_archived_count`, the header
 * surfaces an `Unarchive saved (N)` control when that count is positive, and
 * `feed_items_unarchive_saved_frozen` is registered with
 * `intendedAuthority: "system_repair"` to perform the bulk correction.
 *
 * So the exclusion is a per-device invariant with a cross-device repair, not a
 * global invariant. Any replacement protocol has to decide deliberately whether
 * to keep that shape or promote the exclusion to something merge itself
 * guarantees. See https://github.com/freed-project/freed/issues/1327.
 */
export const LIBRARY_CORE_SAVED_ARCHIVED_EXCLUSION_IS_PER_DEVICE_ONLY =
  true as const;
