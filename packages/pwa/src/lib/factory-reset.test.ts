import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
  trackFactoryResetSensitiveOperation,
  type FactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

function never<T = void>(): Promise<T> {
  return new Promise(() => undefined);
}

function operations(
  overrides: Partial<FactoryResetOperations> = {},
): FactoryResetOperations {
  return {
    quiesceLocalWriters: [],
    clearDeviceStores: () => [true],
    clearLocalSettings: [],
    clearLocalData: [],
    clearProviderDataAndConnections: async () => undefined,
    clearDocument: async () => undefined,
    phaseTimeoutMs: 50,
    ...overrides,
  };
}

afterEach(() => {
  resetFactoryResetStateForTests();
  vi.useRealTimers();
});

describe("shared factory reset phase bounds", () => {
  it.each([
    {
      label: "quiesce local writers",
      override: { quiesceLocalWriters: [never] },
    },
    {
      label: "clear device stores",
      override: { clearDeviceStores: never },
    },
    {
      label: "clear local settings",
      override: { clearLocalSettings: [never] },
    },
    {
      label: "clear local data",
      override: { clearLocalData: [never] },
    },
    {
      label: "clear provider data and connections",
      override: { clearProviderDataAndConnections: never },
    },
    {
      label: "clear document",
      override: { clearDocument: never },
    },
  ] satisfies Array<{
    label: string;
    override: Partial<FactoryResetOperations>;
  }>)('rejects when the "$label" phase never settles', async ({ label, override }) => {
    vi.useFakeTimers();
    const reset = runFactoryResetOperations(operations(override));
    const rejection = expect(reset).rejects.toThrow(
      `Factory reset phase "${label}" did not finish within 50 ms.`,
    );

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("drains tracked device-local work before destructive clearing", async () => {
    let finishWrite!: () => void;
    const pendingWrite = trackFactoryResetSensitiveOperation(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const clearLocalData = vi.fn(async () => undefined);
    const clearDocument = vi.fn(async () => undefined);

    const reset = runFactoryResetOperations(operations({
      clearLocalData: [clearLocalData],
      clearDocument,
    }));
    await Promise.resolve();
    expect(clearLocalData).not.toHaveBeenCalled();

    finishWrite();
    await pendingWrite;
    await reset;

    expect(clearLocalData).toHaveBeenCalledOnce();
    expect(clearDocument).toHaveBeenCalledOnce();
  });
});
