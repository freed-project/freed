import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  clearPlatformUA: vi.fn(),
  getPlatformUA: vi.fn(() => "Freed Test UA"),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./user-agent", () => ({
  clearPlatformUA: mocks.clearPlatformUA,
  getPlatformUA: mocks.getPlatformUA,
}));

import {
  checkSubstackAuth,
  disconnectSubstack,
  disconnectSubstackForFactoryReset,
  initSubstackAuth,
  showSubstackLogin,
  storeSubstackAuthState,
} from "./substack-auth";
import {
  checkMediumAuth,
  disconnectMedium,
  disconnectMediumForFactoryReset,
  initMediumAuth,
  storeMediumAuthState,
} from "./medium-auth";
import {
  quiesceDesktopProviderAuthForFactoryReset,
  resetDesktopProviderAuthLifecycleForTests,
} from "./provider-auth-lifecycle";

beforeEach(() => {
  resetDesktopProviderAuthLifecycleForTests();
  localStorage.clear();
  mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.listen.mockReset();
  mocks.unlisten.mockReset();
  mocks.clearPlatformUA.mockReset();
  mocks.getPlatformUA.mockClear();
});

afterEach(() => {
  resetDesktopProviderAuthLifecycleForTests();
});

describe("authenticated essay auth", () => {
  it("reuses the persisted browser identity when reopening login", async () => {
    await showSubstackLogin();
    await showSubstackLogin();

    expect(mocks.getPlatformUA).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "substack_show_login", {
      userAgent: "Freed Test UA",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "substack_show_login", {
      userAgent: "Freed Test UA",
    });
  });

  it("persists independent Substack and Medium sessions", () => {
    storeSubstackAuthState({
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      captureCooldownUntil: 250,
    });
    storeMediumAuthState({
      isAuthenticated: true,
      lastCheckedAt: 300,
      lastCaptureError: "Needs attention",
      captureCooldownUntil: 350,
    });

    expect(initSubstackAuth()).toEqual({
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      captureCooldownUntil: 250,
    });
    expect(initMediumAuth()).toEqual({
      isAuthenticated: true,
      lastCheckedAt: 300,
      lastCaptureError: "The last provider sync failed.",
      captureCooldownUntil: 350,
    });
  });

  it("installs the auth listener before invoking the hidden check", async () => {
    const order: string[] = [];
    let listener: ((event: { payload: { loggedIn: boolean } }) => void) | null = null;
    mocks.listen.mockImplementation(async (eventName, callback) => {
      order.push(`listen:${String(eventName)}`);
      listener = callback;
      return mocks.unlisten;
    });
    mocks.invoke.mockImplementation(async (command) => {
      order.push(`invoke:${String(command)}`);
      listener?.({ payload: { loggedIn: true } });
      return true;
    });

    await expect(checkSubstackAuth()).resolves.toBe(true);
    expect(order).toEqual([
      "listen:substack-auth-result",
      "invoke:substack_check_auth",
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("substack_check_auth", {
      userAgent: "Freed Test UA",
    });
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("disconnect clears native and local auth state", async () => {
    storeSubstackAuthState({ isAuthenticated: true });
    storeMediumAuthState({ isAuthenticated: true });
    localStorage.setItem("freed.capture-cooldown.substack", "9999999999998");
    localStorage.setItem("freed.capture-cooldown.medium", "9999999999999");

    await disconnectSubstack();
    await disconnectMedium();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "substack_disconnect");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "medium_disconnect");
    expect(initSubstackAuth()).toEqual({ isAuthenticated: false });
    expect(initMediumAuth()).toEqual({ isAuthenticated: false });
    expect(localStorage.getItem("freed.capture-cooldown.substack")).toBe("9999999999998");
    expect(localStorage.getItem("freed.capture-cooldown.medium")).toBe("9999999999999");
    expect(mocks.clearPlatformUA).toHaveBeenCalledWith("substack");
    expect(mocks.clearPlatformUA).toHaveBeenCalledWith("medium");
  });

  it("clears local auth even when native browsing-data cleanup fails", async () => {
    storeSubstackAuthState({ isAuthenticated: true });
    mocks.invoke.mockRejectedValueOnce(new Error("WebView cleanup failed"));

    await expect(disconnectSubstack()).rejects.toThrow("WebView cleanup failed");
    expect(initSubstackAuth()).toEqual({ isAuthenticated: false });
    expect(mocks.clearPlatformUA).toHaveBeenCalledWith("substack");
  });

  it("factory reset persists disconnected auth state without rotating provider identities", async () => {
    storeSubstackAuthState({
      isAuthenticated: true,
      lastCapturedAt: 200,
      pausedUntil: 300,
      pauseReason: "Provider cooldown",
      pauseLevel: 2,
    });
    storeMediumAuthState({
      isAuthenticated: true,
      lastCapturedAt: 400,
      captureCooldownUntil: 500,
    });

    await disconnectSubstackForFactoryReset();
    await disconnectMediumForFactoryReset();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "substack_disconnect");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "medium_disconnect");
    expect(initSubstackAuth()).toMatchObject({
      isAuthenticated: false,
      lastCheckedAt: expect.any(Number),
      lastCapturedAt: 200,
      pausedUntil: 300,
      pauseReason: "Provider work is temporarily paused.",
      pauseLevel: 2,
    });
    expect(initMediumAuth()).toMatchObject({
      isAuthenticated: false,
      lastCheckedAt: expect.any(Number),
      lastCapturedAt: 400,
      captureCooldownUntil: 500,
    });
    expect(mocks.clearPlatformUA).not.toHaveBeenCalled();
  });

  it("rejects late auth-state persistence once provider auth is quiesced", async () => {
    await quiesceDesktopProviderAuthForFactoryReset();

    storeSubstackAuthState({ isAuthenticated: true, lastCheckedAt: 100 });
    storeMediumAuthState({ isAuthenticated: true, lastCheckedAt: 200 });

    expect(initSubstackAuth()).toEqual({ isAuthenticated: false });
    expect(initMediumAuth()).toEqual({ isAuthenticated: false });
  });

  it("returns false when the Medium hidden auth check fails", async () => {
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.invoke.mockRejectedValue(new Error("window unavailable"));

    await expect(checkMediumAuth()).resolves.toBe(false);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
