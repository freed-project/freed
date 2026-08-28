import { describe, expect, it, vi } from "vitest";

import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import { createLibraryServicePrimaryRuntimeV1 } from "./primary-runtime.js";

class Scheduler {
  callback: (() => void | Promise<void>) | null = null;
  delayMs: number | null = null;

  schedule(callback: () => void | Promise<void>, delayMs: number): number {
    this.callback = callback;
    this.delayMs = delayMs;
    return 1;
  }

  cancel(): void {
    this.callback = null;
  }

  async run(): Promise<void> {
    const callback = this.callback;
    if (callback === null) throw new Error("no scheduled Primary pass");
    this.callback = null;
    await callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function checkpoint(
  input: {
    actorId?: string;
    libraryId?: string;
    sourceRevision?: number;
  } = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    authorityEpoch: "b".repeat(64),
    causalFrontierDigest: "c".repeat(64),
    format: "freed_normalized_checkpoint_export_v2",
    itemCount: 19_000,
    libraryId: input.libraryId ?? "a".repeat(64),
    protocolVersion: 2,
    recordCount: 21_000,
    sourceRevision: input.sourceRevision ?? 7,
    writerId: input.actorId ?? "d".repeat(64),
  });
}

describe("headless Library Primary runtime", () => {
  it("binds the shared recurring coordinator to exact native authority", async () => {
    const scheduler = new Scheduler();
    let sourceRevision = 7;
    let writerId = "d".repeat(64);
    let nowMs = 1_000;
    const execute = vi.fn(async (commandId: string): Promise<unknown> =>
      commandId === "primary_actor_identity_v1"
        ? { actorId: "d".repeat(64), libraryId: "a".repeat(64) }
        : checkpoint({ actorId: writerId, sourceRevision }),
    );
    const publication = vi.fn(async ({ reason }) => ({
      revision: sourceRevision,
      status: reason === "initial" ? "published" : "current",
    }));
    const runtime = createLibraryServicePrimaryRuntimeV1({
      clock: { nowMs: () => nowMs },
      diagnostics: { record() {} },
      installationWitness: "e".repeat(64),
      native: { execute } as LibraryCoreNativeCommandClientV1,
      publication: { publish: publication },
      publicationState: { lastPublishedRevision: async () => 7 },
      scheduler,
    });

    await expect(runtime.start()).resolves.toEqual({
      revision: 7,
      status: "published",
    });
    expect(scheduler.delayMs).toBe(15_000);
    expect(execute.mock.calls.map(([commandId]) => commandId)).toEqual([
      "primary_actor_identity_v1",
      "describe_checkpoint_export_v2",
    ]);

    nowMs += 60_000;
    await scheduler.run();

    expect(publication).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "inbound_refresh" }),
    );

    writerId = "f".repeat(64);
    await scheduler.run();
    expect(publication).toHaveBeenCalledTimes(2);
    expect(scheduler.callback).toBeNull();
  });

  it("fails before publication when the native writer is another actor", async () => {
    const execute = vi.fn(async (commandId: string): Promise<unknown> =>
      commandId === "primary_actor_identity_v1"
        ? { actorId: "d".repeat(64), libraryId: "a".repeat(64) }
        : checkpoint({ actorId: "f".repeat(64) }),
    );
    const publication = vi.fn(async () => ({ revision: 7, status: "current" }));
    const runtime = createLibraryServicePrimaryRuntimeV1({
      clock: { nowMs: () => 1_000 },
      diagnostics: { record() {} },
      installationWitness: "e".repeat(64),
      native: { execute } as LibraryCoreNativeCommandClientV1,
      publication: { publish: publication },
      publicationState: { lastPublishedRevision: async () => 7 },
      scheduler: new Scheduler(),
    });

    await expect(runtime.start()).rejects.toMatchObject({
      code: "authority_not_primary",
    });
    expect(publication).not.toHaveBeenCalled();
  });
});
