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
  captureShellMemoryBaseline,
  getShellBaselineBytes,
  recordDocumentHydrated,
  recordDocumentHydrationStarted,
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
    relayDocBytes: 0,
    relayClientCount: 0,
  };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

// The contract this protects: the shell baseline is only meaningful if it is
// captured BEFORE the Automerge document is hydrated. Every floor estimate in
// the storage roadmap is derived by subtracting from an observed total, and the
// WebKit-plus-React shell is the largest term in that subtraction, estimated
// across four independent passes at anywhere from 60 to 250 MB. A baseline
// taken after hydration silently folds the document into the "shell" and makes
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
    expect(getShellBaselineBytes()).toBeUndefined();
  });

  it("treats hydration as a one-way door", () => {
    recordDocumentHydrated();
    recordDocumentHydrated();
    // Idempotent: a second call must not reopen the window by resetting state.
    expect(getShellBaselineBytes()).toBeUndefined();
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledWith({
      event: "memory_document_hydrated",
      shellBaselineMainRendererResidentBytes: undefined,
      shellBaselineMainRendererProcessId: undefined,
      shellBaselineMainRendererStartedAtUnixSeconds: undefined,
      shellBaselineMainRendererStartedAtUnixMicros: undefined,
      shellBaselineCaptured: false,
    });
  });

  it("captures one rooted main-renderer shell sample before hydration", async () => {
    mocks.invoke.mockResolvedValue(nativeSample(41, 192 * MIB));

    await expect(captureShellMemoryBaseline()).resolves.toBe(true);

    expect(mocks.invoke).toHaveBeenCalledWith("get_runtime_memory_stats", {
      includeStorageSizes: false,
      preciseWebkitAttribution: true,
    });
    expect(getShellBaselineBytes()).toBe(192 * MIB);
    expect(mocks.recordRuntimeHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "memory_shell_baseline",
        mainRendererProcessId: 41,
        mainRendererStartedAtUnixSeconds: 1_783_000_000,
        mainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        mainRendererResidentBytes: 192 * MIB,
      }),
    );
  });

  it("rejects a sample that completes after hydration starts", async () => {
    let resolveSample:
      | ((value: ReturnType<typeof nativeSample>) => void)
      | undefined;
    mocks.invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveSample = resolve;
      }),
    );

    const capture = captureShellMemoryBaseline();
    recordDocumentHydrationStarted();
    resolveSample?.(nativeSample(41, 192 * MIB));

    await expect(capture).resolves.toBe(false);
    expect(getShellBaselineBytes()).toBeUndefined();
  });

  it("does not compare a replacement renderer with the launch baseline", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await captureShellMemoryBaseline();
    recordDocumentHydrationStarted();
    recordDocumentHydrated();
    mocks.invoke.mockResolvedValue(nativeSample(42, 180 * MIB));

    startMemoryMonitor();
    await flushPromises();

    expect(mocks.setRuntimeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        shellBaselineMainRendererProcessId: 41,
        shellBaselineMainRendererStartedAtUnixSeconds: 1_783_000_000,
        shellBaselineMainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        shellBaselineMainRendererResidentBytes: 100 * MIB,
        mainRendererResidentOverShellBaselineBytes: undefined,
        shellBaselineComparisonStatus: "process_unavailable",
      }),
    );
    stopMemoryMonitor();
  });

  it("does not compare a recycled PID with the launch baseline", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await captureShellMemoryBaseline();
    recordDocumentHydrationStarted();
    recordDocumentHydrated();
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
        shellBaselineMainRendererProcessId: 41,
        mainRendererResidentOverShellBaselineBytes: undefined,
        shellBaselineComparisonStatus: "process_unavailable",
      }),
    );
    stopMemoryMonitor();
  });

  it("measures growth only for the same renderer PID and start time", async () => {
    mocks.invoke.mockResolvedValueOnce(nativeSample(41, 100 * MIB));
    await captureShellMemoryBaseline();
    recordDocumentHydrationStarted();
    recordDocumentHydrated();
    mocks.invoke.mockResolvedValue(nativeSample(41, 180 * MIB));

    startMemoryMonitor();
    await flushPromises();

    expect(mocks.setRuntimeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        shellBaselineMainRendererProcessId: 41,
        shellBaselineMainRendererStartedAtUnixSeconds: 1_783_000_000,
        shellBaselineMainRendererStartedAtUnixMicros: 1_783_000_000_500_000,
        mainRendererResidentOverShellBaselineBytes: 80 * MIB,
        shellBaselineComparisonStatus: "same_process",
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
    await expect(captureShellMemoryBaseline()).resolves.toBe(false);

    mocks.invoke.mockResolvedValueOnce({
      ...first,
      webkitProcesses: [
        first.webkitProcesses[0],
        { ...first.webkitProcesses[0], processId: 42 },
      ],
    });
    await expect(captureShellMemoryBaseline()).resolves.toBe(false);

    expect(getShellBaselineBytes()).toBeUndefined();
    expect(mocks.recordRuntimeHealthEvent).not.toHaveBeenCalled();
  });

  it("clears state for tests so runs do not leak into each other", () => {
    recordDocumentHydrated();
    resetMemoryAttributionForTests();
    expect(getShellBaselineBytes()).toBeUndefined();
  });
});
