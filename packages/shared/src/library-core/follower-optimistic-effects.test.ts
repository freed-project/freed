import { describe, expect, it } from "vitest";

import type { LibraryCoreOperationEnvelopeV1 } from "./operation-envelope-finalization.js";
import { libraryCoreOptimisticFieldsForEnvelopeV1 } from "./follower-optimistic-effects.js";

function envelope(
  operationType:
    | "feed_item_archive_assignment"
    | "feed_item_like_assignment"
    | "feed_item_read_assignment"
    | "feed_item_saved_assignment",
  payload: Readonly<Record<string, boolean | number>>,
): LibraryCoreOperationEnvelopeV1 {
  return {
    actor_id: "12".repeat(32),
    actor_sequence: 1,
    actor_chain_digest: "23".repeat(32),
    causal_frontier: [],
    created_at_ms: 42,
    entity_id: "item:1",
    entity_type: "FeedItem",
    epoch: 1,
    epoch_id: "34".repeat(32),
    hlc_counter: 0,
    hlc_wall_ms: 42,
    library_id: "45".repeat(32),
    operation_id: "operation:1",
    operation_type: operationType,
    payload,
    payload_schema_version: 1,
    previous_actor_chain_digest: "56".repeat(32),
    previous_actor_operation_id: null,
    signature: "67".repeat(64),
    transaction_id: "transaction:1",
    transaction_member_count: 1,
    transaction_member_index: 0,
  } as unknown as LibraryCoreOperationEnvelopeV1;
}

describe("follower optimistic effects", () => {
  it("derives saved state and its archive exclusion from the registry", () => {
    expect(
      libraryCoreOptimisticFieldsForEnvelopeV1(
        envelope("feed_item_saved_assignment", {
          assigned: true,
          assigned_at_ms: 1_000,
        }),
      ).map(({ fieldPath, valueType, value }) => ({
        fieldPath,
        valueType,
        value,
      })),
    ).toEqual([
      { fieldPath: "saved", valueType: "boolean", value: true },
      { fieldPath: "saved_at", valueType: "integer", value: 1_000 },
      { fieldPath: "archived", valueType: "boolean", value: false },
      { fieldPath: "archived_at", valueType: "null", value: null },
    ]);
  });

  it("derives read, archive, and like removals without canonical writes", () => {
    expect(
      [
        envelope("feed_item_read_assignment", { read_at_ms: 2_000 }),
        envelope("feed_item_archive_assignment", {
          assigned: false,
          assigned_at_ms: 2_001,
        }),
        envelope("feed_item_like_assignment", {
          assigned: false,
          assigned_at_ms: 2_002,
        }),
      ].flatMap(libraryCoreOptimisticFieldsForEnvelopeV1),
    ).toMatchObject([
      { fieldPath: "read_at", value: 2_000 },
      { fieldPath: "archived", value: false },
      { fieldPath: "archived_at", value: null },
      { fieldPath: "liked", value: false },
      { fieldPath: "liked_at", value: null },
    ]);
  });
});
