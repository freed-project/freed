import { describe, expect, it, vi } from "vitest";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
  },
}));

async function loadScheduler() {
  vi.resetModules();
  return import("./side-effect-scheduler");
}

describe("side-effect scheduler", () => {
  it("runs tasks in queue order", async () => {
    const { scheduleSideEffect } = await loadScheduler();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};

    const first = scheduleSideEffect({
      queue: "nativeStore",
      source: "test",
      kind: "first",
      run: async () => {
        events.push("first:start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
      },
    });
    const second = scheduleSideEffect({
      queue: "nativeStore",
      source: "test",
      kind: "second",
      run: async () => {
        events.push("second");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("waits for a timed out task to settle before starting the next task", async () => {
    vi.useFakeTimers();
    const { scheduleSideEffect } = await loadScheduler();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};

    const first = scheduleSideEffect({
      queue: "nativeStore",
      source: "test",
      kind: "timeout",
      timeoutMs: 10,
      run: async () => {
        events.push("first:start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
      },
    });
    const second = scheduleSideEffect({
      queue: "nativeStore",
      source: "test",
      kind: "second",
      run: async () => {
        events.push("second");
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(first).rejects.toThrow("timed_out_ms=10");
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.resolve();
    await second;
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("keeps a queue alive after a failed task", async () => {
    const { scheduleSideEffect } = await loadScheduler();
    const events: string[] = [];

    await expect(
      scheduleSideEffect({
        queue: "persistence",
        source: "test",
        kind: "fail",
        run: async () => {
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow("nope");

    await scheduleSideEffect({
      queue: "persistence",
      source: "test",
      kind: "next",
      run: async () => {
        events.push("next");
      },
    });

    expect(events).toEqual(["next"]);
  });
});
