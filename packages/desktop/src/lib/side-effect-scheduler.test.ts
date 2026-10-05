import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => vi.useRealTimers());
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

    const rejected = expect(first).rejects.toThrow("timed_out_ms=10");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.resolve();
    await second;
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it.each(["success", "failure"] as const)(
    "retains an opted-in caller until late %s, preserving the deadline error", async (outcome) => {
      vi.useFakeTimers();
      const { scheduleSideEffect } = await loadScheduler();
      let finish!: () => void;
      let callerSettled = false;
      let secondStarted = false;
      const first = scheduleSideEffect({
        queue: "outbox", source: "test", kind: "owned", timeoutMs: 10,
        retainUntilSettledAfterTimeout: true,
        run: () => new Promise<void>((resolve, reject) => {
          finish = () => outcome === "success" ? resolve() : reject(new Error("late failure"));
        }),
      });
      const observed = first.then(
        () => { callerSettled = true; return null; },
        error => { callerSettled = true; return error as Error; },
      );
      const second = scheduleSideEffect({
        queue: "outbox", source: "test", kind: "second",
        run: () => { secondStarted = true; },
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(callerSettled).toBe(false);
      expect(secondStarted).toBe(false);
      finish();
      expect((await observed)?.message).toContain("timed_out_ms=10");
      await second;
      expect(secondStarted).toBe(true);
    },
  );

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
