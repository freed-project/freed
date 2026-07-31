import { describe, expect, it } from "vitest";
import {
  LibraryCorePortableCheckpointStreamVerifierV1,
  parseLibraryCorePortableCheckpointRecordV1,
  type LibraryCorePortableCheckpointCollection,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
} from "./portable-checkpoint-contracts.js";

const hex = (pair: string): string => pair.repeat(32);

function header(
  counts: Partial<Record<LibraryCorePortableCheckpointCollection, number>>,
): LibraryCorePortableCheckpointHeaderV1 {
  const parsed = parseLibraryCorePortableCheckpointRecordV1({
    anchor_kind: "accepted_authority",
    canonical_codec_version: 1,
    collection_counts: {
      accepted_frontier: 0,
      actor_states: 0,
      blob_roots: 0,
      excluded_registry_keys: 0,
      field_clocks: 0,
      materialized_rows: 0,
      quarantined_frontier: 0,
      receipt_records: 0,
      relationships: 0,
      tombstones: 0,
      ...counts,
    },
    epoch: 1,
    epoch_id: "epoch-1",
    field_registry_version: 1,
    format: "freed_logical_checkpoint_v1",
    kind: "logical_checkpoint_header",
    library_id: "library-1",
    materializer_position: {
      frontier_digest: hex("aa"),
      ingest_sequence: 0,
      materialized_digest: hex("bb"),
    },
    promoted_receipt_digests: [],
    schema_version: 1,
    source_manifest_digest: hex("cc"),
    source_transition_digest: hex("dd"),
    transition_candidate_anchor: null,
  });
  if (parsed.kind !== "logical_checkpoint_header") {
    throw new TypeError("portable checkpoint test header is invalid");
  }
  return parsed;
}

function entry(
  collection: LibraryCorePortableCheckpointCollection,
  value: LibraryCorePortableCheckpointEntryV1["value"],
  ordinal = 0,
): LibraryCorePortableCheckpointEntryV1 {
  return {
    collection,
    kind: "logical_checkpoint_entry",
    ordinal,
    value,
  };
}

describe("Library Core portable checkpoint record contract", () => {
  it("streams every closed logical collection without retaining the corpus", () => {
    const entries = [
      entry("accepted_frontier", {
        actor_id: hex("01"),
        chain_digest: hex("02"),
        operation_id: "accepted-1",
        sequence: 1,
      }),
      entry("quarantined_frontier", {
        actor_id: hex("03"),
        chain_digest: hex("04"),
        operation_id: "quarantined-1",
        sequence: 1,
      }),
      entry("materialized_rows", {
        primary_key: "item-1",
        registry_key: "feedItems",
        row: { globalId: "item-1", saved: true },
      }),
      entry("field_clocks", {
        actor_id: hex("05"),
        entity_generation: 1,
        field_path: "saved",
        hlc_counter: 0,
        hlc_wall_ms: 10,
        operation_id: "clock-1",
        primary_key: "item-1",
        registry_key: "feedItems",
      }),
      entry("relationships", {
        actor_id: hex("06"),
        entity_generation: 1,
        hlc_counter: 0,
        hlc_wall_ms: 11,
        left_primary_key: "item-1",
        left_registry_key: "feedItems",
        operation_id: "relationship-1",
        relationship_type: "item-author",
        right_primary_key: "author-1",
        right_registry_key: "authors",
        tombstoned: false,
      }),
      entry("tombstones", {
        actor_id: hex("07"),
        entity_generation: 2,
        hlc_counter: 0,
        hlc_wall_ms: 12,
        operation_id: "delete-1",
        primary_key: "item-2",
        registry_key: "feedItems",
      }),
      entry("actor_states", {
        accepted_chain_digest: hex("08"),
        accepted_operation_id: null,
        accepted_sequence: 0,
        actor_id: hex("09"),
        enrollment_certificate_digest: hex("0a"),
        retired: false,
        retirement_certificate_digest: null,
      }),
      entry("receipt_records", {
        authorization: {},
        receipt_body: {},
        receipt_digest: hex("0b"),
        receipt_id: "receipt-1",
        receipt_kind: "actor-enrollment",
      }),
      entry("blob_roots", {
        byte_length: 42,
        content_digest: hex("0c"),
        field_path: "mediaUrls[0]",
        media_type: "image/jpeg",
        primary_key: "item-1",
        registry_key: "feedItems",
      }),
      entry("excluded_registry_keys", "preferences.localOnly"),
    ] as const;
    const verifier = new LibraryCorePortableCheckpointStreamVerifierV1();
    verifier.accept(
      header(
        Object.fromEntries(entries.map(({ collection }) => [collection, 1])),
      ),
    );
    for (const record of entries) verifier.accept(record);
    expect(verifier.finish().recordCount).toBe(11);
  });

  it("orders frontier sequence numbers numerically", () => {
    const verifier = new LibraryCorePortableCheckpointStreamVerifierV1();
    verifier.accept(header({ quarantined_frontier: 2 }));
    for (const [ordinal, sequence] of [2, 10].entries()) {
      verifier.accept(
        entry(
          "quarantined_frontier",
          {
            actor_id: hex("01"),
            chain_digest: hex(sequence === 2 ? "02" : "03"),
            operation_id: `branch-${String(sequence)}`,
            sequence,
          },
          ordinal,
        ),
      );
    }
    expect(verifier.finish().recordCount).toBe(3);
  });

  it("rejects inconsistent actor-state nullability before staging", () => {
    const verifier = new LibraryCorePortableCheckpointStreamVerifierV1();
    verifier.accept(header({ actor_states: 1 }));
    expect(() =>
      verifier.accept(
        entry("actor_states", {
          accepted_chain_digest: hex("01"),
          accepted_operation_id: null,
          accepted_sequence: 1,
          actor_id: hex("02"),
          enrollment_certificate_digest: hex("03"),
          retired: false,
          retirement_certificate_digest: null,
        }),
      ),
    ).toThrow(/inconsistent nullable fields/);
  });
});
