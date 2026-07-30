import { describe, expect, it } from "vitest";
import { LIBRARY_CORE_OPERATION_REGISTRY } from "@freed/shared/library-core";

import {
  PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
  PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY,
  PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY,
} from "./library-core-worker-surface-registry";

describe("PWA Library Core worker surface census", () => {
  it("keeps every current request and response classified but blocked", () => {
    for (const definition of [
      ...Object.values(PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY),
      ...Object.values(PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY),
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
        PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("provider_intent_separation_unresolved");
      expect(
        PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("provider_intent_execution_receipt_unresolved");
      expect(
        PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY[kind]
          .successorOperationIds,
        kind,
      ).toContain("provider_intent");
    }
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY.GET_COMMITTED_DOC
        .classification,
    ).toBe("legacy_unbounded_read");
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY.GET_DOC_BINARY
        .classification,
    ).toBe("legacy_unbounded_read");
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY.MERGE_DOC.classification,
    ).toBe("legacy_replication_authority");
    expect(
      PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY.COMMITTED_DOC
        .classification,
    ).toBe("legacy_unbounded_transport");
    expect(
      PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY.STATE_UPDATE
        .classification,
    ).toBe("legacy_full_state_transport");
  });

  it("censuses every request effect independently of its classification", () => {
    for (const [kind, effect] of Object.entries(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
    )) {
      if (
        effect.legacyWriteEffects.length === 0 &&
        effect.libraryCoreWriteEffects.length === 0
      ) {
        continue;
      }
      expect(
        effect.successorOperationIds.length > 0 ||
          effect.blockers.length > 0,
        kind,
      ).toBe(true);
    }

    expect(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY.CONFIRM_LIKED_SYNCED
        .successorOperationIds,
    ).toStrictEqual(["feed_item_like_sync_receipt"]);
    expect(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY.CONFIRM_SEEN_SYNCED
        .successorOperationIds,
    ).toStrictEqual(["feed_item_seen_sync_receipt"]);

    for (const kind of ["INIT", "MERGE_DOC"] as const) {
      const effect = PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY[kind];
      expect(effect.legacyWriteEffects, kind).toContain(
        "legacy_schema_migration",
      );
      expect(effect.legacyWriteEffects, kind).toContain(
        "legacy_document_broadcast",
      );
      expect(effect.blockers, kind).toContain(
        "hidden_legacy_write_contract_unresolved",
      );
    }
  });

  it("marks arbitrary diagnostic and mutation payload bytes as unbounded", () => {
    for (const kind of [
      "ADD_FEED_ITEM",
      "ADD_STUB_ITEM",
      "TOGGLE_LIKED",
      "UPDATE_PREFERENCES",
    ] as const) {
      expect(
        PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("unbounded_payload");
    }
    for (const kind of ["ACK", "DEBUG_EVENT", "DEBUG_SNAPSHOT"] as const) {
      expect(
        PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY[kind].blockers,
        kind,
      ).toContain("unbounded_payload");
    }
  });

  it("records quiesce as an explicit runtime-state write", () => {
    expect(PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY.QUIESCE).toStrictEqual({
      legacyWriteEffects: ["legacy_runtime_state_write"],
      libraryCoreWriteEffects: [],
      successorOperationIds: [],
      blockers: ["lifecycle_contract_unresolved"],
    });
  });

  it("keeps the dormant Library Core feed transport bounded and read-only", () => {
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY
        .MATERIALIZE_LIBRARY_CORE_FEED_GENERATION,
    ).toStrictEqual({
      status: "planned_blocked",
      classification: "library_core_local_projection",
      blockers: [
        "library_core_runtime_inactive",
        "response_transport_not_cut_over",
      ],
    });
    expect(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY
        .MATERIALIZE_LIBRARY_CORE_FEED_GENERATION,
    ).toStrictEqual({
      legacyWriteEffects: [],
      libraryCoreWriteEffects: [
        "library_core_projection_generation_write",
      ],
      successorOperationIds: [],
      blockers: ["response_transport_not_cut_over"],
    });
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY
        .READ_LIBRARY_CORE_FEED_PAGE,
    ).toStrictEqual({
      status: "planned_blocked",
      classification: "library_core_bounded_read",
      blockers: [
        "library_core_runtime_inactive",
        "response_transport_not_cut_over",
      ],
    });
    expect(
      PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY
        .CANCEL_LIBRARY_CORE_FEED_READER.classification,
    ).toBe("library_core_lifecycle_control");
    expect(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY
        .READ_LIBRARY_CORE_FEED_PAGE,
    ).toStrictEqual({
      legacyWriteEffects: [],
      libraryCoreWriteEffects: [],
      successorOperationIds: [],
      blockers: [],
    });
    expect(
      PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY
        .LIBRARY_CORE_FEED_PAGE_RESULT.classification,
    ).toBe("library_core_bounded_transport");
    expect(
      PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY
        .LIBRARY_CORE_FEED_GENERATION_RESULT.classification,
    ).toBe("library_core_bounded_transport");
  });

  it("keeps every successor operation linked back to its current request", () => {
    for (const [kind, effect] of Object.entries(
      PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY,
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
