import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

async function loadCoordinator() {
  vi.resetModules();
  return import("./background-runtime-coordinator");
}

function heartbeat(seq: number) {
  return {
    seq,
    ts: Date.now(),
    reason: "interval",
    visibility: "visible",
    href: "tauri://localhost",
  };
}

describe("background runtime coordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("gates jobs until the renderer has sent two heartbeats", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });

    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({
      ok: false,
      reason: "waiting_for_renderer_heartbeat:0",
    });

    coordinator.noteRendererHeartbeat(heartbeat(1));
    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({
      ok: false,
      reason: "waiting_for_renderer_heartbeat:1",
    });

    coordinator.noteRendererHeartbeat(heartbeat(2));
    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({ ok: true });
  });

  it("prevents overlapping background jobs", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    let releaseFirst: () => void = () => {};
    const first = coordinator.runBackgroundJob({
      kind: "content-fetch",
      source: "test-fetch",
      run: () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    });

    await Promise.resolve();
    await expect(
      coordinator.runBackgroundJob({
        kind: "outbox",
        source: "test-outbox",
        run: () => undefined,
      }),
    ).rejects.toMatchObject({ reason: "active:content-fetch:test-fetch" });

    releaseFirst();
    await first;
    await expect(
      coordinator.runBackgroundJob({
        kind: "outbox",
        source: "test-outbox",
        run: () => "ok",
      }),
    ).resolves.toBe("ok");
  });

  it("pauses jobs during memory pressure cooldown", async () => {
    vi.useFakeTimers();
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    coordinator.noteMemoryPressure({
      processResidentBytes: 10,
      processVirtualBytes: 20,
      appResidentBytes: 30,
      pressureLevel: "high",
      relayDocBytes: 0,
      relayClientCount: 0,
      contentQueuePending: 0,
      contentCompleted: 0,
      contentFailed: 0,
      contentActive: false,
      contentBackoffLevel: 0,
      sampleTs: Date.now(),
    });

    await expect(
      coordinator.runBackgroundJob({
        kind: "content-fetch",
        source: "test-fetch",
        run: () => undefined,
      }),
    ).rejects.toMatchObject({ reason: expect.stringContaining("cooldown:") });

    await vi.advanceTimersByTimeAsync(60_001);
    await expect(
      coordinator.runBackgroundJob({
        kind: "snapshot",
        source: "test-snapshot",
        run: () => "ready",
      }),
    ).resolves.toBe("ready");
  });
});
