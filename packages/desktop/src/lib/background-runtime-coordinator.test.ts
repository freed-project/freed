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

  it("formats active semantic work without leaking runtime tokens", async () => {
    const coordinator = await loadCoordinator();

    const message = coordinator.formatBackgroundRuntimeDeferredReason(
      "active:semantic-classifier:content-signals",
    );

    expect(message).toBe("Freed is finishing local indexing. Try again in a moment.");
    expect(message).not.toContain("active:");
    expect(message).not.toContain("semantic-classifier");
    expect(message).not.toContain("content-signals");
  });

  it("keeps cloud sync behind active social scrapes", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    let releaseScrape: () => void = () => {};
    const scrape = coordinator.runBackgroundJob({
      kind: "social-scrape",
      source: "facebook:feed",
      run: () => new Promise<void>((resolve) => {
        releaseScrape = resolve;
      }),
    });

    await Promise.resolve();
    await expect(
      coordinator.runBackgroundJob({
        kind: "cloud-sync",
        source: "cloud:gdrive",
        run: () => undefined,
      }),
    ).rejects.toMatchObject({ reason: "active:social-scrape:facebook:feed" });

    releaseScrape();
    await scrape;
  });

  it("lets social scrapes wait for active local semantic work", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    let releaseSemantic: () => void = () => {};
    const semantic = coordinator.runBackgroundJob({
      kind: "semantic-classifier",
      source: "content-signals",
      run: () => new Promise<void>((resolve) => {
        releaseSemantic = resolve;
      }),
    });

    await Promise.resolve();
    let completed = false;
    const scrape = coordinator.runBackgroundJob({
      kind: "social-scrape",
      source: "instagram:feed",
      waitForActiveJobMs: 1_000,
      waitForActiveJobKinds: ["semantic-classifier"],
      run: () => {
        completed = true;
        return "scraped";
      },
    });

    await Promise.resolve();
    expect(completed).toBe(false);

    releaseSemantic();
    await semantic;
    await expect(scrape).resolves.toBe("scraped");
    expect(completed).toBe(true);
  });

  it("lets cloud sync wait for an active outbox drain", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    let releaseOutbox: () => void = () => {};
    const outbox = coordinator.runBackgroundJob({
      kind: "outbox",
      source: "outbox",
      run: () => new Promise<void>((resolve) => {
        releaseOutbox = resolve;
      }),
    });

    await Promise.resolve();
    let completed = false;
    const upload = coordinator.runBackgroundJob({
      kind: "cloud-sync",
      source: "cloud:gdrive",
      waitForActiveJobMs: 1_000,
      waitForActiveJobKinds: ["outbox"],
      run: () => {
        completed = true;
        return "uploaded";
      },
    });

    await Promise.resolve();
    expect(completed).toBe(false);

    releaseOutbox();
    await outbox;
    await expect(upload).resolves.toBe("uploaded");
    expect(completed).toBe(true);
  });

  it("keeps a second social scrape deferred instead of queueing another provider window", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    let releaseScrape: () => void = () => {};
    const first = coordinator.runBackgroundJob({
      kind: "social-scrape",
      source: "facebook:feed",
      run: () => new Promise<void>((resolve) => {
        releaseScrape = resolve;
      }),
    });

    await Promise.resolve();
    await expect(
      coordinator.runBackgroundJob({
        kind: "social-scrape",
        source: "instagram:feed",
        waitForActiveJobMs: 1_000,
        waitForActiveJobKinds: ["semantic-classifier"],
        run: () => "scraped",
      }),
    ).rejects.toMatchObject({ reason: "active:social-scrape:facebook:feed" });

    releaseScrape();
    await first;
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

  it("pauses non-snapshot jobs during renderer safe mode", async () => {
    vi.useFakeTimers();
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    coordinator.noteRendererRecoveryState({
      phase: "safe_mode",
      reason: "renderer heartbeat stale",
      safeModeActive: true,
      safeModeRemainingMs: 600_000,
    });

    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({
      ok: false,
      reason: "waiting_for_renderer_heartbeat:0",
    });
    coordinator.noteRendererHeartbeat(heartbeat(3));
    coordinator.noteRendererHeartbeat(heartbeat(4));
    expect(coordinator.getBackgroundRuntimeStatus().safeModeUntil).toEqual(expect.any(Number));
    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({
      ok: false,
      reason: expect.stringContaining("renderer_safe_mode:"),
    });
    await expect(
      coordinator.runBackgroundJob({
        kind: "snapshot",
        source: "emergency",
        run: () => "snapshotted",
      }),
    ).resolves.toBe("snapshotted");

    await vi.advanceTimersByTimeAsync(600_001);
    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({ ok: true });
  });

  it("bridges native renderer recovery events into a cooldown", async () => {
    const coordinator = await loadCoordinator();
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: true });
    coordinator.noteRendererHeartbeat(heartbeat(1));
    coordinator.noteRendererHeartbeat(heartbeat(2));

    coordinator.noteRendererRecoveryState({
      phase: "recovery_attempt",
      reason: "renderer heartbeat stale",
    });

    const status = coordinator.getBackgroundRuntimeStatus();
    expect(status.healthyHeartbeats).toBe(0);
    expect(status.lastRecoveryPhase).toBe("recovery_attempt");
    expect(status.lastRecoveryReason).toBe("renderer heartbeat stale");
    expect(coordinator.canStartBackgroundJob("content-fetch")).toEqual({
      ok: false,
      reason: "waiting_for_renderer_heartbeat:0",
    });
  });
});
