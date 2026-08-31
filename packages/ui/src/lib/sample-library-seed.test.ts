import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSampleDataImportProgress,
  populateSampleLibraryDataWithProgressToast,
  refreshSampleLibraryData,
} from "./sample-library-seed";
import { useToastStore } from "../components/Toast";

describe("sample Library seeding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards durable progress from the platform import", async () => {
    const initialize = vi.fn(async () => undefined);
    const onProgress = vi.fn();
    const addSampleLibraryData = vi.fn(async (data, listener) => {
      expect(data.feeds).toHaveLength(15);
      expect(data.items).toHaveLength(1_701);
      listener?.({ percent: 40, phase: "items" });
    });
    const seedSocialConnections = vi.fn();

    await refreshSampleLibraryData({
      addSampleLibraryData,
      initialize,
      isInitialized: false,
      onProgress,
      seedSocialConnections,
    });

    expect(initialize).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      percent: 0,
      phase: "preparing",
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      percent: 40,
      phase: "items",
    });
    expect(seedSocialConnections).toHaveBeenCalledOnce();
  });

  it("formats a locale-aware progress label", () => {
    expect(
      formatSampleDataImportProgress({ percent: 70, phase: "accounts" }),
    ).toBe("Adding social identities: 70%");
  });

  it("updates one persistent toast through successful completion", async () => {
    const addSampleLibraryData = vi.fn(async (_data, listener) => {
      listener?.({ percent: 50, phase: "people" });
      listener?.({ percent: 100, phase: "finalizing" });
    });

    await populateSampleLibraryDataWithProgressToast({
      addSampleLibraryData,
      initialize: vi.fn(async () => undefined),
      isInitialized: true,
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      message:
        "Sample data added: 100%. 15 feeds, 1,701 items, 250 friends, and 1,500 social identities.",
      type: "success",
    });
  });
});
