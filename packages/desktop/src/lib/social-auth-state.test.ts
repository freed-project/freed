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
  storeFbAuthState,
} from "./fb-auth";
import {
  disconnectIgForFactoryReset,
  initIgAuth,
  storeIgAuthState,
} from "./instagram-auth";
import {
  disconnectLiForFactoryReset,
  initLiAuth,
  storeLiAuthState,
} from "./li-auth";
import { storeMediumAuthState } from "./medium-auth";
import { storeSubstackAuthState } from "./substack-auth";
import { readStoredSocialAuthState } from "./social-auth-transient-errors";
import { loadStoredCookies } from "./x-auth";
import {
  disconnectYouTubeForFactoryReset,
  initYouTubeAuth,
  storeYouTubeAuthState,
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

  it("loads valid request history and removes fields outside the storage boundary", () => {
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
      pauseReason: "Provider work is temporarily paused.",
      pauseLevel: 2,
    });
    expect(JSON.parse(window.localStorage.getItem("fb_auth_state") ?? "{}"))
      .not.toHaveProperty("futureField");
  });

  it("stores controlled failure summaries instead of raw provider or OAuth errors", () => {
    const state = {
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      lastCaptureError:
        "Google token proxy failed: access_token=oauth-secret-value user@example.com",
      pausedUntil: 300,
      pauseReason: "Bearer provider-secret-value",
      pauseLevel: 2 as const,
    };

    storeFbAuthState(state);
    storeIgAuthState(state);
    storeLiAuthState(state);
    storeYouTubeAuthState(state);
    storeMediumAuthState({ ...state, captureCooldownUntil: 400 });
    storeSubstackAuthState({ ...state, captureCooldownUntil: 500 });

    for (const key of [
      "fb_auth_state",
      "ig_auth_state",
      "li_auth_state",
      "youtube_auth_state",
      "medium_auth_state",
      "substack_auth_state",
    ]) {
      const raw = window.localStorage.getItem(key) ?? "";
      const stored = JSON.parse(raw) as Record<string, unknown>;
      expect(raw).not.toContain("oauth-secret-value");
      expect(raw).not.toContain("provider-secret-value");
      expect(raw).not.toContain("user@example.com");
      expect(stored).toMatchObject({
        isAuthenticated: true,
        lastCheckedAt: 100,
        lastCapturedAt: 200,
        lastCaptureError: "Provider authentication needs attention.",
        pausedUntil: 300,
        pauseReason: "Provider work is temporarily paused.",
        pauseLevel: 2,
      });
    }
    expect(JSON.parse(window.localStorage.getItem("medium_auth_state") ?? "{}"))
      .toMatchObject({ captureCooldownUntil: 400 });
    expect(JSON.parse(window.localStorage.getItem("substack_auth_state") ?? "{}"))
      .toMatchObject({ captureCooldownUntil: 500 });
  });

  it("sanitizes legacy pause details during factory reset", async () => {
    const legacy = {
      isAuthenticated: true,
      lastCapturedAt: 200,
      lastCaptureError: "access_token=legacy-token",
      pausedUntil: 300,
      pauseReason: "Bearer legacy-provider-secret user@example.com",
      pauseLevel: 2,
      futureField: "preserved",
    };
    for (const key of SOCIAL_AUTH_KEYS) {
      window.localStorage.setItem(key, JSON.stringify(legacy));
    }

    await Promise.all([
      disconnectFbForFactoryReset(),
      disconnectIgForFactoryReset(),
      disconnectLiForFactoryReset(),
      disconnectYouTubeForFactoryReset(),
    ]);

    for (const key of SOCIAL_AUTH_KEYS) {
      const raw = window.localStorage.getItem(key) ?? "";
      expect(raw).not.toContain("legacy-token");
      expect(raw).not.toContain("legacy-provider-secret");
      expect(raw).not.toContain("user@example.com");
      expect(JSON.parse(raw)).toMatchObject({
        isAuthenticated: false,
        lastCapturedAt: 200,
        pausedUntil: 300,
        pauseReason: "Provider work is temporarily paused.",
        pauseLevel: 2,
      });
      expect(JSON.parse(raw)).not.toHaveProperty("futureField");
    }
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

  it("replaces corrupt auth state with a safe disconnected record during factory reset", async () => {
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
      expect(JSON.parse(window.localStorage.getItem(key) ?? "{}")).toMatchObject({
        isAuthenticated: false,
        lastCheckedAt: expect.any(Number),
      });
      expect(window.localStorage.getItem(key)).not.toContain("unknown");
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
