import { generateDemoLibraryData, DEMO_POPULATION_COUNTS } from "@freed/shared";
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
      expect(data.feeds).toHaveLength(DEMO_POPULATION_COUNTS.feeds);
      expect(data.items).toHaveLength(DEMO_POPULATION_COUNTS.items);
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

  it("uses the full curated demo with a fresh seed for every sample population", async () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementationOnce(array => { (array as Uint32Array)[0] = 42; return array; })
      .mockImplementationOnce(array => { (array as Uint32Array)[0] = 123; return array; });
    const addSampleLibraryData = vi.fn(async () => undefined);
    const actions = { initialize: vi.fn(async () => undefined), isInitialized: true, addSampleLibraryData };
    try {
      await refreshSampleLibraryData(actions);
      await refreshSampleLibraryData(actions);
      const batches = addSampleLibraryData.mock.calls as unknown as [ReturnType<typeof generateDemoLibraryData>][];
      const first = batches[0]![0];
      const second = batches[1]![0];
      expect(first.items).toHaveLength(DEMO_POPULATION_COUNTS.items);
      expect(first.feeds.every(feed => !feed.enabled)).toBe(true);
      expect(first.persons.filter(person => person.relationshipStatus === "friend").length).toBe(Math.round(first.persons.length * 0.15));
      expect(first.items.every(item => item.content.mediaUrls?.[0]?.startsWith("https://"))).toBe(true);
      expect(first.items.map(item => item.content.text)).not.toEqual(second.items.map(item => item.content.text));
      expect(first.items[0]!.sampleDataFingerprint?.batchId).not.toBe(second.items[0]!.sampleDataFingerprint?.batchId);
    } finally { random.mockRestore(); }
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
        `Sample data added: 100%. ${DEMO_POPULATION_COUNTS.feeds.toLocaleString()} feeds, ${DEMO_POPULATION_COUNTS.items.toLocaleString()} items, ${DEMO_POPULATION_COUNTS.persons.toLocaleString()} people, and ${DEMO_POPULATION_COUNTS.accounts.toLocaleString()} social identities.`,
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
