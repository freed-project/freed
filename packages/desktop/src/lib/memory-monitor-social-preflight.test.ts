import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  setRuntimeMemory: vi.fn(),
}));

vi.mock("./content-fetcher", () => ({
  getStatus: () => ({
    pending: 0,
    completed: 0,
    failedCount: 0,
    active: false,
    activeAgeMs: null,
    nextDelayMs: null,
    backoffLevel: 0,
  }),
}));

vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

async function loadMonitor() {
  vi.resetModules();
  return import("./memory-monitor");
}

function blockedPreparation() {
  const after = {
    totalPhysicalMemoryBytes: 16 * 1024 * 1024 * 1024,
    processResidentBytes: 64 * 1024 * 1024,
    processVirtualBytes: 256 * 1024 * 1024,
    appResidentBytes: 3 * 1024 * 1024 * 1024,
    webkitResidentBytes: 96 * 1024 * 1024,
    webkitVirtualBytes: 512 * 1024 * 1024,
    webkitProcessId: 12345,
    webkitTotalResidentBytes: 96 * 1024 * 1024,
    webkitProcessCount: 1,
    webkitLargestResidentBytes: 96 * 1024 * 1024,
    webkitLargestProcessId: 12345,
    webkitLargestCpuUsage: 0,
    webkitLargestAgeSeconds: 10,
    webkitLargestRole: "freed-webcontent",
    webkitProcesses: [],
    webkitTelemetryAvailable: true,
    indexedDbBytes: 0,
    webkitCacheBytes: 0,
    memoryHighBytes: 2 * 1024 * 1024 * 1024,
    memoryCriticalBytes: 4 * 1024 * 1024 * 1024,
    relayDocBytes: 0,
    relayClientCount: 0,
  };
  return {
    before: after,
    after,
    recycledScraperWindows: true,
    cacheTrimmed: false,
    mayProceed: false,
  };
}

describe("social scrape memory preflight scheduling", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.invoke.mockReset();
  });

  it("reuses the failed preflight result instead of stampeding other providers", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(blockedPreparation());
    const monitor = await loadMonitor();

    const facebook = await monitor.prepareSocialScrapeMemory("facebook", "feed scrape");
    const instagram = await monitor.prepareSocialScrapeMemory("instagram", "feed scrape");

    expect(facebook.mayProceed).toBe(false);
    expect(instagram.mayProceed).toBe(false);
    expect(instagram.deferredReason).toBe("facebook:feed scrape");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);
    await monitor.prepareSocialScrapeMemory("linkedin", "feed scrape");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
