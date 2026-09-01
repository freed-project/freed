import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSampleLibraryDataWithProgressToast,
  formatSampleDataClearProgress,
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

  it("formats a locale-aware clear progress label", () => {
    expect(
      formatSampleDataClearProgress({ percent: 80, phase: "items" }),
    ).toBe("Removing items: 80%");
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

  it("updates one persistent toast while sample data is cleared", async () => {
    const onProgress = vi.fn();
    const clearSampleData = vi.fn(async (listener) => {
      listener?.({ percent: 40, phase: "accounts" });
      listener?.({ percent: 90, phase: "settling" });
      listener?.({ percent: 100, phase: "complete" });
      return { accounts: 3, feeds: 2, items: 4, persons: 1, total: 10 };
    });

    await expect(
      clearSampleLibraryDataWithProgressToast({ clearSampleData, onProgress }),
    ).resolves.toEqual({
      accounts: 3,
      feeds: 2,
      items: 4,
      persons: 1,
      total: 10,
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      message:
        "Sample data cleared: 100%. 2 feeds, 4 items, 1 person, and 3 accounts.",
      type: "success",
    });
  });
});
