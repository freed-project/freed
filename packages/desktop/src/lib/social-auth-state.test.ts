import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./user-agent", () => ({
  clearPlatformUA: vi.fn(),
  selectPlatformUA: vi.fn(() => "test-user-agent"),
}));
vi.mock("./automerge", () => ({
  getSavedYouTubeVideoUrls: vi.fn(async () => []),
}));
vi.mock("./runtime-health-events", () => ({
  recordRuntimeHealthEvent: vi.fn(),
}));

import {
  disconnectFbForFactoryReset,
  initFbAuth,
} from "./fb-auth";
import {
  disconnectIgForFactoryReset,
  initIgAuth,
} from "./instagram-auth";
import {
  disconnectLiForFactoryReset,
  initLiAuth,
} from "./li-auth";
import { readStoredSocialAuthState } from "./social-auth-transient-errors";
import { loadStoredCookies } from "./x-auth";
import {
  disconnectYouTubeForFactoryReset,
  initYouTubeAuth,
} from "./youtube-auth";

const SOCIAL_AUTH_KEYS = [
  "fb_auth_state",
  "ig_auth_state",
  "li_auth_state",
  "youtube_auth_state",
] as const;

describe("stored social auth state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads valid request history without discarding forward-compatible fields", () => {
    window.localStorage.setItem("fb_auth_state", JSON.stringify({
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      pausedUntil: 300,
      pauseReason: "cooldown",
      pauseLevel: 2,
      futureField: "ignored",
    }));

    expect(initFbAuth()).toEqual({
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      pausedUntil: 300,
      pauseReason: "cooldown",
      pauseLevel: 2,
    });
  });

  it("fails closed for truthy authentication values and malformed request history", () => {
    for (const key of SOCIAL_AUTH_KEYS) {
      window.localStorage.setItem(key, JSON.stringify({
        isAuthenticated: "true",
        pausedUntil: "tomorrow",
      }));
    }

    expect(initFbAuth()).toEqual({ isAuthenticated: false });
    expect(initIgAuth()).toEqual({ isAuthenticated: false });
    expect(initLiAuth()).toEqual({ isAuthenticated: false });
    expect(initYouTubeAuth()).toEqual({ isAuthenticated: false });
  });

  it("reports unavailable storage without treating it as an authenticated session", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(readStoredSocialAuthState("fb_auth_state")).toEqual({
      status: "unavailable",
    });
    expect(initFbAuth()).toEqual({ isAuthenticated: false });

    getItem.mockRestore();
  });

  it("preserves corrupt raw request history during factory reset", async () => {
    const corruptRaw = JSON.stringify({
      isAuthenticated: "true",
      pausedUntil: "unknown",
    });
    for (const key of SOCIAL_AUTH_KEYS) {
      window.localStorage.setItem(key, corruptRaw);
    }

    await Promise.all([
      disconnectFbForFactoryReset(),
      disconnectIgForFactoryReset(),
      disconnectLiForFactoryReset(),
      disconnectYouTubeForFactoryReset(),
    ]);

    for (const key of SOCIAL_AUTH_KEYS) {
      expect(window.localStorage.getItem(key)).toBe(corruptRaw);
    }
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("does not clear a native session before the disconnected state is durable", async () => {
    window.localStorage.setItem("fb_auth_state", JSON.stringify({
      isAuthenticated: true,
      lastCapturedAt: 200,
    }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await expect(disconnectFbForFactoryReset()).rejects.toThrow(
      "storage unavailable",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects non-string X cookie values", () => {
    window.localStorage.setItem("x_auth_cookies", JSON.stringify({
      ct0: 123,
      authToken: { value: "token" },
    }));

    expect(loadStoredCookies()).toBeNull();
  });
});
