import { LIBRARY_CORE_FIELD_REGISTRY } from "./field-registry.js";

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
 * Every synchronized leaf beneath a registry prefix, sorted.
 *
 * Derived rather than transcribed so a leaf added to the registry later is
 * included without anyone remembering. Only `legacy-synchronized` qualifies;
 * `legacy-device-local` and `legacy-compatibility` leaves are excluded because
 * the sanitizers strip them before any write reaches the document.
 */
const synchronizedLeavesUnder = (prefix: string): readonly string[] =>
  Object.freeze(
    LIBRARY_CORE_FIELD_REGISTRY.filter(
      (entry) =>
        entry.registryKey.startsWith(prefix) &&
        entry.currentLocality === "legacy-synchronized",
    )
      .map((entry) => entry.registryKey)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );

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
 * therefore may write any synchronized preference leaf and no others, so the
 * written set is exactly the synchronized preference leaves rather than a
 * shorter list of the ones some caller happens to use today.
 *
 * Derived from the field registry rather than transcribed, so a leaf added
 * later is included without anyone remembering. The derivation was checked
 * against reality: every addressable leaf the registry marks
 * `legacy-synchronized` does land in the document through `updatePreferences`,
 * and every leaf it marks `legacy-device-local` or `legacy-compatibility` does
 * not. `packages/shared/src/preference-locality-boundary.test.ts` holds the
 * second half of that statement.
 *
 * Array-element and record patterns such as `...[]` and `...{groupId}` are
 * included. They are real registry keys naming real synchronized leaves, and
 * omitting them would understate what the operation writes.
 */
export const PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS =
  synchronizedLeavesUnder("library-core-v1:preferences.");

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
 * Derived from the field registry rather than transcribed. Checked against
 * reality: all nineteen `rssFeeds` registry leaves agree with what actually
 * lands through the add and update paths, with no exceptions.
 */
export const RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  synchronizedLeavesUnder("library-core-v1:rssFeeds.");

/**
 * Traced from `addPerson` and `updatePerson`, plus the friend and connection
 * surfaces that funnel into them.
 *
 * Both store a whole sanitized person, and `updatePerson` accepts an arbitrary
 * partial through the same sanitizer, so between them any synchronized person
 * leaf can be written. The four graph leaves are device-local and excluded.
 *
 * Checked against reality: all twenty-two `persons` registry leaves agree with
 * what lands through the add and update paths, no exceptions.
 */
export const PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  synchronizedLeavesUnder("library-core-v1:persons.");

/**
 * Traced from `addAccount` and `updateAccount`.
 *
 * Same shape as the person upsert, and checked the same way: all twenty-nine
 * `accounts` registry leaves agree with what lands.
 */
export const ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS =
  synchronizedLeavesUnder("library-core-v1:accounts.");

/**
 * Traced from `logReachOut`, which is far narrower than the person upsert.
 *
 * It appends one entry to `reachOutLog` and writes nothing else on the person.
 * The entry is sanitized through `sanitizeReachOutLogWrite`, so exactly three
 * leaves can be written. Verified directly: an entry carrying an unmodelled
 * field stores `{loggedAt, channel, notes}` and drops the rest.
 *
 * Derived by filtering the registry rather than transcribed. A first draft
 * spelled the key placeholder `{id}` when the registry uses `{personId}`, and
 * hand-written keys invite exactly that. Filtering cannot misspell them.
 */
export const PERSON_REACH_OUT_APPEND_TOUCHED_FIELD_REGISTRY_KEYS =
  Object.freeze(
    PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.filter((key) =>
      key.includes(".reachOutLog[]."),
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
