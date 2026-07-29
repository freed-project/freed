import { describe, expect, it } from "vitest";
import { LIBRARY_CORE_OPERATION_REGISTRY } from "@freed/shared/library-core";

import {
  DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
  DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY,
  DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY,
} from "./library-core-worker-surface-registry";

describe("Desktop Library Core worker surface census", () => {
  it("keeps every current request and response classified but blocked", () => {
    for (const definition of [
      ...Object.values(DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY),
      ...Object.values(DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY),
    ]) {
      expect(definition.status).toBe("planned_blocked");
      expect(definition.blockers.length).toBeGreaterThan(0);
      expect(definition.blockers).toContain(
        "library_core_runtime_inactive",
      );
    }
  });

  it("does not blur provider intent, corpus reads, or full-state transport into ordinary mutations", () => {
    for (const kind of [
      "MARK_AS_READ",
      "MARK_ITEMS_AS_READ",
      "MARK_ALL_AS_READ",
      "TOGGLE_LIKED",
    ] as const) {
      expect(
        DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("provider_intent_separation_unresolved");
      expect(
        DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("provider_intent_execution_receipt_unresolved");
      expect(
        DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY[kind]
          .successorOperationIds,
        kind,
      ).toContain("provider_intent");
    }
    expect(
      DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY
        .RECONCILE_YOUTUBE_CAPTURE.classification,
    ).toBe("legacy_provider_capture_authority");
    expect(
      DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY.GET_DOC_BINARY
        .classification,
    ).toBe("legacy_unbounded_read");
    expect(
      DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY.STATE_UPDATE
        .classification,
    ).toBe("legacy_full_state_transport");
    expect(
      DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY.ITEM_PATCH
        .classification,
    ).toBe("legacy_patch_transport");
  });

  it("censuses every request effect independently of its classification", () => {
    for (const [kind, effect] of Object.entries(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
    )) {
      if (effect.legacyWriteEffects.length === 0) continue;
      expect(
        effect.successorOperationIds.length > 0 ||
          effect.blockers.length > 0,
        kind,
      ).toBe(true);
    }

    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.CONFIRM_LIKED_SYNCED
        .successorOperationIds,
    ).toStrictEqual(["feed_item_like_sync_receipt"]);
    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.CONFIRM_SEEN_SYNCED
        .successorOperationIds,
    ).toStrictEqual(["feed_item_seen_sync_receipt"]);
    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.HEAL_UNTITLED_FEEDS
        .successorOperationIds,
    ).toStrictEqual(["rss_feeds_heal_untitled_frozen"]);
    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.DEDUPLICATE_ITEMS
        .successorOperationIds,
    ).toStrictEqual(["feed_items_deduplicate_frozen"]);

    for (const kind of ["INIT", "MERGE_DOC", "REPLACE_DOC"] as const) {
      const effect = DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY[kind];
      expect(effect.legacyWriteEffects, kind).toContain(
        "legacy_schema_migration",
      );
      expect(effect.blockers, kind).toContain(
        "hidden_legacy_write_contract_unresolved",
      );
    }

    for (const kind of ["ADD_FEED_ITEMS", "BATCH_REFRESH_FEEDS"] as const) {
      const effect = DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY[kind];
      expect(effect.legacyWriteEffects, kind).toContain(
        "legacy_duplicate_removal",
      );
      expect(effect.successorOperationIds, kind).toContain(
        "feed_items_deduplicate_frozen",
      );
    }
  });

  it("marks arbitrary diagnostic and mutation payload bytes as unbounded", () => {
    for (const kind of [
      "ADD_FEED_ITEM",
      "TOGGLE_LIKED",
      "UPDATE_FEED_ITEM",
      "UPDATE_PREFERENCES",
    ] as const) {
      expect(
        DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("unbounded_payload");
    }
    for (const kind of ["ACK", "DEBUG_EVENT", "DEBUG_SNAPSHOT"] as const) {
      expect(
        DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("unbounded_payload");
    }
  });

  it("classifies the migration projector as bounded without granting runtime authority", () => {
    for (const kind of [
      "BEGIN_LIBRARY_CORE_PROJECTION",
      "NEXT_LIBRARY_CORE_PROJECTION_BATCH",
      "CANCEL_LIBRARY_CORE_PROJECTION",
    ] as const) {
      const definition =
        DESKTOP_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind];
      expect(definition.classification, kind).toBe(
        "bounded_projection_transport",
      );
      expect(definition.blockers, kind).not.toContain("unbounded_payload");
      expect(definition.blockers, kind).toContain(
        "library_core_runtime_inactive",
      );
    }
    expect(
      DESKTOP_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY
        .LIBRARY_CORE_PROJECTION_BATCH.classification,
    ).toBe("bounded_projection_transport");
  });

  it("records non-document runtime writes instead of reporting a false zero", () => {
    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.QUIESCE,
    ).toStrictEqual({
      legacyWriteEffects: ["legacy_runtime_state_write"],
      successorOperationIds: [],
      blockers: ["lifecycle_contract_unresolved"],
    });
    expect(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY.UPDATE_RELAY_CLIENT_COUNT,
    ).toStrictEqual({
      legacyWriteEffects: ["legacy_runtime_state_write"],
      successorOperationIds: [],
      blockers: ["lifecycle_contract_unresolved"],
    });
  });

  it("keeps every successor operation linked back to its current request", () => {
    for (const [kind, effect] of Object.entries(
      DESKTOP_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
    )) {
      for (const operationId of effect.successorOperationIds) {
        expect(
          LIBRARY_CORE_OPERATION_REGISTRY[operationId].legacyWorkerRequests,
          `${kind} -> ${operationId}`,
        ).toContain(kind);
      }
    }
  });
});
