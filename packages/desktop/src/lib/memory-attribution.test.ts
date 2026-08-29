import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  recordRuntimeHealthEvent: vi.fn(),
  setRuntimeMemory: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
    warn: mocks.warn,
  },
}));

vi.mock("./runtime-health-events", () => ({
  recordRuntimeHealthEvent: mocks.recordRuntimeHealthEvent,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  setRuntimeMemory: mocks.setRuntimeMemory,
}));

vi.mock("./content-fetcher", () => ({
  getStatus: () => ({
    pending: 0,
    completed: 0,
    failedCount: 0,
    active: false,
    backoffLevel: 0,
  }),
}));

import {
  capturePreLibraryMemoryBaseline,
  getPreLibraryBaselineBytes,
  recordLibraryRuntimeReady,
  recordLibraryRuntimeLoadStarted,
  resetMemoryAttributionForTests,
  startMemoryMonitor,
  stopMemoryMonitor,
} from "./memory-monitor";

const MIB = 1024 * 1024;

function nativeSample(
  processId: number,
  residentBytes: number,
  startedAtUnixSeconds = 1_783_000_000,
  startedAtUnixMicros = startedAtUnixSeconds * 1_000_000 + 500_000,
) {
  return {
    totalPhysicalMemoryBytes: 8 * 1024 * MIB,
    processResidentBytes: 64 * MIB,
    processVirtualBytes: 256 * MIB,
    appResidentBytes: 64 * MIB + residentBytes,
    webkitResidentBytes: residentBytes,
    webkitProcessId: processId,
    webkitTotalResidentBytes: residentBytes,
    webkitProcessCount: 1,
    webkitLargestResidentBytes: residentBytes,
    webkitLargestProcessId: processId,
    webkitLargestRole: "freed-webcontent-age-matched",
    webkitProcesses: [
      {
        processId,
        startedAtUnixSeconds,
        startedAtUnixMicros,
        residentBytes,
        virtualBytes: 512 * MIB,
        cpuUsage: 0,
        ageSeconds: 1,
        role: "freed-webcontent",
      },
    ],
    webkitTelemetryAvailable: true,
    webkitAttributionPrecise: true,
    memoryHighBytes: 2 * 1024 * MIB,
    memoryCriticalBytes: 3 * 1024 * MIB,
  };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

// The contract this protects: the pre-Library baseline is only meaningful if it
// is captured before the SQLite Library runtime loads. Every floor estimate in
// the storage roadmap is derived by subtracting from an observed total, and the
// WebKit-plus-React renderer is the largest term in that subtraction, estimated
// across four independent passes at anywhere from 60 to 250 MB. A baseline
// taken after Library load silently folds Library memory into the baseline and makes
// every derived number wrong in the flattering direction.
describe("memory attribution", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.invoke.mockReset();
    mocks.recordRuntimeHealthEvent.mockReset();
    mocks.setRuntimeMemory.mockReset();
    mocks.warn.mockReset();
    stopMemoryMonitor();
    resetMemoryAttributionForTests();
  });

  it("starts with no baseline", () => {
    expect(getPreLibraryBaselineBytes()).toBeUndefined();
  });

  it("treats Library readiness as a one-way door", () => {
    recordLibraryRuntimeReady();
    recordLibraryRuntimeReady();
    // Idempotent: a second call must not reopen the window by resetting state.
    expect(getPreLibraryBaselineBytes()).toBeUndefined();
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledWith({
      event: "memory_library_runtime_ready",
      preLibraryBaselineMainRendererResidentBytes: undefined,
      preLibraryBaselineMainRendererProcessId: undefined,
      preLibraryBaselineMainRendererStartedAtUnixSeconds: undefined,
      preLibraryBaselineMainRendererStartedAtUnixMicros: undefined,
      preLibraryBaselineCaptured: false,
    });
  });

  it("captures one rooted main-renderer sample before Library load", async () => {
    mocks.invoke.mockResolvedValue(nativeSample(41, 192 * MIB));

    await expect(capturePreLibraryMemoryBaseline()).resolves.toBe(true);

    expect(mocks.invoke).toHaveBeenCalledWith("get_runtime_memory_stats", {
      includeStorageSizes: false,
      preciseWebkitAttribution: true,
    });
    expect(getPreLibraryBaselineBytes()).toBe(192 * MIB);
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "memory_pre_library_baseline",
        mainRendererProcessId: 41,
        mainRendererStartedAtUnixSeconds: 1_783_000_000,
        mainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        mainRendererResidentBytes: 192 * MIB,
      }),
    );
  });

  it("rejects a sample that completes after Library load starts", async () => {
    let resolveSample:
      | ((value: ReturnType<typeof nativeSample>) => void)
      | undefined;
    mocks.invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveSample = resolve;
      }),
    );

    const capture = capturePreLibraryMemoryBaseline();
    recordLibraryRuntimeLoadStarted();
    resolveSample?.(nativeSample(41, 192 * MIB));

    await expect(capture).resolves.toBe(false);
    expect(getPreLibraryBaselineBytes()).toBeUndefined();
  });

  it("does not compare a replacement renderer with the launch baseline", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await capturePreLibraryMemoryBaseline();
    recordLibraryRuntimeLoadStarted();
    recordLibraryRuntimeReady();
    mocks.invoke.mockResolvedValue(nativeSample(42, 180 * MIB));

    startMemoryMonitor();
    await flushPromises();

    expect(mocks.setRuntimeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        preLibraryBaselineMainRendererProcessId: 41,
        preLibraryBaselineMainRendererStartedAtUnixSeconds: 1_783_000_000,
        preLibraryBaselineMainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        preLibraryBaselineMainRendererResidentBytes: 100 * MIB,
        mainRendererResidentOverPreLibraryBaselineBytes: undefined,
        preLibraryBaselineComparisonStatus: "process_unavailable",
      }),
    );
    stopMemoryMonitor();
  });

  it("does not compare a recycled PID with the launch baseline", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await capturePreLibraryMemoryBaseline();
    recordLibraryRuntimeLoadStarted();
    recordLibraryRuntimeReady();
    mocks.invoke.mockResolvedValue(
      nativeSample(
        41,
        180 * MIB,
        1_783_000_100,
        1_783_000_100_500_000,
      ),
    );

    startMemoryMonitor();
    await flushPromises();

    expect(mocks.setRuntimeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        preLibraryBaselineMainRendererProcessId: 41,
        mainRendererResidentOverPreLibraryBaselineBytes: undefined,
        preLibraryBaselineComparisonStatus: "process_unavailable",
      }),
    );
    stopMemoryMonitor();
  });

  it("measures growth only for the same renderer PID and start time", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await capturePreLibraryMemoryBaseline();
    recordLibraryRuntimeLoadStarted();
    recordLibraryRuntimeReady();
    mocks.invoke.mockResolvedValue(nativeSample(41, 180 * MIB));

    startMemoryMonitor();
    await flushPromises();

    expect(mocks.setRuntimeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        preLibraryBaselineMainRendererProcessId: 41,
        preLibraryBaselineMainRendererStartedAtUnixSeconds: 1_783_000_000,
        preLibraryBaselineMainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        mainRendererResidentOverPreLibraryBaselineBytes: 80 * MIB,
        preLibraryBaselineComparisonStatus: "same_process",
      }),
    );
    stopMemoryMonitor();
  });

  it("rejects ambiguous or age-matched-only baseline candidates", async () => {
    const first = nativeSample(41, 100 * MIB);
    mocks.invoke.mockResolvedValueOnce({
      ...first,
      webkitAttributionPrecise: false,
      webkitProcesses: [
        {
          ...first.webkitProcesses[0],
          role: "freed-webcontent-age-matched",
        },
        {
          ...first.webkitProcesses[0],
          processId: 42,
          role: "freed-webcontent-age-matched",
        },
      ],
    });
    await expect(capturePreLibraryMemoryBaseline()).resolves.toBe(false);

    mocks.invoke.mockResolvedValueOnce({
      ...first,
      webkitProcesses: [
        first.webkitProcesses[0],
        { ...first.webkitProcesses[0], processId: 42 },
      ],
    });
    await expect(capturePreLibraryMemoryBaseline()).resolves.toBe(false);

    expect(getPreLibraryBaselineBytes()).toBeUndefined();
    expect(mocks.recordRuntimeHealthEvent).not.toHaveBeenCalled();
  });

  it("clears state for tests so runs do not leak into each other", () => {
    recordLibraryRuntimeReady();
    resetMemoryAttributionForTests();
    expect(getPreLibraryBaselineBytes()).toBeUndefined();
  });
});
