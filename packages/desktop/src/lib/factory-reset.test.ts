import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginFactoryResetCloudCleanup,
  captureFactoryResetWriteEpoch,
  clearFactoryResetCloudCleanupBarrier,
  hasFactoryResetCloudCleanupBarrier,
  isFactoryResetWriteAllowed,
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
  runFactoryResetWithRecovery,
  trackFactoryResetSensitiveOperation,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";

afterEach(() => {
  vi.restoreAllMocks();
  clearFactoryResetCloudCleanupBarrier();
  resetFactoryResetStateForTests();
  vi.useRealTimers();
});

function operations(overrides: Partial<Parameters<typeof runFactoryResetOperations>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    input: {
      quiesceLocalWriters: [vi.fn(async () => {
        calls.push("quiesce");
      })],
      clearDeviceStores: vi.fn(() => {
        calls.push("device-stores");
        return [true, true];
      }),
      clearLocalSettings: [vi.fn(() => {
        calls.push("local-settings");
      })],
      clearLocalData: [vi.fn(async () => {
        calls.push("local-data");
      })],
      clearProviderDataAndConnections: vi.fn(async () => {
        calls.push("providers");
      }),
      clearDocument: vi.fn(async () => {
        calls.push("document");
      }),
      ...overrides,
    },
  };
}

describe("factory reset sequencing", () => {
  it("clears every local surface in a stable destructive order", async () => {
    const reset = operations();

    await runFactoryResetOperations(reset.input);

    expect(reset.calls).toEqual([
      "quiesce",
      "device-stores",
      "local-settings",
      "local-data",
      "providers",
      "document",
    ]);
  });

  it("settles every writer drain before stopping a failed reset", async () => {
    const laterDrain = vi.fn(async () => undefined);
    const reset = operations({
      quiesceLocalWriters: [
        async () => {
          throw new Error("writer drain failed");
        },
        laterDrain,
      ],
    });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "writer drain failed",
    );
    expect(laterDrain).toHaveBeenCalledOnce();
    expect(reset.input.clearDeviceStores).not.toHaveBeenCalled();
    expect(reset.input.clearLocalData[0]).not.toHaveBeenCalled();
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
  });

  it("treats tracked operation rejection as settled before destructive phases", async () => {
    let rejectWrite!: (error: Error) => void;
    const tracked = trackFactoryResetSensitiveOperation(
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );
    void tracked.catch(() => undefined);
    const reset = operations();
    const resetting = runFactoryResetOperations(reset.input);
    await Promise.resolve();
    expect(reset.input.clearDeviceStores).not.toHaveBeenCalled();

    rejectWrite(new Error("expected cancellation"));
    await resetting;

    expect(reset.input.clearDeviceStores).toHaveBeenCalledOnce();
    expect(reset.input.clearDocument).toHaveBeenCalledOnce();
  });

  it("continues after the reset boundary cancels tracked work before its first microtask", async () => {
    const epoch = captureFactoryResetWriteEpoch();
    const canceled = trackFactoryResetSensitiveOperation(
      Promise.resolve().then(() => {
        if (!isFactoryResetWriteAllowed(epoch)) {
          throw new Error("factory reset canceled the queued operation");
        }
      }),
    );
    void canceled.catch(() => undefined);
    const reset = operations();

    await runFactoryResetOperations(reset.input);

    expect(reset.input.clearDeviceStores).toHaveBeenCalledOnce();
    expect(reset.input.clearDocument).toHaveBeenCalledOnce();
  });

  it("stops before destructive work when a device store cannot persist reset state", async () => {
    const reset = operations({ clearDeviceStores: () => [true, false] });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "One or more device stores could not be cleared.",
    );
    expect(reset.input.clearLocalSettings[0]).not.toHaveBeenCalled();
    expect(reset.input.clearLocalData[0]).not.toHaveBeenCalled();
    expect(reset.input.clearProviderDataAndConnections).not.toHaveBeenCalled();
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
  });

  it("does not delete cloud data, disconnect providers, or delete the document after local cleanup fails", async () => {
    const reset = operations({
      clearLocalData: [async () => {
        throw new Error("local deletion failed");
      }],
    });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "local deletion failed",
    );
    expect(reset.input.clearProviderDataAndConnections).not.toHaveBeenCalled();
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
  });

  it("settles every local cleanup before reporting a failure", async () => {
    const laterSetting = vi.fn();
    const laterData = vi.fn(async () => undefined);
    const reset = operations({
      clearLocalSettings: [
        () => {
          throw new Error("setting deletion failed");
        },
        laterSetting,
      ],
      clearLocalData: [
        async () => {
          throw new Error("data deletion failed");
        },
        laterData,
      ],
    });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "setting deletion failed",
    );
    expect(laterSetting).toHaveBeenCalledOnce();
    expect(laterData).not.toHaveBeenCalled();
  });

  it("settles parallel local data cleanup before reporting a failure", async () => {
    const laterData = vi.fn(async () => undefined);
    const reset = operations({
      clearLocalData: [
        async () => {
          throw new Error("data deletion failed");
        },
        laterData,
      ],
    });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "data deletion failed",
    );
    expect(laterData).toHaveBeenCalledOnce();
    expect(reset.input.clearProviderDataAndConnections).not.toHaveBeenCalled();
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
  });

  it("does not delete the document after provider cleanup fails", async () => {
    const reset = operations({
      clearProviderDataAndConnections: async () => {
        throw new Error("provider disconnect failed");
      },
    });

    await expect(runFactoryResetOperations(reset.input)).rejects.toThrow(
      "provider disconnect failed",
    );
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
  });
});

describe("factory reset runtime recovery", () => {
  it("treats an unrecognized cleanup barrier value as blocking", () => {
    localStorage.setItem("freed_factory_reset_cloud_cleanup_pending", "future-version");

    expect(hasFactoryResetCloudCleanupBarrier()).toBe(true);
  });

  it("keeps cloud startup blocked when the cleanup barrier cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(hasFactoryResetCloudCleanupBarrier()).toBe(true);
  });

  it("fails a hung writer drain within its reset deadline", async () => {
    vi.useFakeTimers();
    const pending = new Promise<void>(() => undefined);
    const draining = waitForFactoryResetDrain(
      () => [pending],
      "Content fetcher",
      1_500,
    );
    const rejection = expect(draining).rejects.toThrow(
      "Content fetcher did not stop within 1,500 ms.",
    );

    await vi.advanceTimersByTimeAsync(1_500);
    await rejection;
  });

  it("reloads once on success without scheduling a recovery reload", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const onFailure = vi.fn();

    await runFactoryResetWithRecovery({
      reset: async () => undefined,
      reload,
      onFailure,
      recoveryDelayMs: 1_500,
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reports a failed reset before scheduling a recovery reload", async () => {
    vi.useFakeTimers();
    const error = new Error("reset failed");
    const reload = vi.fn();
    const onFailure = vi.fn();

    await expect(runFactoryResetWithRecovery({
      reset: async () => {
        throw error;
      },
      reload,
      onFailure,
      recoveryDelayMs: 1_500,
    })).rejects.toBe(error);

    expect(onFailure).toHaveBeenCalledWith(error);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps cloud startup blocked when provider cleanup resolves after its phase timed out", async () => {
    vi.useFakeTimers();
    let finishProviderCleanup!: () => void;
    const providerCleanup = new Promise<void>((resolve) => {
      finishProviderCleanup = resolve;
    });
    const reload = vi.fn();
    const reset = operations({
      phaseTimeoutMs: 50,
      clearProviderDataAndConnections: async () => {
        beginFactoryResetCloudCleanup();
        await providerCleanup;
      },
    });

    const resetting = runFactoryResetWithRecovery({
      reset: async () => {
        await runFactoryResetOperations(reset.input);
        clearFactoryResetCloudCleanupBarrier();
      },
      reload,
      onFailure: vi.fn(),
      recoveryDelayMs: 25,
    });
    const rejection = expect(resetting).rejects.toMatchObject({
      phase: "clear provider data and connections",
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(hasFactoryResetCloudCleanupBarrier()).toBe(true);

    finishProviderCleanup();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    expect(reload).toHaveBeenCalledOnce();
    expect(reset.input.clearDocument).not.toHaveBeenCalled();
    expect(hasFactoryResetCloudCleanupBarrier()).toBe(true);
  });

  it("lifts the cloud cleanup barrier only after the full reset succeeds", async () => {
    const reset = operations({
      clearProviderDataAndConnections: async () => {
        beginFactoryResetCloudCleanup();
      },
    });

    await runFactoryResetOperations(reset.input);
    expect(hasFactoryResetCloudCleanupBarrier()).toBe(true);

    clearFactoryResetCloudCleanupBarrier();
    expect(hasFactoryResetCloudCleanupBarrier()).toBe(false);
    expect(reset.input.clearDocument).toHaveBeenCalledOnce();
  });
});
