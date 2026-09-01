import type { LibraryCoreLowercaseHex64 } from "@freed/shared/library-core";
import { describe, expect, it, vi } from "vitest";

import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import { createLibraryServiceNormalizedPrimaryNativeRuntimeV2 } from "./normalized-primary-native-runtime.js";

const ACTOR_ID = "1".repeat(64) as LibraryCoreLowercaseHex64;
const RESULT_DIGEST = "2".repeat(64);
const TRANSACTION_DIGEST = "3".repeat(64);
const EPOCH_ID = "4".repeat(64);

function nativeResultPage(overrides: Record<string, unknown> = {}) {
  return {
    canonicalRecordBytes: 2,
    done: true,
    nextCursor: {
      actorId: ACTOR_ID,
      resultDigest: RESULT_DIGEST,
      resultSequence: 1,
    },
    records: [
      {
        actorId: ACTOR_ID,
        authoritativeSourceRevision: 9,
        authorityEpochId: EPOCH_ID,
        canonicalResultJson: "{}",
        enqueuedAt: 10,
        intentEpochId: EPOCH_ID,
        originalResultDigest: null,
        previousResultDigest: null,
        rejectionReason: null,
        resultDigest: RESULT_DIGEST,
        resultSequence: 1,
        status: "accepted",
        transactionDigest: TRANSACTION_DIGEST,
        transactionId: "transaction-1",
      },
    ],
    ...overrides,
  };
}

describe("normalized Primary native runtime", () => {
  it("binds each coordinator operation to its exact generated native command", async () => {
    const execute = vi.fn(async (commandId: string) => {
      if (commandId === "export_follower_result_page_v2") {
        return nativeResultPage();
      }
      return { commandId };
    });
    const runtime = createLibraryServiceNormalizedPrimaryNativeRuntimeV2({
      native: { execute } as unknown as LibraryCoreNativeCommandClientV1,
      now: () => 11,
      subtle: crypto.subtle,
    });

    await runtime.countersignEnrollment({
      acceptedAtMs: 11,
      canonicalEnrollmentRequestJson: "{}",
    });
    await runtime.ingestIntentPage({ page: { records: [] }, receivedAt: 11 });
    await runtime.readActorState(ACTOR_ID);
    const page = await runtime.exportResultPage({
      actorId: ACTOR_ID,
      firstResultSequence: 1,
      maximumRecords: 128,
      maximumResponseBytes: 1_048_576,
    });

    expect(execute.mock.calls.map(([commandId]) => commandId)).toEqual([
      "countersign_follower_actor_request_v2",
      "ingest_follower_intent_page_v1",
      "primary_follower_actor_transport_state_v1",
      "export_follower_result_page_v2",
    ]);
    expect(new TextDecoder().decode(page.canonicalResults[0])).toBe("{}");
    expect(page.done).toBe(true);
  });

  it("rejects a native result cursor that does not close the returned page", async () => {
    const native: LibraryCoreNativeCommandClientV1 = {
      async execute() {
        return nativeResultPage({
          nextCursor: {
            actorId: ACTOR_ID,
            resultDigest: "f".repeat(64),
            resultSequence: 1,
          },
        });
      },
    };
    const runtime = createLibraryServiceNormalizedPrimaryNativeRuntimeV2({
      native,
      now: () => 11,
      subtle: crypto.subtle,
    });

    await expect(
      runtime.exportResultPage({
        actorId: ACTOR_ID,
        firstResultSequence: 1,
        maximumRecords: 128,
        maximumResponseBytes: 1_048_576,
      }),
    ).rejects.toMatchObject({ code: "command_response_invalid" });
  });

  it("accepts an empty terminal page whose cursor names the SQLite predecessor", async () => {
    const native: LibraryCoreNativeCommandClientV1 = {
      async execute() {
        return nativeResultPage({
          canonicalRecordBytes: 0,
          nextCursor: {
            actorId: ACTOR_ID,
            resultDigest: RESULT_DIGEST,
            resultSequence: 1,
          },
          records: [],
        });
      },
    };
    const runtime = createLibraryServiceNormalizedPrimaryNativeRuntimeV2({
      native,
      now: () => 11,
      subtle: crypto.subtle,
    });

    await expect(
      runtime.exportResultPage({
        actorId: ACTOR_ID,
        firstResultSequence: 2,
        maximumRecords: 128,
        maximumResponseBytes: 1_048_576,
      }),
    ).resolves.toEqual({ canonicalResults: [], done: true });
  });
});
