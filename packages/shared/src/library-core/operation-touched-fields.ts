import { LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY } from "./operation-field-algebra-contracts.js";
import {
  LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS,
} from "./operation-field-manifest.js";

/**
 * Written-leaf inventories for candidate successor operations.
 *
 * A `touchedFieldRegistryKeys` entry lists every synchronized leaf the
 * operation may **write** on any code path, as a sorted unique set. Leaves the
 * operation only reads as a precondition are documented here in prose but are
 * deliberately excluded from the written set, because a precondition read and a
 * write have different replication consequences and collapsing them would hide
 * that difference.
 *
 * Every key below is traced from the legacy mutator the operation is a
 * candidate successor for. Nothing here declares merge algebra, payload syntax,
 * or write authority.
 */

/**
 * The active operation manifests are closed runtime protocol data. Historical
 * field-registry tests compare them against the frozen legacy census, but
 * production verification does not import that retired authority model.
 */

export const LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY =
  "library-core-v1:feedItems.{globalId}.userState.archived";

export const LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY =
  "library-core-v1:feedItems.{globalId}.userState.archivedAt";

export const LIBRARY_CORE_FEED_ITEM_SAVED_FIELD_REGISTRY_KEY =
  "library-core-v1:feedItems.{globalId}.userState.saved";

export const LIBRARY_CORE_FEED_ITEM_SAVED_AT_FIELD_REGISTRY_KEY =
  "library-core-v1:feedItems.{globalId}.userState.savedAt";

/**
 * Traced from `toggleArchived` in `packages/shared/src/schema.ts`.
 *
 * Archiving writes `archived` on every unguarded path and either sets or
 * deletes `archivedAt` alongside it. It additionally **reads** `saved` as a
 * precondition and returns without writing anything when the item is saved, so
 * the archive path observes saved state without owning it.
 */
export const FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze([
    LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY,
    LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY,
  ]);

/**
 * Traced from `toggleSaved` in `packages/shared/src/schema.ts`.
 *
 * Saving writes `saved` on every path and sets or deletes `savedAt` alongside
 * it. On the save path it also clears archive state, writing `archived` and
 * deleting `archivedAt`, so a saved item can never also be archived. The
 * archive leaves belong in this written set because this operation really does
 * write them rather than merely observe them.
 */
export const FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze([
    LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY,
    LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY,
    LIBRARY_CORE_FEED_ITEM_SAVED_FIELD_REGISTRY_KEY,
    LIBRARY_CORE_FEED_ITEM_SAVED_AT_FIELD_REGISTRY_KEY,
  ]);

/**
 * Traced from `updatePreferences` in `packages/shared/src/schema.ts`.
 *
 * That function accepts an arbitrary `Partial<UserPreferences>`, strips it
 * through `sanitizeUserPreferenceWrite`, and deep-merges whatever survives. It
 * therefore may write any synchronized preference node and no others, so the
 * written set is exactly the synchronized preference nodes rather than a
 * shorter list of the ones some caller happens to use today.
 *
 * The closed manifest is checked against both the persisted legacy census and
 * the current sanitizer behavior. Every addressable synchronized leaf lands
 * through `updatePreferences`, while device-local and compatibility leaves do
 * not. `packages/shared/src/preference-locality-boundary.test.ts` holds the
 * sanitizer half of that statement.
 *
 * Array-element and record patterns such as `...[]` and `...{groupId}` are
 * included. They are real registry keys naming real synchronized leaves, and
 * omitting them would understate what the operation writes.
 */
export const PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS;

export const LIBRARY_CORE_RSS_FEED_TITLE_FIELD_REGISTRY_KEY =
  "library-core-v1:rssFeeds.{url}.title";

/**
 * Traced from `renameFeed`, which is narrower than the worker request it uses.
 *
 * `renameFeed(url, title)` sends `{ title }` and nothing else, so this
 * operation writes one leaf. `UPDATE_RSS_FEED` can carry an arbitrary partial,
 * but the operation is a title assignment and the store surface it succeeds
 * only ever sets the title. Declaring the whole feed surface here would
 * overstate it.
 */
export const RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze([LIBRARY_CORE_RSS_FEED_TITLE_FIELD_REGISTRY_KEY]);

/**
 * Traced from `addRssFeed`, `updateRssFeed`, and the batch refresh path.
 *
 * `addRssFeed` stores a whole sanitized feed, and `UPDATE_RSS_FEED` carries an
 * arbitrary partial through the same sanitizer, so between them any
 * synchronized feed leaf can be written. `BATCH_REFRESH_FEEDS` is narrower
 * still, writing only `lastFetched`, `title`, and `siteUrl`, all of which are
 * already in this union.
 *
 * The manifest is checked against the historical census and the current add
 * and update paths.
 */
export const RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS;

/**
 * Traced from `addPerson` and `updatePerson`, plus the friend and connection
 * surfaces that funnel into them.
 *
 * Person scalar fields and tags are written by this operation. Reach-out
 * history is a separate stable-identity event relation and can only change
 * through `person_reach_out_append`. The four graph leaves are device-local.
 */
export const PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS = Object.freeze(
  LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS.filter(
    (key) => !key.includes(".reachOutLog[]."),
  ),
);

/**
 * Traced from `addAccount` and `updateAccount`.
 *
 * Same shape as the person upsert, and checked the same way: all twenty-nine
 * `accounts` registry leaves agree with what lands.
 */
export const ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS;

export const FRIEND_REPLACE_TOUCHED_FIELD_REGISTRY_KEYS = Object.freeze(
  [
    ...PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
    ...ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  ].sort(),
);

/**
 * Traced from `logReachOut`, which is far narrower than the person upsert.
 *
 * It appends one entry to `reachOutLog` and writes nothing else on the person.
 * The entry is sanitized through `sanitizeReachOutLogWrite`, so exactly three
 * leaves can be written. Verified directly: an entry carrying an unmodelled
 * field stores `{loggedAt, channel, notes}` and drops the rest.
 *
 * Derived from the closed person operation manifest so the placeholder and
 * upsert surface cannot drift.
 */
export const PERSON_REACH_OUT_APPEND_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS.filter((key) =>
      key.includes(".reachOutLog[]."),
    ),
  );

/**
 * Traced from `addFeedItem` and `updateFeedItem`, which every capture request
 * funnels into.
 *
 * Both write a whole sanitized item, and `updateFeedItem` accepts an arbitrary
 * partial through the same sanitizer, so between them any synchronized item
 * leaf can be written. `BATCH_REFRESH_FEEDS` and `BATCH_IMPORT_ITEMS` add
 * nothing beyond that union.
 *
 * Three leaves are excluded and each for its own reason. `priority` and
 * `priorityComputedAt` are `legacy-derived` and written only by merge, never
 * by these paths, which is the subject of issue 1339. `preservedContent.html`
 * is `legacy-compatibility` and stripped unless a caller opts into legacy
 * HTML.
 *
 * Checked against reality: all seventy-eight `feedItems` registry leaves agree
 * with what lands, no exceptions.
 */
export const FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS;

/**
 * Traced from `toggleLiked`, which writes the three like leaves together.
 *
 * Liking sets `liked` and `likedAt` and clears `likedSyncedAt`; unliking
 * clears all three. The receipt leaf belongs here because this operation
 * really does write it, not merely observe it.
 */
export const FEED_ITEM_LIKE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter((key) =>
      /\.userState\.(liked|likedAt|likedSyncedAt)$/.test(key),
    ),
  );

/**
 * Traced from `confirmSeenSynced`, which writes exactly one leaf.
 *
 * Verified directly: after the call the item's user state gains `seenSyncedAt`
 * and nothing else.
 */
export const FEED_ITEM_SEEN_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter((key) =>
      key.endsWith(".userState.seenSyncedAt"),
    ),
  );

/**
 * Traced from `confirmLikedSynced`, the mirror of the seen receipt.
 */
export const FEED_ITEM_LIKE_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter((key) =>
      key.endsWith(".userState.likedSyncedAt"),
    ),
  );

/**
 * Traced from `markAsRead`, which writes one leaf and reads none.
 *
 * Named rather than spelled inline at the registry entry so the bulk read
 * repair can reuse the same array by reference. Two declarations that must
 * always agree should be one object, not two literals that happen to match.
 */
export const FEED_ITEM_READ_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze([LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY]);

/**
 * Bulk repairs write exactly what their single-item counterparts write.
 *
 * Each is verified by calling the mutator and diffing the item's user state
 * before and after:
 *
 * - `markItemsAsRead` and `markAllVisibleAsRead` change `readAt` only.
 * - `archiveItemsById` and `archiveAllReadUnsaved` change `archived` and
 *   `archivedAt`.
 * - `unarchiveSavedItems` changes the same two, clearing rather than setting.
 *
 * They are declared by reference to the assignment sets rather than copied, so
 * the two cannot drift apart. The registry test asserts identity, not equality.
 */
export const FEED_ITEMS_READ_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS =
  FEED_ITEM_READ_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS;

export const FEED_ITEMS_ARCHIVE_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS =
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS;

/**
 * `healUntitledFeedTitles` assigns `feed.title` and nothing else.
 *
 * Traced by reading rather than probed: it lives in the desktop worker and is
 * not exported from this package, so there is no shared entry point to call.
 * Saying which evidence backs a declaration matters more than pretending every
 * one came from the same kind.
 */
export const RSS_FEEDS_HEAL_UNTITLED_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS =
  RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS;

/**
 * Traced from `linkAccountToPerson` and the `UPSERT_CONNECTION_PERSONS`
 * handler, which write the same two leaves.
 *
 * Both set `personId` and stamp `updatedAt`, and nothing else on the account.
 * Verified by diffing the stored account before and after.
 *
 * `updateAccount` also appears among this operation's candidate surfaces
 * because it is the generic mechanism the assignment goes through, the same
 * way `UPDATE_RSS_FEED` appears under the feed title assignment. The operation
 * is an assignment, so it gets the assignment's leaves rather than the whole
 * account surface.
 */
export const ACCOUNT_PERSON_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter((key) =>
      /\.(personId|updatedAt)$/.test(key),
    ),
  );

/**
 * Traced from `backfillContentSignals`, which calls
 * `applySemanticEnrichmentToItem` on items missing current signals.
 *
 * That call is `applyContentSignalsToItem` followed by
 * `applyEventCandidateToItem`, so the written set is the union of both
 * subtrees.
 *
 * Evidence differs between the two halves and that is worth stating. The
 * `contentSignals` leaves were probed: running the backfill over an item with
 * its signals stripped changes those and nothing else. The `eventCandidate`
 * leaves are read-traced from the same enrichment call, because whether a
 * given item yields an event candidate depends on heuristic inference that a
 * fixture cannot reliably force.
 */
export const FEED_ITEMS_CONTENT_SIGNALS_BACKFILL_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter(
      (key) =>
        key.includes(".contentSignals.") || key.includes(".eventCandidate."),
    ),
  );

/**
 * Why saved and archived still carry `field_algebra_unresolved`.
 *
 * `toggleSaved` and `toggleArchived` jointly maintain the invariant that an
 * item is never both saved and archived: saving clears archive state, and
 * archiving refuses to run on a saved item. Independent per-leaf merge algebras
 * cannot preserve that. Two actors converging a save against an archive under
 * any per-leaf rule can land on `saved && archived`, the exact state both
 * mutators exist to prevent.
 *
 * `LibraryCoreOperationDefinition.fieldAlgebra` holds a single
 * `LibraryCoreOperationFieldAlgebraContract`, which merges one leaf against one
 * leaf. It cannot express a rule spanning two leaves, so declaring anything for
 * these operations would claim convergence the type cannot deliver. Both stay
 * null and both keep the blocker until the coupled rule is designed.
 *
 * See https://github.com/freed-project/freed/issues/1327.
 */
export const FEED_ITEM_SAVED_ARCHIVED_EXCLUSION_INVARIANT =
  "an item is never simultaneously saved and archived" as const;
