import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEGACY_EPOCH_BOOTSTRAP_DOMAINS,
  LEGACY_EPOCH_BOOTSTRAP_MAX_HEADS,
  LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES,
  LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX,
  classifyLegacyEpochBootstrapState,
  validateLegacyAutomergeHeadsBody,
  validateLegacyEpochBootstrapPreparedOperation,
  validateLegacyEpochBootstrapReceipt,
  validateLegacyEpochBootstrapRecord,
  validateLegacyEpochBootstrapRecordScan,
  validateLegacyLibraryControlV1,
  type LegacyAutomergeHeadsBody,
  type LegacyEpochBootstrapPreparedOperationV1,
  type LegacyEpochBootstrapReceiptV1,
  type LegacyEpochBootstrapRecordV1,
  type LegacyEpochBootstrapStateInput,
  type LegacyEpochBootstrapVerificationDependencies,
  type LegacyLibraryControlAccess,
  type LegacyLibraryControlV1,
} from "./legacy-epoch-bootstrap-contract.js";

const hex = (character: string): string => character.repeat(64);

const LIBRARY_ID = hex("1");
const CREATOR_ID = hex("2");
const ADOPTER_ID = hex("3");
const EPOCH_ID = hex("4");
const SOURCE_HEAD = hex("5");
const CANDIDATE_HEAD = hex("6");
const EVOLVED_HEAD = hex("7");
const UNRELATED_HEAD = hex("8");
const SOURCE_BINARY_DIGEST = hex("9");
const CANDIDATE_BINARY_DIGEST = hex("a");
const EVOLVED_BINARY_DIGEST = hex("b");
const OPERATION_ID = "legacy-bootstrap:fixture";
const LATER_SAVE_OPERATION_ID = "legacy-save:fixture";
const ADOPTER_PIN_OPERATION_ID = "legacy-adopter-pin:fixture";
const STORAGE_GENERATION = 3;
const SOURCE_SAVE_REVISION = 7;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`${domain}:${JSON.stringify(canonical(value))}`)
    .digest("hex");
}

const reachability = new Set([
  `${SOURCE_HEAD}:${SOURCE_HEAD}`,
  `${SOURCE_HEAD}:${CANDIDATE_HEAD}`,
  `${SOURCE_HEAD}:${EVOLVED_HEAD}`,
  `${CANDIDATE_HEAD}:${CANDIDATE_HEAD}`,
  `${CANDIDATE_HEAD}:${EVOLVED_HEAD}`,
  `${EVOLVED_HEAD}:${EVOLVED_HEAD}`,
]);

const dependencies: LegacyEpochBootstrapVerificationDependencies = {
  digest,
  isAutomergeFrontierReachable({ ancestorHeads, descendantHeads }) {
    return (
      ancestorHeads.length === 1 &&
      descendantHeads.length === 1 &&
      reachability.has(`${ancestorHeads[0]}:${descendantHeads[0]}`)
    );
  },
};

function heads(head: string): LegacyAutomergeHeadsBody {
  return { heads: [head] } as unknown as LegacyAutomergeHeadsBody;
}

function headsDigest(body: LegacyAutomergeHeadsBody): string {
  return digest(LEGACY_EPOCH_BOOTSTRAP_DOMAINS.automergeHeads, body);
}

function record(
  overrides: Record<string, unknown> = {},
): LegacyEpochBootstrapRecordV1 {
  const sourceHeads = heads(SOURCE_HEAD);
  const body = {
    format: "freed_legacy_epoch_bootstrap_record_v1",
    library_id: LIBRARY_ID,
    creator_installation_id: CREATOR_ID,
    active_epoch: 1,
    active_epoch_id: EPOCH_ID,
    active_engine: "automerge_legacy",
    schema_version: 0,
    replication_protocol: "automerge_blob_v1",
    source_heads_body: sourceHeads,
    source_heads_digest: headsDigest(sourceHeads),
    bootstrap_operation_id: OPERATION_ID,
    trust_model: "tofu_read_only_until_authenticated_pairing",
    migration_claim_pointer: null,
    ...overrides,
  };
  return {
    record_body: body,
    record_digest: digest(LEGACY_EPOCH_BOOTSTRAP_DOMAINS.record, body),
  } as LegacyEpochBootstrapRecordV1;
}

function control(
  bootstrapRecord = record(),
  {
    installationId = CREATOR_ID,
    frontier = CANDIDATE_HEAD,
    schemaVersion = 0,
    localAccess = "creator_local_owner_confirmed",
    updatedByOperationId = bootstrapRecord.record_body.bootstrap_operation_id,
  }: {
    installationId?: string;
    frontier?: string;
    schemaVersion?: number;
    localAccess?: LegacyLibraryControlAccess;
    updatedByOperationId?: string;
  } = {},
): LegacyLibraryControlV1 {
  return {
    format: "freed_library_control_v1",
    library_id: bootstrapRecord.record_body.library_id,
    installation_id: installationId,
    active_epoch: 1,
    active_epoch_id: bootstrapRecord.record_body.active_epoch_id,
    active_engine: "automerge_legacy",
    schema_version: schemaVersion,
    replication_protocol: "automerge_blob_v1",
    frontier_digest: headsDigest(heads(frontier)),
    bootstrap_record_digest: bootstrapRecord.record_digest,
    updated_by_operation_id: updatedByOperationId,
    migration_claim_pointer: null,
    storage_generation: STORAGE_GENERATION,
    local_access: localAccess,
  } as LegacyLibraryControlV1;
}

function prepared(
  bootstrapRecord = record(),
  { candidateHead = CANDIDATE_HEAD }: { candidateHead?: string } = {},
): LegacyEpochBootstrapPreparedOperationV1 {
  const candidateHeads = heads(candidateHead);
  const candidateControl = control(bootstrapRecord, {
    frontier: candidateHead,
  });
  const body = {
    format: "freed_legacy_epoch_bootstrap_prepared_v1",
    phase: "prepared",
    bootstrap_operation_id: OPERATION_ID,
    creator_installation_id: CREATOR_ID,
    source_storage_generation: STORAGE_GENERATION,
    target_storage_generation: STORAGE_GENERATION,
    source_save_revision: SOURCE_SAVE_REVISION,
    candidate_save_revision: SOURCE_SAVE_REVISION + 1,
    source_binary_digest: SOURCE_BINARY_DIGEST,
    candidate_binary_digest: CANDIDATE_BINARY_DIGEST,
    source_heads_digest: bootstrapRecord.record_body.source_heads_digest,
    candidate_heads_body: candidateHeads,
    candidate_heads_digest: headsDigest(candidateHeads),
    record: bootstrapRecord,
    record_digest: bootstrapRecord.record_digest,
    record_root_key: `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${bootstrapRecord.record_digest}`,
    candidate_control: candidateControl,
    candidate_control_digest: digest(
      LEGACY_EPOCH_BOOTSTRAP_DOMAINS.control,
      candidateControl,
    ),
  };
  return {
    prepared_body: body,
    prepared_digest: digest(
      LEGACY_EPOCH_BOOTSTRAP_DOMAINS.preparedOperation,
      body,
    ),
  } as LegacyEpochBootstrapPreparedOperationV1;
}

function receipt(
  preparedOperation = prepared(),
): LegacyEpochBootstrapReceiptV1 {
  const candidate = preparedOperation.prepared_body;
  const body = {
    format: "freed_legacy_epoch_bootstrap_receipt_v1",
    bootstrap_operation_id: candidate.bootstrap_operation_id,
    prepared_digest: preparedOperation.prepared_digest,
    record_digest: candidate.record_digest,
    creator_installation_id: candidate.creator_installation_id,
    source_storage_generation: candidate.source_storage_generation,
    committed_storage_generation: candidate.target_storage_generation,
    source_save_revision: candidate.source_save_revision,
    committed_save_revision: candidate.candidate_save_revision,
    source_binary_digest: candidate.source_binary_digest,
    committed_binary_digest: candidate.candidate_binary_digest,
    source_heads_digest: candidate.source_heads_digest,
    committed_heads_digest: candidate.candidate_heads_digest,
    control_digest: candidate.candidate_control_digest,
  };
  return {
    receipt_body: body,
    receipt_digest: digest(LEGACY_EPOCH_BOOTSTRAP_DOMAINS.receipt, body),
  } as LegacyEpochBootstrapReceiptV1;
}

function scan(
  records: readonly LegacyEpochBootstrapRecordV1[] = [],
  overrides: Record<string, unknown> = {},
) {
  const occurrences = records.map((entry) => ({
    root_key: `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${entry.record_digest}`,
    conflict_value: entry,
  }));
  const historicalRootKeys = [
    ...new Set(occurrences.map((entry) => entry.root_key)),
  ].sort();
  return {
    format: "freed_legacy_epoch_bootstrap_scan_v1",
    scan_complete: true,
    history_scan_complete: true,
    overflow: false,
    reserved_root_key_count: new Set(occurrences.map((entry) => entry.root_key))
      .size,
    occurrence_count: occurrences.length,
    occurrences,
    historical_root_key_count: historicalRootKeys.length,
    historical_root_keys: historicalRootKeys,
    ...overrides,
  };
}

function sourceState(
  overrides: Partial<LegacyEpochBootstrapStateInput> = {},
): LegacyEpochBootstrapStateInput {
  const sourceHeads = heads(SOURCE_HEAD);
  return {
    local_installation_id: CREATOR_ID,
    automerge_heads_body: sourceHeads,
    automerge_heads_digest: headsDigest(sourceHeads),
    automerge_binary_digest: SOURCE_BINARY_DIGEST,
    save_revision: SOURCE_SAVE_REVISION,
    storage_generation: STORAGE_GENERATION,
    current_schema_version: 0,
    prepared_operation: null,
    completion_receipt: null,
    record_scan: scan(),
    library_control: null,
    ...overrides,
  };
}

function committedState(
  overrides: Partial<LegacyEpochBootstrapStateInput> = {},
): LegacyEpochBootstrapStateInput {
  const bootstrapRecord = record();
  const preparedOperation = prepared(bootstrapRecord);
  const candidateHeads = heads(CANDIDATE_HEAD);
  return {
    local_installation_id: CREATOR_ID,
    automerge_heads_body: candidateHeads,
    automerge_heads_digest: headsDigest(candidateHeads),
    automerge_binary_digest: CANDIDATE_BINARY_DIGEST,
    save_revision: SOURCE_SAVE_REVISION + 1,
    storage_generation: STORAGE_GENERATION,
    current_schema_version: 0,
    prepared_operation: preparedOperation,
    completion_receipt: receipt(preparedOperation),
    record_scan: scan([bootstrapRecord]),
    library_control: preparedOperation.prepared_body.candidate_control,
    ...overrides,
  };
}

describe("legacy epoch bootstrap contract", () => {
  it("validates one content-addressed record without pretending it is owner authority", () => {
    const bootstrapRecord = record();
    expect(
      validateLegacyEpochBootstrapRecord(bootstrapRecord, dependencies),
    ).toEqual({ ok: true, value: bootstrapRecord });
    expect(bootstrapRecord.record_body).not.toHaveProperty(
      "target_authority_public_key",
    );
    expect(bootstrapRecord).not.toHaveProperty("authority_signature");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          local_installation_id: ADOPTER_ID,
          record_scan: scan([bootstrapRecord]),
        }),
        dependencies,
      ),
    ).toBe("adopter_record_unpinned");
  });

  it("bounds supported Freed frontiers before copying them", () => {
    expect(validateLegacyAutomergeHeadsBody({ heads: [SOURCE_HEAD] }).ok).toBe(
      true,
    );
    const maximumHeads = Array.from(
      { length: LEGACY_EPOCH_BOOTSTRAP_MAX_HEADS },
      (_, index) => index.toString(16).padStart(64, "0"),
    );
    expect(validateLegacyAutomergeHeadsBody({ heads: maximumHeads }).ok).toBe(
      true,
    );
    expect(validateLegacyAutomergeHeadsBody({ heads: [] }).ok).toBe(false);

    const oversized = new Proxy(
      new Array(LEGACY_EPOCH_BOOTSTRAP_MAX_HEADS + 1),
      {
        get(target, property, receiver) {
          if (property !== "length") {
            throw new Error("oversized input member must not be read");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(
      validateLegacyAutomergeHeadsBody({ heads: oversized }),
    ).toMatchObject({ ok: false, code: "resource_limit" });
  });

  it("requires a complete bounded namespace scan and exact digest address", () => {
    const bootstrapRecord = record();
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([bootstrapRecord]),
        dependencies,
      ).ok,
    ).toBe(true);
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([bootstrapRecord], { scan_complete: false }),
        dependencies,
      ),
    ).toMatchObject({ ok: false, code: "incomplete" });
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([], { scan_complete: false, overflow: true }),
        dependencies,
      ),
    ).toMatchObject({ ok: false, code: "resource_limit" });
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([bootstrapRecord], {
          occurrences: [
            {
              root_key: `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${hex("f")}`,
              conflict_value: bootstrapRecord,
            },
          ],
        }),
        dependencies,
      ).ok,
    ).toBe(false);

    const oversizedOccurrences = new Array(
      LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES + 1,
    ).fill({
      root_key: `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${bootstrapRecord.record_digest}`,
      conflict_value: bootstrapRecord,
    });
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([], {
          reserved_root_key_count: 1,
          occurrence_count: oversizedOccurrences.length,
          occurrences: oversizedOccurrences,
        }),
        dependencies,
      ),
    ).toMatchObject({ ok: false, code: "resource_limit" });
    expect(
      validateLegacyEpochBootstrapRecordScan(
        scan([bootstrapRecord], { history_scan_complete: false }),
        dependencies,
      ),
    ).toMatchObject({ ok: false, code: "incomplete" });
  });

  it("never interprets a deleted historical bootstrap root as fresh absence", () => {
    const bootstrapRecord = record();
    const historicalRoot = `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${bootstrapRecord.record_digest}`;
    expect(classifyLegacyEpochBootstrapState(sourceState(), dependencies)).toBe(
      "absent",
    );
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          record_scan: scan([], {
            historical_root_key_count: 1,
            historical_root_keys: [historicalRoot],
          }),
        }),
        dependencies,
      ),
    ).toBe("record_history_violation");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          local_installation_id: ADOPTER_ID,
          record_scan: scan([bootstrapRecord], {
            historical_root_key_count: 0,
            historical_root_keys: [],
          }),
        }),
        dependencies,
      ),
    ).toBe("record_history_violation");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          record_scan: scan([], {
            historical_root_key_count:
              LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES + 1,
            historical_root_keys: [],
          }),
        }),
        dependencies,
      ),
    ).toBe("resource_limit_exceeded");
  });

  it("closes the prepared operation and receipt without a cyclic digest", () => {
    const preparedOperation = prepared();
    const completionReceipt = receipt(preparedOperation);
    expect(
      validateLegacyEpochBootstrapPreparedOperation(
        preparedOperation,
        dependencies,
      ).ok,
    ).toBe(true);
    expect(
      validateLegacyEpochBootstrapReceipt(completionReceipt, dependencies).ok,
    ).toBe(true);
    expect(completionReceipt.receipt_body.prepared_digest).toBe(
      preparedOperation.prepared_digest,
    );
    expect(preparedOperation.prepared_body).not.toHaveProperty(
      "receipt_digest",
    );
    const unrelatedCandidate = prepared(record(), {
      candidateHead: UNRELATED_HEAD,
    });
    expect(
      validateLegacyEpochBootstrapPreparedOperation(
        unrelatedCandidate,
        dependencies,
      ).ok,
    ).toBe(false);
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({ prepared_operation: unrelatedCandidate }),
        dependencies,
      ),
    ).toBe("mismatched_or_corrupt");
  });

  it("classifies only exact prepared or complete committed creator state", () => {
    const preparedOperation = prepared();
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({ prepared_operation: preparedOperation }),
        dependencies,
      ),
    ).toBe("creator_prepared");
    expect(
      classifyLegacyEpochBootstrapState(committedState(), dependencies),
    ).toBe("creator_committed");
    expect(
      classifyLegacyEpochBootstrapState(
        committedState({
          library_control: control(record(), {
            updatedByOperationId: LATER_SAVE_OPERATION_ID,
          }),
        }),
        dependencies,
      ),
    ).toBe("mismatched_or_corrupt");

    const complete = committedState();
    const partials = [
      { ...complete, library_control: null },
      { ...complete, completion_receipt: null },
      {
        ...complete,
        prepared_operation: null,
        completion_receipt: complete.completion_receipt,
      },
      {
        ...sourceState(),
        library_control: complete.library_control,
      },
      {
        ...sourceState(),
        completion_receipt: complete.completion_receipt,
      },
    ];
    for (const partial of partials) {
      expect(classifyLegacyEpochBootstrapState(partial, dependencies)).toBe(
        "mismatched_or_corrupt",
      );
    }
  });

  it("invalidates a prepared action when its exact source changes", () => {
    const preparedOperation = prepared();
    const changedCases = [
      { save_revision: SOURCE_SAVE_REVISION + 1 },
      { storage_generation: STORAGE_GENERATION + 1 },
      { automerge_binary_digest: EVOLVED_BINARY_DIGEST },
      {
        automerge_heads_body: heads(EVOLVED_HEAD),
        automerge_heads_digest: headsDigest(heads(EVOLVED_HEAD)),
      },
    ];
    for (const changed of changedCases) {
      expect(
        classifyLegacyEpochBootstrapState(
          sourceState({
            prepared_operation: preparedOperation,
            ...changed,
          }),
          dependencies,
        ),
      ).toBe("prepared_source_changed");
    }
  });

  it("accepts later creator saves only when candidate ancestry remains intact", () => {
    const evolvedHeads = heads(EVOLVED_HEAD);
    const evolvedControl = control(record(), {
      frontier: EVOLVED_HEAD,
      schemaVersion: 1,
      updatedByOperationId: LATER_SAVE_OPERATION_ID,
    });
    expect(
      classifyLegacyEpochBootstrapState(
        committedState({
          automerge_heads_body: evolvedHeads,
          automerge_heads_digest: headsDigest(evolvedHeads),
          automerge_binary_digest: EVOLVED_BINARY_DIGEST,
          save_revision: SOURCE_SAVE_REVISION + 2,
          current_schema_version: 1,
          library_control: evolvedControl,
        }),
        dependencies,
      ),
    ).toBe("creator_committed");

    const unrelatedHeads = heads(UNRELATED_HEAD);
    expect(
      classifyLegacyEpochBootstrapState(
        committedState({
          automerge_heads_body: unrelatedHeads,
          automerge_heads_digest: headsDigest(unrelatedHeads),
          automerge_binary_digest: EVOLVED_BINARY_DIGEST,
          save_revision: SOURCE_SAVE_REVISION + 2,
          library_control: control(record(), { frontier: UNRELATED_HEAD }),
        }),
        dependencies,
      ),
    ).toBe("mismatched_or_corrupt");
  });

  it("pins adopters only as TOFU read-only", () => {
    const bootstrapRecord = record();
    const candidateHeads = heads(CANDIDATE_HEAD);
    const adopterBase = sourceState({
      local_installation_id: ADOPTER_ID,
      automerge_heads_body: candidateHeads,
      automerge_heads_digest: headsDigest(candidateHeads),
      automerge_binary_digest: CANDIDATE_BINARY_DIGEST,
      save_revision: SOURCE_SAVE_REVISION + 1,
      record_scan: scan([bootstrapRecord]),
    });
    expect(classifyLegacyEpochBootstrapState(adopterBase, dependencies)).toBe(
      "adopter_record_unpinned",
    );
    expect(
      classifyLegacyEpochBootstrapState(
        {
          ...adopterBase,
          library_control: control(bootstrapRecord, {
            installationId: ADOPTER_ID,
            localAccess: "adopter_tofu_read_only",
            updatedByOperationId: ADOPTER_PIN_OPERATION_ID,
          }),
        },
        dependencies,
      ),
    ).toBe("adopter_tofu_read_only");
    expect(
      classifyLegacyEpochBootstrapState(
        {
          ...adopterBase,
          library_control: control(bootstrapRecord, {
            installationId: ADOPTER_ID,
            localAccess: "creator_local_owner_confirmed",
          }),
        },
        dependencies,
      ),
    ).toBe("mismatched_or_corrupt");
  });

  it("collapses exact duplicates and blocks unequal synchronized records", () => {
    const first = record();
    const second = record({ active_epoch_id: hex("c") });
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          local_installation_id: ADOPTER_ID,
          record_scan: scan([first, first]),
        }),
        dependencies,
      ),
    ).toBe("adopter_record_unpinned");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          local_installation_id: ADOPTER_ID,
          record_scan: scan([first, second]),
        }),
        dependencies,
      ),
    ).toBe("multiple_record_conflict");
  });

  it("snapshots mutable nested input and fails closed on hostile access", () => {
    const mutableHeads = [SOURCE_HEAD];
    const bootstrapRecord = record({
      source_heads_body: { heads: mutableHeads },
    });
    const result = validateLegacyEpochBootstrapRecord(
      bootstrapRecord,
      dependencies,
    );
    expect(result.ok).toBe(true);
    mutableHeads[0] = UNRELATED_HEAD;
    if (result.ok) {
      expect(result.value.record_body.source_heads_body.heads).toEqual([
        SOURCE_HEAD,
      ]);
      expect(
        Object.isFrozen(result.value.record_body.source_heads_body.heads),
      ).toBe(true);
    }

    expect(
      classifyLegacyEpochBootstrapState(
        new Proxy(sourceState(), {
          ownKeys() {
            throw new Error("hostile proxy");
          },
        }),
        dependencies,
      ),
    ).toBe("mismatched_or_corrupt");
  });

  it("distinguishes incomplete, resource-limited, and future evidence", () => {
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          record_scan: scan([], { scan_complete: false }),
        }),
        dependencies,
      ),
    ).toBe("incomplete_scan");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({
          record_scan: scan([], { scan_complete: false, overflow: true }),
        }),
        dependencies,
      ),
    ).toBe("resource_limit_exceeded");
    expect(
      classifyLegacyEpochBootstrapState(
        sourceState({ current_schema_version: 2 }),
        dependencies,
      ),
    ).toBe("unsupported_newer");

    const futureRecord = record({
      format: "freed_legacy_epoch_bootstrap_record_v2",
    });
    const futurePrepared = prepared();
    const futureReceipt = receipt();
    const futureCases = [
      validateLegacyEpochBootstrapRecord(
        {
          record_body: futureRecord.record_body,
        },
        dependencies,
      ),
      validateLegacyLibraryControlV1({
        ...control(),
        format: "freed_library_control_v2",
        future_field: true,
      }),
      validateLegacyEpochBootstrapPreparedOperation(
        {
          prepared_body: {
            ...futurePrepared.prepared_body,
            format: "freed_legacy_epoch_bootstrap_prepared_v2",
          },
        },
        dependencies,
      ),
      validateLegacyEpochBootstrapReceipt(
        {
          receipt_body: {
            ...futureReceipt.receipt_body,
            format: "freed_legacy_epoch_bootstrap_receipt_v2",
          },
          future_field: true,
        },
        dependencies,
      ),
      validateLegacyEpochBootstrapRecordScan(
        {
          format: "freed_legacy_epoch_bootstrap_scan_v2",
        },
        dependencies,
      ),
    ];
    for (const futureCase of futureCases) {
      expect(futureCase).toMatchObject({
        ok: false,
        code: "unsupported_newer",
      });
    }
  });

  it("fails closed when digest or ancestry verification is unavailable", () => {
    expect(
      validateLegacyEpochBootstrapRecord(record(), {
        ...dependencies,
        digest() {
          throw new Error("digest unavailable");
        },
      }).ok,
    ).toBe(false);
    expect(
      classifyLegacyEpochBootstrapState(committedState(), {
        ...dependencies,
        isAutomergeFrontierReachable() {
          throw new Error("change graph unavailable");
        },
      }),
    ).toBe("mismatched_or_corrupt");
  });
});
