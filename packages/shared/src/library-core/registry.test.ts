import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
} from "./feed-page-contracts.js";
import {
  LIBRARY_CORE_FIELD_REGISTRY,
} from "./field-registry.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
} from "./operation-envelope-contracts.js";
import {
  FEED_ITEM_READ_AT_FIELD_ALGEBRA,
  LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
} from "./operation-field-algebra-contracts.js";
import {
  LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES,
  LIBRARY_CORE_MAX_TRANSACTION_MEMBERS,
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_OPERATION_REGISTRY,
} from "./operation-registry.js";
import { LIBRARY_CORE_ENTITY_ID_CODEC_V1 } from "./protocol-scalars.js";
import {
  LIBRARY_CORE_INTERACTIVE_SNAPSHOT_POOL,
  LIBRARY_CORE_QUERY_IDS,
  LIBRARY_CORE_QUERY_REGISTRY,
  LIBRARY_CORE_RENDERER_CACHE_POOL,
} from "./query-registry.js";
import { BASE_APP_STORE_SURFACE_REGISTRY } from "./store-surface-registry.js";

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
    for (const [operationId, definition] of Object.entries(
      LIBRARY_CORE_OPERATION_REGISTRY,
    )) {
      expect(definition.status).toBe("planned_blocked");
      if (operationId === "feed_item_read_assignment") {
        expect(definition.payloadSchema).toMatchObject({
          schemaId: "feed_item_read_assignment_payload_v1",
          schemaVersion: 1,
          operationType: "feed_item_read_assignment",
          canonicalKeys: ["read_at_ms"],
        });
        expect(definition.blockers).not.toContain("payload_schema_unresolved");
        expect(definition.entityIdCodec).toBe(
          LIBRARY_CORE_ENTITY_ID_CODEC_V1,
        );
        expect(definition.blockers).not.toContain(
          "entity_id_schema_unresolved",
        );
        expect(definition.touchedFieldRegistryKeys).toStrictEqual([
          LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
        ]);
        expect(definition.blockers).not.toContain("touched_fields_unresolved");
        expect(definition.fieldAlgebra).toBe(
          FEED_ITEM_READ_AT_FIELD_ALGEBRA,
        );
        expect(definition.blockers).not.toContain("field_algebra_unresolved");
        expect(definition.transactionMemberSchema).toBe(
          FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
        );
        expect(definition.blockers).not.toContain(
          "transaction_member_schema_unresolved",
        );
      } else {
        expect(definition.payloadSchema).toBeNull();
        expect(definition.blockers).toContain("payload_schema_unresolved");
        expect(definition.entityIdCodec).toBeNull();
        expect(definition.blockers).toContain(
          "entity_id_schema_unresolved",
        );
        expect(definition.touchedFieldRegistryKeys).toBeNull();
        expect(definition.blockers).toContain("touched_fields_unresolved");
        expect(definition.fieldAlgebra).toBeNull();
        expect(definition.blockers).toContain("field_algebra_unresolved");
        expect(definition.transactionMemberSchema).toBeNull();
        expect(definition.blockers).toContain(
          "transaction_member_schema_unresolved",
        );
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
      expect(definition.blockers).toContain("runtime_adapter_unimplemented");
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

  it("records the dormant Desktop feed runtime without claiming a product adapter", () => {
    const definition = LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1;
    expect(definition).toMatchObject({
      status: "planned_blocked",
      source: {
        boundary: "library_core",
        currentKinds: [
          "ProjectionReadSession::feed_page",
          "read_library_core_feed_page",
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
      blockers: ["adapter_proof_missing", "runtime_adapter_unimplemented"],
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
