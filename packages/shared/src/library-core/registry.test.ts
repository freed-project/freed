import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
} from "./feed-page-contracts.js";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA,
} from "./feed-browse-page-contracts.js";
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
  LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER,
  LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY,
} from "./persons-graph-contracts.js";
import {
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
  LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA,
  LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";
import {
  LIBRARY_CORE_ITEM_SCAN_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_SCAN_PROJECTION,
  LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA,
  LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA,
  LIBRARY_CORE_ITEM_SCAN_SOURCE_IDENTITY,
} from "./item-scan-contracts.js";
import {
  LIBRARY_CORE_SURFACE_ITEMS_INTENDED_ORDER,
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
  LIBRARY_CORE_FACET_SUMMARY_TAG_ORDER,
} from "./facet-summary-contracts.js";
import {
  LIBRARY_CORE_FIELD_REGISTRY,
} from "./field-registry.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
} from "./operation-envelope-contracts.js";
import { FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import {
  FEED_ITEM_READ_AT_FIELD_ALGEBRA,
  LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
} from "./operation-field-algebra-contracts.js";
import {
  LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES,
  LIBRARY_CORE_MAX_TRANSACTION_MEMBERS,
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_OPERATION_REGISTRY,
  type LibraryCoreOperationBlocker,
  type LibraryCoreOperationDefinition,
  type LibraryCoreOperationId,
} from "./operation-registry.js";
import {
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_SAVED_ARCHIVED_EXCLUSION_INVARIANT,
  FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  LIBRARY_CORE_RSS_FEED_TITLE_FIELD_REGISTRY_KEY,
  LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY,
  LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY,
  LIBRARY_CORE_FEED_ITEM_SAVED_AT_FIELD_REGISTRY_KEY,
  LIBRARY_CORE_FEED_ITEM_SAVED_FIELD_REGISTRY_KEY,
} from "./operation-touched-fields.js";
import { LIBRARY_CORE_ENTITY_ID_CODEC_V1 } from "./protocol-scalars.js";
import {
  LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL,
  LIBRARY_CORE_QUERY_IDS,
  LIBRARY_CORE_QUERY_REGISTRY,
  LIBRARY_CORE_RENDERER_CACHE_POOL,
} from "./query-registry.js";
import { BASE_APP_STORE_SURFACE_REGISTRY } from "./store-surface-registry.js";

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

type ClosedOperationContract = Partial<
  Pick<
    LibraryCoreOperationDefinition,
    | "entityIdCodec"
    | "fieldAlgebra"
    | "payloadSchema"
    | "touchedFieldRegistryKeys"
    | "transactionMemberSchema"
  >
>;

const OPERATION_CONTRACT_BLOCKERS = [
  ["entityIdCodec", "entity_id_schema_unresolved"],
  ["fieldAlgebra", "field_algebra_unresolved"],
  ["payloadSchema", "payload_schema_unresolved"],
  ["touchedFieldRegistryKeys", "touched_fields_unresolved"],
  ["transactionMemberSchema", "transaction_member_schema_unresolved"],
] as const satisfies readonly (readonly [
  keyof ClosedOperationContract,
  LibraryCoreOperationBlocker,
])[];

/**
 * The only contract fields any operation is allowed to have closed.
 *
 * Anything absent here must be null in the registry and must still carry its
 * blocker. Adding an entry is a claim that the value was traced from a real
 * implementation, so each one names where it came from.
 */
const CLOSED_OPERATION_CONTRACTS: Partial<
  Record<LibraryCoreOperationId, ClosedOperationContract>
> = {
  // Traced from `markAsRead`, which writes exactly one leaf and reads none.
  feed_item_read_assignment: {
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    fieldAlgebra: FEED_ITEM_READ_AT_FIELD_ALGEBRA,
    payloadSchema: FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
    touchedFieldRegistryKeys: [LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY],
    transactionMemberSchema: FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  },
  // Traced from `toggleArchived`. Algebra stays open: archive and save are
  // coupled by an exclusion invariant no single-leaf contract can express.
  // https://github.com/freed-project/freed/issues/1327
  feed_item_archive_assignment: {
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  },
  // Traced from `toggleSaved`, which also writes both archive leaves.
  // https://github.com/freed-project/freed/issues/1327
  feed_item_saved_assignment: {
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  },
  // Traced from `updatePreferences`, which deep-merges an arbitrary partial
  // and so may write any synchronized preference leaf. No entityIdCodec:
  // preferences are a singleton root with no per-entity key.
  preferences_leaf_assignment: {
    touchedFieldRegistryKeys:
      PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  },
  // Traced from `renameFeed`, which sends only `{ title }`. No entityIdCodec:
  // feeds are keyed by url, not by the globalId space the codec was justified
  // against.
  rss_feed_title_assignment: {
    touchedFieldRegistryKeys:
      RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  },
  // Traced from `addRssFeed`, `updateRssFeed`, and the batch refresh path.
  rss_feed_upsert: {
    touchedFieldRegistryKeys: RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  },
};

describe("Library Core operation registry", () => {
  it("has one stable, sorted definition for every dormant operation ID", () => {
    expect([...LIBRARY_CORE_OPERATION_IDS]).toStrictEqual(
      [...LIBRARY_CORE_OPERATION_IDS].sort(),
    );
    expect(Object.keys(LIBRARY_CORE_OPERATION_REGISTRY)).toStrictEqual([
      ...LIBRARY_CORE_OPERATION_IDS,
    ]);
    expect(new Set(LIBRARY_CORE_OPERATION_IDS).size).toBe(
      LIBRARY_CORE_OPERATION_IDS.length,
    );
  });

  it("does not claim unresolved algebra, materializers, or authority", () => {
    for (const operationId of LIBRARY_CORE_OPERATION_IDS) {
      const definition = LIBRARY_CORE_OPERATION_REGISTRY[operationId];
      expect(definition.status).toBe("planned_blocked");

      // Every contract field carries its own blocker, and the blocker is
      // present exactly when the field is null. Deriving both sides from the
      // same table means a declaration cannot be added without dropping its
      // blocker, and a blocker cannot be dropped without a declaration.
      const closed = CLOSED_OPERATION_CONTRACTS[operationId] ?? {};
      for (const [field, blocker] of OPERATION_CONTRACT_BLOCKERS) {
        const declared = closed[field];
        if (declared === undefined) {
          expect(definition[field]).toBeNull();
          expect(definition.blockers).toContain(blocker);
        } else if (Array.isArray(declared)) {
          expect(definition[field]).toStrictEqual(declared);
          expect(definition.blockers).not.toContain(blocker);
        } else {
          // Shared contract objects are asserted by reference so a copy
          // cannot silently drift away from the one the protocol uses.
          expect(definition[field]).toBe(declared);
          expect(definition.blockers).not.toContain(blocker);
        }
      }

      expect(definition.materializer).toBeNull();
      expect(definition.frozenBulkContract).toBeNull();
      expect(definition.blockers.length).toBeGreaterThan(0);
      expect(definition.blockers).toContain("runtime_authority_inactive");
      expect(definition.transactionLimits).toStrictEqual({
        maximumMembers: LIBRARY_CORE_MAX_TRANSACTION_MEMBERS,
        maximumCanonicalTransactionBytes:
          LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES,
      });
      expect("mergeAlgebra" in definition).toBe(false);
    }

    expect(LIBRARY_CORE_MAX_TRANSACTION_MEMBERS).toBe(1_000);
    expect(LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES).toBe(4 * 1_048_576);
    expect(
      LIBRARY_CORE_FIELD_REGISTRY.find(
        (entry) =>
          entry.registryKey ===
          LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
      ),
    ).toMatchObject({
      mergeAlgebra: "minimum_present_nonnegative_safe_integer_v1",
      activation: {
        blockers: expect.not.arrayContaining(["merge_algebra_undecided"]),
      },
    });
  });

  it("binds every declared touched field to a real synchronized leaf", () => {
    const knownLeaves = new Set(
      LIBRARY_CORE_FIELD_REGISTRY.map((entry) => entry.registryKey),
    );
    // Guard the guard: an empty or tiny registry would make this vacuous.
    expect(knownLeaves.size).toBeGreaterThan(100);

    let declaredOperations = 0;
    for (const operationId of LIBRARY_CORE_OPERATION_IDS) {
      const keys =
        LIBRARY_CORE_OPERATION_REGISTRY[operationId].touchedFieldRegistryKeys;
      if (keys === null) continue;
      declaredOperations += 1;

      // A touched-field list is an inventory of real leaves. Without this a
      // typo, a renamed field, or an invented path would pass silently and
      // read as closed coverage it does not have.
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect({ operationId, key, isKnownLeaf: knownLeaves.has(key) })
          .toStrictEqual({ operationId, key, isKnownLeaf: true });
      }
      expect([...keys]).toStrictEqual([...keys].sort(compareCodeUnits));
      expect(new Set(keys).size).toBe(keys.length);
    }

    expect(declaredOperations).toBe(
      Object.values(CLOSED_OPERATION_CONTRACTS).filter(
        (contract) => contract.touchedFieldRegistryKeys !== undefined,
      ).length,
    );
  });

  it("derives the preference written set from the registry, not by hand", () => {
    const keys = PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS;

    // `updatePreferences` deep-merges an arbitrary partial, so the written set
    // is every synchronized preference leaf. Both halves are asserted: nothing
    // synchronized is missing, and nothing device-local sneaks in.
    const synchronized = LIBRARY_CORE_FIELD_REGISTRY.filter(
      (entry) =>
        entry.registryKey.startsWith("library-core-v1:preferences.") &&
        entry.currentLocality === "legacy-synchronized",
    ).map((entry) => entry.registryKey);
    expect([...keys].sort(compareCodeUnits)).toStrictEqual(
      synchronized.sort(compareCodeUnits),
    );

    // Guard the guard. A filter that matched nothing would satisfy the equality
    // above against an equally empty expectation.
    expect(keys.length).toBeGreaterThan(30);

    const nonSynchronized = new Set(
      LIBRARY_CORE_FIELD_REGISTRY.filter(
        (entry) =>
          entry.registryKey.startsWith("library-core-v1:preferences.") &&
          entry.currentLocality !== "legacy-synchronized",
      ).map((entry) => entry.registryKey),
    );
    expect(nonSynchronized.size).toBeGreaterThan(10);
    for (const key of keys) {
      expect(nonSynchronized.has(key)).toBe(false);
    }

    // The device-local leaves whose leaking would be most visible, named so the
    // exclusion is not merely a count.
    for (const excluded of [
      "library-core-v1:preferences.ai.ollamaUrl",
      "library-core-v1:preferences.display.themeId",
    ]) {
      expect(nonSynchronized.has(excluded)).toBe(true);
      expect(keys).not.toContain(excluded);
    }
  });

  it("keeps the rss feed written sets faithful to their mutators", () => {
    // `renameFeed` sends only `{ title }`. The operation is a title
    // assignment, so declaring the whole feed surface would overstate it.
    expect([...RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS])
      .toStrictEqual([LIBRARY_CORE_RSS_FEED_TITLE_FIELD_REGISTRY_KEY]);

    // The upsert union is broader and must contain the title, since
    // `updateRssFeed` and the batch refresh both write it.
    expect(RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS).toContain(
      LIBRARY_CORE_RSS_FEED_TITLE_FIELD_REGISTRY_KEY,
    );
    expect(RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS.length).toBeGreaterThan(
      RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS.length,
    );

    // Neither set may contain a device-local or compatibility feed leaf. These
    // four are a feed's local fetch state; replicating them would turn one
    // machine's network trouble into every device's.
    for (const excluded of [
      "library-core-v1:rssFeeds.{url}.consecutiveFailures",
      "library-core-v1:rssFeeds.{url}.lastFetchError",
      "library-core-v1:rssFeeds.{url}.lastFetchAttemptedAt",
      "library-core-v1:rssFeeds.{url}.nextFetchAfter",
      "library-core-v1:rssFeeds.{url}.etag",
      "library-core-v1:rssFeeds.{url}.lastModified",
    ]) {
      expect(
        LIBRARY_CORE_FIELD_REGISTRY.some(
          (entry) => entry.registryKey === excluded,
        ),
      ).toBe(true);
      expect(RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS).not.toContain(excluded);
      expect(RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS).not.toContain(
        excluded,
      );
    }
  });

  it("keeps saved and archived written-leaf sets faithful to the legacy mutators", () => {
    // `toggleArchived` writes only archive state; it reads `saved` as a
    // precondition and must not claim to write it.
    expect([...FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS])
      .toStrictEqual([
        LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY,
        LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY,
      ]);
    expect(FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS).not.toContain(
      LIBRARY_CORE_FEED_ITEM_SAVED_FIELD_REGISTRY_KEY,
    );

    // `toggleSaved` clears archive state on the save path, so it genuinely
    // writes all four leaves. Omitting the archive pair would hide the
    // coupling that keeps the algebra unresolved.
    expect([...FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS])
      .toStrictEqual([
        LIBRARY_CORE_FEED_ITEM_ARCHIVED_FIELD_REGISTRY_KEY,
        LIBRARY_CORE_FEED_ITEM_ARCHIVED_AT_FIELD_REGISTRY_KEY,
        LIBRARY_CORE_FEED_ITEM_SAVED_FIELD_REGISTRY_KEY,
        LIBRARY_CORE_FEED_ITEM_SAVED_AT_FIELD_REGISTRY_KEY,
      ]);

    // The coupling is the whole reason both stay blocked. If either ever
    // declares an algebra, that claim must be reviewed, not inherited.
    for (const operationId of [
      "feed_item_archive_assignment",
      "feed_item_saved_assignment",
    ] as const) {
      const definition = LIBRARY_CORE_OPERATION_REGISTRY[operationId];
      expect(definition.fieldAlgebra).toBeNull();
      expect(definition.blockers).toContain("field_algebra_unresolved");
      expect(definition.payloadSchema).toBeNull();
      expect(definition.transactionMemberSchema).toBeNull();
    }
    expect(FEED_ITEM_SAVED_ARCHIVED_EXCLUSION_INVARIANT).toBe(
      "an item is never simultaneously saved and archived",
    );
  });

  it("keeps frozen membership, provider intent, and execution receipts unresolved", () => {
    for (const operationId of LIBRARY_CORE_OPERATION_IDS.filter((id) =>
      id.includes("_frozen"),
    )) {
      expect(
        LIBRARY_CORE_OPERATION_REGISTRY[operationId].blockers,
      ).toContain("frozen_bulk_contract_unresolved");
    }

    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.feed_item_like_assignment.blockers,
    ).toContain("provider_intent_separation_unresolved");
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.feed_item_read_assignment.blockers,
    ).toContain("provider_intent_separation_unresolved");
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.feed_items_read_frozen.blockers,
    ).toContain("provider_intent_separation_unresolved");
    expect(LIBRARY_CORE_OPERATION_REGISTRY.provider_intent.blockers).toContain(
      "provider_intent_execution_receipt_unresolved",
    );
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.provider_intent.candidateStoreSurfaces,
    ).toStrictEqual([
      "markAllAsRead",
      "markAsRead",
      "markItemsAsRead",
      "toggleLiked",
    ]);

    for (const operationId of [
      "feed_item_like_sync_receipt",
      "feed_item_seen_sync_receipt",
    ] as const) {
      const definition = LIBRARY_CORE_OPERATION_REGISTRY[operationId];
      expect(definition.intendedAuthority).toBe(
        "provider_action_executor_receipt",
      );
      expect(definition.blockers).toContain(
        "provider_action_lifecycle_contract_unresolved",
      );
    }
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.feed_item_capture_upsert,
    ).toMatchObject({
      intendedAuthority: "capture_ingest",
      blockers: expect.arrayContaining([
        "capture_source_authority_unresolved",
      ]),
    });
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.feed_items_deduplicate_frozen,
    ).toMatchObject({
      candidateStoreSurfaces: ["addItems"],
      legacyWorkerRequests: [
        "ADD_FEED_ITEMS",
        "BATCH_REFRESH_FEEDS",
        "DEDUPLICATE_ITEMS",
      ],
    });

    for (const operationId of [
      "feed_items_deduplicate_frozen",
      "rss_feeds_heal_untitled_frozen",
    ] as const) {
      expect(
        LIBRARY_CORE_OPERATION_REGISTRY[operationId].blockers,
      ).toContain("frozen_bulk_contract_unresolved");
    }
  });

  it("names each destructive relationship cascade instead of hiding it behind a boolean", () => {
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.rss_feed_remove_keep_items
        .relationshipEffects,
    ).toStrictEqual([]);
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.rss_feed_remove_with_items
        .relationshipEffects,
    ).toStrictEqual(["delete_feed_items_for_feed"]);
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.rss_feeds_remove_keep_items
        .relationshipEffects,
    ).toStrictEqual([]);
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.rss_feeds_remove_with_items
        .relationshipEffects,
    ).toStrictEqual(["delete_all_feed_items"]);
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.person_remove_detach_accounts
        .relationshipEffects,
    ).toStrictEqual(["detach_accounts_from_person"]);
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.person_remove_detach_accounts.blockers,
    ).toContain("frozen_bulk_contract_unresolved");
    expect(
      LIBRARY_CORE_OPERATION_REGISTRY.person_remove_and_accounts
        .relationshipEffects,
    ).toStrictEqual(["delete_accounts_linked_to_person"]);
  });
});

describe("Library Core query registry", () => {
  it("has one stable, sorted definition for every query census ID", () => {
    expect([...LIBRARY_CORE_QUERY_IDS]).toStrictEqual(
      [...LIBRARY_CORE_QUERY_IDS].sort(),
    );
    expect(Object.keys(LIBRARY_CORE_QUERY_REGISTRY)).toStrictEqual([
      ...LIBRARY_CORE_QUERY_IDS,
    ]);
    expect(new Set(LIBRARY_CORE_QUERY_IDS).size).toBe(
      LIBRARY_CORE_QUERY_IDS.length,
    );
  });

  it("keeps every intended query blocked on its unresolved executable contract", () => {
    for (const definition of Object.values(LIBRARY_CORE_QUERY_REGISTRY)) {
      if (definition.status !== "planned_blocked") continue;

      for (const [field, blocker] of [
        ["requestSchema", "request_schema_unresolved"],
        ["responseSchema", "response_schema_unresolved"],
        ["projection", "projection_unresolved"],
        ["sourceIdentity", "source_identity_unresolved"],
        ["nestedBounds", "nested_bounds_unresolved"],
        ["stableSort", "sort_contract_unresolved"],
        ["tieBreakKey", "sort_contract_unresolved"],
      ] as const) {
        expect(
          definition[field] === null,
          `${field} must move with ${blocker}`,
        ).toBe(definition.blockers.includes(blocker));
      }
      expect(definition.intendedAdapters.length).toBeGreaterThan(0);
      expect(definition.blockers.length).toBeGreaterThan(0);
      if (
        definition === LIBRARY_CORE_QUERY_REGISTRY.background_item_page_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.library_facet_summary_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v2 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v3 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1 ||
        definition === LIBRARY_CORE_QUERY_REGISTRY.saved_feed_page_v1
      ) {
        expect(definition.blockers).not.toContain(
          "runtime_adapter_unimplemented",
        );
      } else {
        expect(definition.blockers).toContain(
          "runtime_adapter_unimplemented",
        );
      }
      expect("supportedAdapters" in definition).toBe(false);

      expect(definition.defaultLimit).toBeGreaterThan(0);
      expect(definition.defaultLimit).toBeLessThanOrEqual(
        definition.maximumLimit,
      );
      expect(definition.maximumLimit).toBeLessThanOrEqual(
        definition.maximumRows,
      );
      expect(definition.maximumResponseBytes).toBeGreaterThan(0);
      expect(definition.cancellation.required).toBe(true);
      expect(definition.cancellation.identitySchema).toBeNull();
    }
  });

  it("records both dormant feed runtimes without claiming a product adapter", () => {
    const definition = LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1;
    expect(definition).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "ProjectionReadSession::feed_page",
          "read_library_core_feed_page",
          "PwaLibraryCoreFeedReaderRuntime.readFeedPage",
          "READ_LIBRARY_CORE_FEED_PAGE",
        ],
      },
      requestSchema: LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_FEED_PAGE_PROJECTION,
      sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
      defaultLimit: 64,
      maximumLimit: 128,
      maximumRows: 128,
      maximumResponseBytes: 2 * 1_048_576,
      blockers: ["adapter_proof_missing"],
    });
    expect(definition.blockers).not.toEqual(
      expect.arrayContaining([
        "request_schema_unresolved",
        "response_schema_unresolved",
        "projection_unresolved",
        "source_identity_unresolved",
        "nested_bounds_unresolved",
        "sort_contract_unresolved",
      ]),
    );
    expect("supportedAdapters" in definition).toBe(false);
  });

  it("registers the active bounded Desktop Saved aggregate", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "ProjectionReadSession::saved_analytics",
          "read_library_core_saved_analytics",
        ],
      },
      defaultLimit: 1,
      maximumLimit: 1,
      maximumRows: 1,
      maximumResponseBytes: 8 * 1_048_576,
      totalCountIntent: "exact",
    });
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1.blockers,
    ).not.toContain("runtime_adapter_unimplemented");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.items.successorQueryIds,
    ).toContain("saved_analytics_v1");
  });

  it("registers the active bounded Desktop Friends readers", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "ProjectionReadSession::friends_graph_activity",
          "read_library_core_persons_graph",
        ],
      },
      defaultLimit: 1_000,
      maximumLimit: 5_000,
      maximumRows: 5_000,
      maximumResponseBytes: 8 * 1_048_576,
      totalCountIntent: "snapshot_exact",
    });
    expect(LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "ProjectionReadSession::person_timeline",
          "read_library_core_person_timeline",
        ],
      },
      defaultLimit: 50,
      maximumLimit: 100,
      maximumRows: 100,
      maximumResponseBytes: 2 * 1_048_576,
      totalCountIntent: "snapshot_exact",
    });
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1.blockers,
    ).not.toContain("runtime_adapter_unimplemented");
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1.blockers,
    ).not.toContain("runtime_adapter_unimplemented");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.items.successorQueryIds,
    ).toEqual(expect.arrayContaining(["persons_graph_v1", "person_timeline_v1"]));
  });

  it("registers the active bounded Desktop Friends feed", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v2).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "read_library_core_feed_browse_page",
          "openBoundedDesktopFriendsFeedReader",
        ],
      },
      requestSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_PROJECTION,
      sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
      defaultLimit: 64,
      maximumLimit: 128,
      maximumRows: 128,
      maximumResponseBytes: 2 * 1_048_576,
      totalCountIntent: "snapshot_exact",
    });
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v2.blockers,
    ).not.toContain("runtime_adapter_unimplemented");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.items.successorQueryIds,
    ).toContain("feed_browse_page_v2");
  });

  it("closes five facet-summary fields and blocks the sort on UTF-16 collation", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.library_facet_summary_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_FACET_SUMMARY_PROJECTION,
      sourceIdentity: LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS,
    });
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.library_facet_summary_v1.blockers,
      ).not.toContain(blocker);
    }
    // Tags sort by UTF-16 code units for JavaScript parity. The contract type
    // admits only binary UTF-8 collation, and the two disagree outside the BMP,
    // so declaring one would misdescribe the order rather than record it.
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.library_facet_summary_v1.stableSort,
    ).toBeNull();
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.library_facet_summary_v1.blockers,
    ).toContain("sort_contract_unresolved");
    expect(LIBRARY_CORE_FACET_SUMMARY_TAG_ORDER.textCollation).toBe(
      "utf16_code_unit",
    );
  });

  it("closes five surface-items fields and blocks the sort on the Map defect", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_SURFACE_ITEMS_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_SURFACE_ITEMS_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_SURFACE_ITEMS_PROJECTION,
      sourceIdentity: LIBRARY_CORE_SURFACE_ITEMS_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_SURFACE_ITEMS_NESTED_BOUNDS,
      fullContentAllowed: true,
    });
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1.blockers,
      ).not.toContain(blocker);
    }
    // Same row as the item lookup and the bounded scan, shared by reference.
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1.projection,
    ).toBe(LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.projection);
    // A declared sort asserts index-satisfiability. The Map surface needs a
    // temp B-tree, so the blocker stays open until issue #1323 lands.
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1.stableSort,
    ).toBeNull();
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.library_surface_items_v1.blockers,
    ).toContain("sort_contract_unresolved");
    expect(
      LIBRARY_CORE_SURFACE_ITEMS_INTENDED_ORDER.indexSatisfiedBySurface,
    ).toEqual({ map: false, story_wall: true });
  });

  it("closes the bounded item-scan contract and shares the item-detail row", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.background_item_page_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_ITEM_SCAN_PROJECTION,
      sourceIdentity: LIBRARY_CORE_ITEM_SCAN_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_ITEM_SCAN_NESTED_BOUNDS,
      tieBreakKey: "globalId",
      fullContentAllowed: true,
    });
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
      "sort_contract_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.background_item_page_v1.blockers,
      ).not.toContain(blocker);
    }
    // ITEM_SCAN_COLUMNS is byte-identical to the item_detail SELECT, so the two
    // must share one projection. If either grows a column, both move together.
    expect(LIBRARY_CORE_QUERY_REGISTRY.background_item_page_v1.projection).toBe(
      LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.projection,
    );
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.background_item_page_v1.stableSort,
    ).toEqual(LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.stableSort);
  });

  it("closes the item-detail contract and records that it carries full content", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
      sourceIdentity: LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
      tieBreakKey: "globalId",
    });
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
      "sort_contract_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.blockers,
      ).not.toContain(blocker);
    }
    // The lookup selects contentBlob and preservedBlob, so it really does carry
    // full reader content and its ceiling is 8 MiB rather than the ordinary
    // 2 MiB this entry previously defaulted to.
    expect(LIBRARY_CORE_ITEM_DETAIL_PROJECTION.fullContentAllowed).toBe(true);
    // Assert the registry entry itself, not just the contract constant.
    expect(LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.fullContentAllowed).toBe(
      true,
    );
    expect(LIBRARY_CORE_QUERY_REGISTRY.item_detail_v1.maximumResponseBytes).toBe(
      8 * 1_048_576,
    );
  });

  it("closes five persons-graph contract fields and keeps the sort blocked", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_PERSONS_GRAPH_PROJECTION,
      sourceIdentity: LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS,
    });
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1.blockers,
      ).not.toContain(blocker);
    }
    // The response carries two independently keyed series, which the single
    // column list of ResolvedQuerySortContract cannot express. Leaving a
    // half-true sort here would be worse than leaving the blocker open.
    expect(LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1.stableSort).toBeNull();
    expect(LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1.tieBreakKey).toBeNull();
    expect(LIBRARY_CORE_QUERY_REGISTRY.persons_graph_v1.blockers).toContain(
      "sort_contract_unresolved",
    );
    // The real orderings are still recorded so later work need not re-derive.
    expect(LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER.social.columns).toEqual([
      "platform",
      "authorId",
    ]);
    expect(LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER.rss.columns).toEqual([
      "feedUrl",
    ]);
  });

  it("closes the person-timeline page contract", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_PERSON_TIMELINE_PROJECTION,
      sourceIdentity: LIBRARY_CORE_PERSON_TIMELINE_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_PERSON_TIMELINE_NESTED_BOUNDS,
      tieBreakKey: "globalId",
    });
    // The timeline pages the same shadow rows as the ordinary feed page, so its
    // order must be identical rather than a parallel copy that could drift.
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1.stableSort,
    ).toEqual(LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1.stableSort);
    expect(LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1.projection).toBe(
      LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1.projection,
    );
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
      "sort_contract_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.person_timeline_v1.blockers,
      ).not.toContain(blocker);
    }
  });

  it("closes the Saved-analytics aggregate contract", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1).toMatchObject({
      status: "planned_blocked",
      requestSchema: LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA,
      projection: LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION,
      sourceIdentity: LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS,
      tieBreakKey: "label",
    });
    // Both count series are built from a label-keyed BTreeMap, so the only
    // ordering term is the label itself and it is also the tie-break.
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1.stableSort,
    ).toEqual({
      columns: [{ column: "label", direction: "asc" }],
      textCollation: "binary",
      nullOrdering: "all_sort_columns_not_null",
    });
    // Closing the six contract fields must clear their paired blockers.
    for (const blocker of [
      "request_schema_unresolved",
      "response_schema_unresolved",
      "projection_unresolved",
      "source_identity_unresolved",
      "nested_bounds_unresolved",
      "sort_contract_unresolved",
    ]) {
      expect(
        LIBRARY_CORE_QUERY_REGISTRY.saved_analytics_v1.blockers,
      ).not.toContain(blocker);
    }
  });

  it("registers the bidirectional bounded Desktop all-content feed", () => {
    expect(LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v3).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "read_library_core_feed_browse_page",
          "openBoundedDesktopFeedReader",
        ],
      },
      requestSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_REQUEST_SCHEMA,
      responseSchema: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_RESPONSE_SCHEMA,
      sourceIdentity: LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
      nestedBounds: LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
      defaultLimit: 64,
      maximumLimit: 128,
      maximumRows: 128,
      maximumResponseBytes: 2 * 1_048_576,
      totalCountIntent: "snapshot_exact",
    });
    // Backward paging must not introduce a second ordering.
    expect(LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v3.stableSort).toEqual(
      LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v1.stableSort,
    );
    expect(
      LIBRARY_CORE_QUERY_REGISTRY.feed_browse_page_v3.blockers,
    ).not.toContain("runtime_adapter_unimplemented");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.items.successorQueryIds,
    ).toContain("feed_browse_page_v3");
  });

  it("uses shared renderer and interactive snapshot pools instead of additive query reservations", () => {
    expect(LIBRARY_CORE_RENDERER_CACHE_POOL).toMatchObject({
      settledMaximumBytes: 48 * 1_048_576,
      burstMaximumBytes: 64 * 1_048_576,
      eviction: "cross_query_lru",
      perQueryReservations: false,
    });
    expect(LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL).toMatchObject({
      maximumAgeMs: 60_000,
      maximumPinnedBytesAcrossQueries: 16 * 1_048_576,
      expiryResult: "CURSOR_STALE",
    });

    for (const definition of Object.values(LIBRARY_CORE_QUERY_REGISTRY)) {
      if (definition.status !== "planned_blocked") continue;
      if (definition.rendererCachePool !== null) {
        expect(definition.rendererCachePool).toBe(
          LIBRARY_CORE_RENDERER_CACHE_POOL.id,
        );
      }
      expect("rendererCacheBytes" in definition).toBe(false);

      if (definition.cursor.kind === "interactive") {
        expect(definition.cursor.snapshotPool).toBe(
          LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL.id,
        );
      }
    }
  });

  it("requires a durable checkpoint for export enumeration", () => {
    const definition =
      LIBRARY_CORE_QUERY_REGISTRY.export_enumeration_v1;
    expect(definition.cursor).toStrictEqual({
      kind: "durable_checkpoint",
      version: 1,
      opaque: true,
      checkpointSchema: null,
    });
    expect(definition.blockers).toContain(
      "durable_checkpoint_contract_unresolved",
    );
  });

  it("keeps every current unbounded request, response, and direct-document read blocked", () => {
    const currentKinds = new Set<string>();
    for (const definition of Object.values(LIBRARY_CORE_QUERY_REGISTRY)) {
      if (definition.status !== "legacy_unbounded") continue;
      expect(definition.activationBlocker).toBeTruthy();
      expect(definition.consumers.length).toBeGreaterThan(0);
      definition.source.currentKinds.forEach((kind) => currentKinds.add(kind));
    }

    for (const kind of [
      "ALL_ITEM_IDS",
      "BROADCAST_REQUEST",
      "COMPARE_DOC",
      "DOC_BINARY",
      "DOC_HEADS",
      "DOC_RELATIONSHIP",
      "FEEDS_PATCH",
      "GET_ALL_ITEM_IDS",
      "GET_DOC_BINARY",
      "GET_HEADS",
      "GET_ITEM_LEGACY_HTML",
      "GET_ITEM_PRESERVED_TEXT",
      "GET_SAVED_YOUTUBE_URLS",
      "ITEM_LEGACY_HTML",
      "ITEM_PATCH",
      "ITEM_PRESERVED_TEXT",
      "PREFERENCES_PATCH",
      "SAVED_YOUTUBE_URLS",
      "STATE_UPDATE",
    ]) {
      expect(currentKinds.has(kind), kind).toBe(true);
    }
  });
});

describe("BaseAppState surface registry", () => {
  it("maps every deprecated Friend surface to its canonical Person successor", () => {
    expect(BASE_APP_STORE_SURFACE_REGISTRY.friends.deprecatedAliasFor).toBe(
      "persons",
    );
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.selectedFriendId.deprecatedAliasFor,
    ).toBe("selectedPersonId");
    expect(BASE_APP_STORE_SURFACE_REGISTRY.addFriend.deprecatedAliasFor).toBe(
      "addPerson",
    );
    expect(BASE_APP_STORE_SURFACE_REGISTRY.addFriends.deprecatedAliasFor).toBe(
      "addPersons",
    );
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.updateFriend.deprecatedAliasFor,
    ).toBe("updatePerson");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.removeFriend.deprecatedAliasFor,
    ).toBe("removePerson");
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.setSelectedFriend.deprecatedAliasFor,
    ).toBe("setSelectedPerson");
  });

  it("marks current full-corpus renderer state and generic authority methods as blockers", () => {
    for (const key of [
      "items",
      "feeds",
      "persons",
      "accounts",
      "preferences",
      "friends",
    ] as const) {
      expect(BASE_APP_STORE_SURFACE_REGISTRY[key].classification).toBe(
        "legacy_unbounded",
      );
      expect(BASE_APP_STORE_SURFACE_REGISTRY[key].activationBlocker).toBeTruthy();
    }
    expect(BASE_APP_STORE_SURFACE_REGISTRY.initialize).toMatchObject({
      classification: "legacy_unbounded",
      activationBlocker: expect.stringContaining("complete legacy document"),
    });

    for (const key of [
      "toggleArchived",
      "toggleLiked",
      "toggleSaved",
      "updateAccount",
      "updateItem",
      "updatePerson",
      "updatePreferences",
    ] as const) {
      expect(BASE_APP_STORE_SURFACE_REGISTRY[key].classification).toBe(
        "legacy_compatibility",
      );
      expect(BASE_APP_STORE_SURFACE_REGISTRY[key].activationBlocker).toBeTruthy();
    }
  });

  it("never leaves a legacy classification without a concrete activation blocker", () => {
    for (const definition of Object.values(
      BASE_APP_STORE_SURFACE_REGISTRY,
    )) {
      if (
        definition.classification === "legacy_compatibility" ||
        definition.classification === "legacy_unbounded"
      ) {
        expect(definition.activationBlocker).toBeTruthy();
      }
    }
  });

  it("keeps store successors and operation candidate surfaces bidirectional", () => {
    const storeRegistry: Record<
      string,
      { readonly successorOperationIds: readonly string[] }
    > = BASE_APP_STORE_SURFACE_REGISTRY;
    const operationRegistry: Record<
      string,
      { readonly candidateStoreSurfaces: readonly string[] }
    > = LIBRARY_CORE_OPERATION_REGISTRY;

    for (const [surfaceKey, definition] of Object.entries(storeRegistry)) {
      for (const operationId of definition.successorOperationIds) {
        expect(
          operationRegistry[operationId]?.candidateStoreSurfaces,
          `${surfaceKey} -> ${operationId}`,
        ).toContain(surfaceKey);
      }
    }

    for (const [operationId, definition] of Object.entries(
      operationRegistry,
    )) {
      for (const surfaceKey of definition.candidateStoreSurfaces) {
        expect(
          storeRegistry[surfaceKey]?.successorOperationIds,
          `${operationId} -> ${surfaceKey}`,
        ).toContain(operationId);
      }
    }

    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.toggleLiked.successorOperationIds,
    ).toStrictEqual(["feed_item_like_assignment", "provider_intent"]);
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.addItems.successorOperationIds,
    ).toStrictEqual([
      "feed_item_capture_upsert",
      "feed_items_deduplicate_frozen",
    ]);
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.updateFriend.successorOperationIds,
    ).toStrictEqual(["account_remove", "account_upsert", "person_upsert"]);
    expect(
      BASE_APP_STORE_SURFACE_REGISTRY.updateAccount.successorOperationIds,
    ).toStrictEqual(["account_person_assignment", "account_upsert"]);
  });
});
