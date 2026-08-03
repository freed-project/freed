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
  Object.freeze(
    LIBRARY_CORE_FIELD_REGISTRY.filter(
      (entry) =>
        entry.registryKey.startsWith("library-core-v1:preferences.") &&
        entry.currentLocality === "legacy-synchronized",
    )
      .map((entry) => entry.registryKey)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
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
