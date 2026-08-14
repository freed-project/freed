/**
 * Runtime-neutral vocabulary for the dormant Library Core field census.
 *
 * These types describe the legacy state that exists today and leave future
 * Library Core decisions null. Nothing here grants authority, selects an
 * adapter, activates persistence, or changes provider behavior.
 */

export type LibraryCoreKnownRoot =
  | "feedItems"
  | "rssFeeds"
  | "persons"
  | "accounts"
  | "preferences"
  | "meta"
  | "desktopClient:*";

export type LibraryCoreRetainedRoot =
  LibraryCoreKnownRoot | "friends" | "<unknown-root>";

export type LibraryCoreEntity =
  | "FeedItem"
  | "RssFeed"
  | "Person"
  | "Account"
  | "UserPreferences"
  | "DocumentMeta"
  | "DesktopClientRegistration"
  | "LegacyFriend"
  | "OpaqueRecoveryEvidence";

export type LibraryCoreLegacyDisposition =
  "sync" | "positive-sync" | "device-local" | "compatibility-only";

export type LibraryCoreLegacyValueShape =
  | "typescript-string"
  | "typescript-number"
  | "typescript-boolean"
  | "unregistered-legacy-value";

export type LibraryCoreCurrentLocality =
  | "legacy-synchronized"
  | "legacy-device-local"
  | "legacy-derived"
  | "legacy-compatibility";

export type LibraryCoreCurrentAuthority =
  | "legacy-automerge-document"
  | "legacy-automerge-read-only"
  | "installation-local-store"
  | "derived-runtime";

export type LibraryCorePlannedLocality =
  | "synchronized"
  | "device-local"
  | "secret"
  | "derived"
  | "blob"
  | "compatibility"
  | "opaque";

export type LibraryCorePlannedAuthority =
  | "library-operation-log"
  | "installation-local-store"
  | "content-addressed-blob-store"
  | "compatibility-store"
  | "opaque-recovery-store";

/**
 * Closed future codecs already defined by the architecture contract.
 *
 * Legacy TypeScript `number` is intentionally absent. The current schema does
 * not prove safe-integer or registered fractional semantics.
 */
export type LibraryCoreValueCodec =
  "boolean" | "safe-integer" | "utf8-string" | "literal-string";

export type LibraryCoreStorageTier =
  "hot" | "warm" | "cold" | "blob" | "device";

export type LibraryCoreDeleteBehavior =
  "tombstone" | "cascade" | "orphan" | "never";

export type LibraryCorePathSegment =
  | {
      readonly kind: "property";
      readonly name: string;
    }
  | {
      readonly kind: "entity-key";
      readonly name: string;
    }
  | {
      readonly kind: "array-element";
    }
  | {
      readonly kind: "dynamic-map-key";
      readonly name: string;
    }
  | {
      readonly kind: "fixed-map-key";
      readonly name: string;
      readonly allowedKeys: readonly string[];
    }
  | {
      readonly kind: "dynamic-root-key";
      readonly prefix: "desktopClient:";
      readonly name: "installationId";
    }
  | {
      /**
       * Recursively matches any unregistered descendant below this root.
       * It is one fallback per root, not a claim about one object level.
       */
      readonly kind: "unregistered-descendant";
      readonly recursive: true;
    }
  | {
      readonly kind: "unknown-root";
    };

export interface LibraryCorePathPattern {
  readonly text: string;
  readonly segments: readonly LibraryCorePathSegment[];
}

export type LibraryCorePresence = "required" | "optional";

export type LibraryCoreActivationBlocker =
  | "allowed_operations_undecided"
  | "allowed_values_undecided"
  | "backup_behavior_undecided"
  | "delete_behavior_undecided"
  | "executable_validation_undecided"
  | "explicit_clear_undecided"
  | "export_behavior_undecided"
  | "field_range_undecided"
  | "legacy_root_requires_migration"
  | "legacy_migration_rule_undecided"
  | "materialized_projection_undecided"
  | "merge_algebra_undecided"
  | "omission_semantics_undecided"
  | "opaque_retention_unimplemented"
  | "planned_authority_undecided"
  | "planned_locality_undecided"
  | "presence_semantics_undecided"
  | "protocol_codec_undecided"
  | "provenance_behavior_undecided"
  | "query_eligibility_undecided"
  | "redaction_behavior_undecided"
  | "relationship_cascade_undecided"
  | "restore_semantics_undecided"
  | "storage_tier_undecided"
  | "unknown_root_requires_classification"
  | "unregistered_descendant_requires_classification";

export interface LibraryCoreFieldActivation {
  readonly status: "blocked";
  /** Sorted, nonempty, and derived from every unresolved field below. */
  readonly blockers: readonly LibraryCoreActivationBlocker[];
}

export interface LibraryCoreOpaqueRetentionReference {
  /**
   * Planned cutover identity. Gate A does not implement or populate it.
   * Current unknown descendants still live in the legacy Automerge document.
   */
  readonly kind: "immutable-legacy-source-reference";
  readonly requiredIdentity: readonly [
    "sourceOccurrenceId",
    "sourcePath",
    "sourceDigest",
  ];
}

export interface LibraryCoreFieldRegistryEntry {
  readonly registryKey: string;
  readonly root: LibraryCoreRetainedRoot;
  readonly entity: LibraryCoreEntity;
  readonly path: LibraryCorePathPattern;
  readonly legacyValueShape: LibraryCoreLegacyValueShape;
  readonly valueCodec: LibraryCoreValueCodec | null;
  readonly allowedValues:
    readonly string[] | { readonly kind: "not-applicable" } | null;
  /** Presence in the immediate object, array, or map only. */
  readonly localPresence: LibraryCorePresence | null;
  /** True when any containing object or collection may itself be absent. */
  readonly ancestorOptional: boolean | null;
  readonly nullable: boolean;
  readonly currentValidation: {
    readonly kind: "typescript-shape-census" | "unregistered-legacy-shape";
    readonly schema: string;
  };
  readonly executableValidation: null;
  readonly currentLocality: LibraryCoreCurrentLocality;
  readonly currentAuthority: LibraryCoreCurrentAuthority;
  readonly plannedLocality: LibraryCorePlannedLocality | null;
  readonly plannedAuthority: LibraryCorePlannedAuthority | null;
  readonly legacyDisposition: LibraryCoreLegacyDisposition | null;
  readonly numericRange: { readonly kind: "not-applicable" } | null;
  readonly storageTier: LibraryCoreStorageTier | null;
  readonly allowedOperationTypes: readonly string[] | null;
  readonly mergeAlgebra: string | null;
  readonly omissionSemantics: string | null;
  readonly explicitClear: string | null;
  readonly deleteBehavior: LibraryCoreDeleteBehavior | null;
  readonly restoreSemantics: string | null;
  readonly relationshipCascade: string | null;
  readonly legacySourcePaths: readonly string[];
  readonly opaqueRetention: LibraryCoreOpaqueRetentionReference | null;
  readonly migrationRule: string | null;
  readonly backupBehavior: string | null;
  readonly exportBehavior: string | null;
  readonly redactionBehavior: string | null;
  readonly provenanceBehavior: string | null;
  readonly materializedProjection: boolean | null;
  readonly queryEligible: boolean | null;
  readonly activation: LibraryCoreFieldActivation;
}

export type LibraryCoreRootKind =
  | "entity-map"
  | "singleton"
  | "dynamic-root"
  | "legacy-root"
  | "opaque-fallback";

export interface LibraryCoreRootRegistryEntry {
  readonly registryKey: string;
  readonly root: LibraryCoreRetainedRoot;
  readonly entity: LibraryCoreEntity;
  readonly kind: LibraryCoreRootKind;
  readonly path: LibraryCorePathPattern;
  readonly currentLocality: LibraryCoreCurrentLocality;
  readonly currentAuthority: LibraryCoreCurrentAuthority;
  readonly plannedLocality: null;
  readonly plannedAuthority: null;
  readonly cutover: "blocked";
  readonly blockers: readonly LibraryCoreActivationBlocker[];
}
