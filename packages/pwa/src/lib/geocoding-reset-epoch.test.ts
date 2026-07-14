import { afterEach, describe, expect, it, vi } from "vitest";

const geocodingCache = vi.hoisted(() => ({
  getFromCache: vi.fn(async () => undefined),
  saveToCache: vi.fn(async () => undefined),
}));

vi.mock("@freed/ui/lib/geocoding-cache", () => geocodingCache);

import { geocode } from "@freed/ui/lib/geocoding";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

function runEmptyReset(): Promise<void> {
  return runFactoryResetOperations({
    quiesceLocalWriters: [],
    clearDeviceStores: () => [],
    clearLocalSettings: [],
    clearLocalData: [],
    clearProviderDataAndConnections: async () => undefined,
    clearDocument: async () => undefined,
  });
}

describe("geocoding factory reset epoch", () => {
  afterEach(() => {
    resetFactoryResetStateForTests();
    geocodingCache.getFromCache.mockClear();
    geocodingCache.saveToCache.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not cache a geocode response that finishes after reset starts", async () => {
    let finishFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const geocoding = geocode("Reset Epoch Place");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const reset = runEmptyReset();
    finishFetch(new Response(JSON.stringify([
      {
        lat: "45.523",
        lon: "-122.676",
        display_name: "Reset Epoch Place",
      },
    ])));

    await expect(geocoding).resolves.toMatchObject({
      latitude: 45.523,
      longitude: -122.676,
    });
    await reset;
    expect(geocodingCache.saveToCache).not.toHaveBeenCalled();
  });

  it("does not start geocoding work after reset begins", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await runEmptyReset();

    await expect(geocode("Blocked Reset Place")).resolves.toBeNull();
    expect(geocodingCache.getFromCache).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
