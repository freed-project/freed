import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runFactoryResetOperations,
  runFactoryResetWithRecovery,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";

afterEach(() => {
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
});
