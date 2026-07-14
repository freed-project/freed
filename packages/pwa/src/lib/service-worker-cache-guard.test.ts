import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("service worker cache write guard", () => {
  it("drains a started put, blocks writes during reset, and resumes afterward", async () => {
    let finishPut!: () => void;
    const originalPut = vi.fn(
      () => new Promise<void>((resolve) => {
        finishPut = resolve;
      }),
    );
    class MockCache {
      put(): Promise<void> {
        return originalPut();
      }
    }
    let messageListener!: (event: {
      data: { type: string };
      ports: Array<{ postMessage: (message: unknown) => void }>;
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void;
    const workerScope = {
      addEventListener: vi.fn((type: string, listener: typeof messageListener) => {
        if (type === "message") messageListener = listener;
      }),
    };
    const script = readFileSync(
      resolve(process.cwd(), "public/factory-reset-sw.js"),
      "utf8",
    );
    runInNewContext(script, { self: workerScope, Cache: MockCache });

    const cache = new MockCache();
    const startedPut = cache.put();
    const postMessage = vi.fn();
    let drained!: Promise<unknown>;
    messageListener({
      data: { type: "FREED_FACTORY_RESET_QUIESCE" },
      ports: [{ postMessage }],
      waitUntil: (promise) => {
        drained = promise;
      },
    });
    expect(postMessage).not.toHaveBeenCalled();

    finishPut();
    await startedPut;
    await drained;
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({
      type: "FREED_FACTORY_RESET_QUIESCED",
    });

    await cache.put();
    expect(originalPut).toHaveBeenCalledTimes(1);

    const resumePostMessage = vi.fn();
    messageListener({
      data: { type: "FREED_FACTORY_RESET_RESUME" },
      ports: [{ postMessage: resumePostMessage }],
      waitUntil: vi.fn(),
    });
    expect(resumePostMessage).toHaveBeenCalledWith({
      type: "FREED_FACTORY_RESET_RESUMED",
    });

    const resumedPut = cache.put();
    finishPut();
    await resumedPut;
    expect(originalPut).toHaveBeenCalledTimes(2);
  });
});
