import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./scraper-prefs", () => ({
  getFbScraperWindowMode: () => "hidden",
  getIgScraperWindowMode: () => "hidden",
}));

import { fetchFacebookComments } from "./social-comment-hydration";

describe("social comment hydration factory reset boundary", () => {
  beforeEach(() => {
    resetFactoryResetStateForTests();
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
  });

  it("does not invoke Facebook when reset begins during listener registration", async () => {
    let finishListen!: (unlisten: () => void) => void;
    mocks.listen.mockImplementation(
      () => new Promise<() => void>((resolve) => {
        finishListen = resolve;
      }),
    );
    const request = fetchFacebookComments("https://www.facebook.com/posts/123");
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());

    const clearDocument = vi.fn(async () => undefined);
    const reset = runFactoryResetOperations({
      quiesceLocalWriters: [],
      clearDeviceStores: () => [],
      clearLocalSettings: [],
      clearLocalData: [],
      clearProviderDataAndConnections: async () => undefined,
      clearDocument,
    });
    finishListen(vi.fn());

    await expect(request).rejects.toThrow("Factory reset is in progress");
    await reset;

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(clearDocument).toHaveBeenCalledOnce();
  });
});
