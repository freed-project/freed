import {
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreNormalizedResultHeadV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { describe, expect, it, vi } from "vitest";

import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import {
  createLibraryServiceNormalizedPrimaryOrchestrationV2,
  type LibraryServiceNormalizedPrimaryTransportV2,
} from "./normalized-primary-orchestration.js";

const LIBRARY_ID = "1".repeat(64);
const EPOCH_ID = "2".repeat(64);
const ACTOR_ID = "3".repeat(64) as LibraryCoreLowercaseHex64;
const WRITER_ID = "4".repeat(64);
const ACTOR_ID_2 = "6".repeat(64) as LibraryCoreLowercaseHex64;

function descriptor() {
  return {
    authorityEpoch: EPOCH_ID,
    causalFrontierDigest: "5".repeat(64),
    format: "freed_normalized_checkpoint_export_v2",
    itemCount: 0,
    libraryId: LIBRARY_ID,
    protocolVersion: 2,
    recordCount: 0,
    sourceRevision: 7,
    writerId: WRITER_ID,
  };
}

function transport(
  actorPages: readonly Readonly<{
    afterActorId: LibraryCoreLowercaseHex64 | null;
    actorIds: readonly LibraryCoreLowercaseHex64[];
    done: boolean;
  }>[] = [{ afterActorId: null, actorIds: [ACTOR_ID], done: true }],
): LibraryServiceNormalizedPrimaryTransportV2 {
  let actorPageIndex = 0;
  return {
    intentReader: {
      async readImmutable() {
        throw new Error("no immutable intent should be read for an empty page");
      },
    },
    async openResultAdapter(input) {
      const head = parseLibraryCoreNormalizedResultHeadV2({
        actor_id: input.actorId,
        latest_segment: null,
        latest_segment_digest: null,
        library_id: input.libraryId,
        next_result_sequence: 1,
        protocol: "normalized_result_head_v2",
        protocol_version: 2,
        storage_epoch_id: input.storageEpochId,
      });
      return {
        async compareAndSwapHead() {
          throw new Error("an empty result page must not update its head");
        },
        async putImmutable() {
          throw new Error("an empty result page must not publish bytes");
        },
        async readHead() {
          return {
            bytes: encodeLibraryCoreCanonicalValue(
              head as unknown as LibraryCoreCanonicalValue,
            ),
            head,
            revision: "result-revision-1",
          };
        },
        async verifyImmutable() {
          throw new Error("an empty result page must not verify bytes");
        },
      };
    },
    async pageActors(input) {
      const page = actorPages[actorPageIndex++];
      if (page === undefined) throw new Error("unexpected actor page request");
      expect(input).toEqual({
        afterActorId: page.afterActorId,
        libraryId: LIBRARY_ID,
        limit: 16,
        storageEpochId: EPOCH_ID,
      });
      return {
        actorIds: page.actorIds,
        done: page.done,
        nextActorId: page.actorIds.at(-1) ?? null,
      };
    },
    async pageEnrollmentRequests(input) {
      expect(input).toEqual({
        libraryId: LIBRARY_ID,
        limit: 16,
        storageEpochId: EPOCH_ID,
      });
      return { done: true, requests: [] };
    },
    async pageIntentReferences(input) {
      expect(input.firstActorCounter).toBe(1);
      expect(input.libraryId).toBe(LIBRARY_ID);
      expect(input.limit).toBe(16);
      expect(input.storageEpochId).toBe(EPOCH_ID);
      return {
        done: true,
        firstActorCounter: 1,
        previousSegmentDigest: null,
        references: [],
      };
    },
    async publishEnrollmentCertificate() {
      throw new Error(
        "an empty enrollment page must not publish a certificate",
      );
    },
  };
}

function native() {
  const execute = vi.fn(async (commandId: string, payload: unknown) => {
    if (commandId === "describe_checkpoint_export_v2") return descriptor();
    if (commandId === "primary_follower_actor_transport_state_v1") {
      const actorId = (payload as { actorId: LibraryCoreLowercaseHex64 })
        .actorId;
      return {
        actorId,
        libraryId: LIBRARY_ID,
        nextActorCounter: 1,
        storageEpochId: EPOCH_ID,
      };
    }
    if (commandId === "export_follower_result_page_v2") {
      return {
        canonicalRecordBytes: 0,
        done: true,
        nextCursor: null,
        records: [],
      };
    }
    throw new Error(`unexpected native command: ${commandId}`);
  });
  return {
    client: { execute } as unknown as LibraryCoreNativeCommandClientV1,
    execute,
  };
}

describe("normalized Primary service orchestration", () => {
  it("runs one bounded enrollment, intent, and result pass in authority order", async () => {
    const active = native();
    const runtime = createLibraryServiceNormalizedPrimaryOrchestrationV2({
      native: active.client,
      now: () => 10,
      subtle: crypto.subtle,
      transport: transport(),
    });

    await expect(
      runtime.refresh(new AbortController().signal),
    ).resolves.toEqual({
      actorPageDone: true,
      enrollment: {
        done: true,
        processedRequestCount: 0,
        publishedCertificates: [],
      },
      importedIntentCount: 0,
      nextActorId: null,
      processedActorCount: 1,
      publishedResultCount: 0,
    });
    expect(active.execute.mock.calls.map(([commandId]) => commandId)).toEqual([
      "describe_checkpoint_export_v2",
      "primary_follower_actor_transport_state_v1",
      "export_follower_result_page_v2",
    ]);
  });

  it("rejects a duplicate actor page before native actor authority is read", async () => {
    const active = native();
    const runtime = createLibraryServiceNormalizedPrimaryOrchestrationV2({
      native: active.client,
      now: () => 10,
      subtle: crypto.subtle,
      transport: transport([
        {
          afterActorId: null,
          actorIds: [ACTOR_ID, ACTOR_ID],
          done: true,
        },
      ]),
    });

    await expect(
      runtime.refresh(new AbortController().signal),
    ).rejects.toMatchObject({ code: "command_response_invalid" });
    expect(active.execute).toHaveBeenCalledTimes(1);
  });

  it("continues a nonterminal actor page on the next inbound pass", async () => {
    const active = native();
    const runtime = createLibraryServiceNormalizedPrimaryOrchestrationV2({
      native: active.client,
      now: () => 10,
      subtle: crypto.subtle,
      transport: transport([
        { afterActorId: null, actorIds: [ACTOR_ID], done: false },
        {
          afterActorId: ACTOR_ID,
          actorIds: [ACTOR_ID_2],
          done: true,
        },
      ]),
    });

    await expect(
      runtime.refresh(new AbortController().signal),
    ).resolves.toMatchObject({ actorPageDone: false, nextActorId: ACTOR_ID });
    await expect(
      runtime.refresh(new AbortController().signal),
    ).resolves.toMatchObject({ actorPageDone: true, nextActorId: null });
  });

  it("does no work after cancellation", async () => {
    const active = native();
    const controller = new AbortController();
    controller.abort();
    const runtime = createLibraryServiceNormalizedPrimaryOrchestrationV2({
      native: active.client,
      now: () => 10,
      subtle: crypto.subtle,
      transport: transport(),
    });

    await expect(runtime.refresh(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(active.execute).not.toHaveBeenCalled();
  });

  it("binds cancellation per pass without resetting fairness after an interrupted read", async () => {
    const active = native();
    const actors = Array.from(
      { length: 17 },
      (_, index) =>
        (index + 1).toString(16).padStart(64, "0") as LibraryCoreLowercaseHex64,
    );
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const signals: AbortSignal[] = [];
    const blocked = vi.fn();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = createLibraryServiceNormalizedPrimaryOrchestrationV2({
      native: active.client,
      now: () => 10,
      subtle: crypto.subtle,
      async transport(signal) {
        signals.push(signal);
        if (signals.length === 2) {
          return {
            ...transport(),
            pageActors: blocked,
            pageEnrollmentRequests() {
              return new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
                started();
              });
            },
          };
        }
        return transport([
          signals.length === 1
            ? { afterActorId: null, actorIds: actors.slice(0, 16), done: false }
            : {
                afterActorId: actors[15]!,
                actorIds: actors.slice(16),
                done: true,
              },
        ]);
      },
    });

    await expect(
      runtime.refresh(controllers[0]!.signal),
    ).resolves.toMatchObject({
      processedActorCount: 16,
      nextActorId: actors[15],
    });
    const interrupted = runtime.refresh(controllers[1]!.signal);
    const rejected = expect(interrupted).rejects.toMatchObject({
      name: "AbortError",
    });
    await reading;
    controllers[1]!.abort();
    await rejected;
    expect(blocked).not.toHaveBeenCalled();
    await expect(
      runtime.refresh(controllers[2]!.signal),
    ).resolves.toMatchObject({
      processedActorCount: 1,
      nextActorId: null,
    });
    expect(signals).toEqual(controllers.map((controller) => controller.signal));
  });
});
