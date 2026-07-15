import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearPlatformUA, invoke } = vi.hoisted(() => ({
  clearPlatformUA: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./user-agent", () => ({
  clearPlatformUA,
  selectPlatformUA: vi.fn(),
}));
vi.mock("./automerge", () => ({
  getSavedYouTubeVideoUrls: vi.fn(async () => []),
}));
vi.mock("./runtime-health-events", () => ({ recordRuntimeHealthEvent: vi.fn() }));

import { disconnectFb, disconnectFbForFactoryReset } from "./fb-auth";
import { disconnectIg, disconnectIgForFactoryReset } from "./instagram-auth";
import { disconnectLi, disconnectLiForFactoryReset } from "./li-auth";
import { disconnectYouTubeForFactoryReset } from "./youtube-auth";

describe("provider factory reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPlatformUA.mockReset();
    invoke.mockReset().mockResolvedValue(undefined);
  });

  it("keeps normal disconnect behavior clearing persisted provider user agents", async () => {
    await Promise.all([
      disconnectFb(),
      disconnectIg(),
      disconnectLi(),
    ]);

    expect(invoke).toHaveBeenCalledWith("fb_disconnect");
    expect(invoke).toHaveBeenCalledWith("ig_disconnect");
    expect(invoke).toHaveBeenCalledWith("li_disconnect");
    expect(clearPlatformUA).toHaveBeenCalledWith("facebook");
    expect(clearPlatformUA).toHaveBeenCalledWith("instagram");
    expect(clearPlatformUA).toHaveBeenCalledWith("linkedin");
  });

  it("clears native sessions while preserving identity, request history, and receipts", async () => {
    const history = {
      isAuthenticated: true,
      lastCheckedAt: 100,
      lastCapturedAt: 200,
      lastCaptureError: "transient auth error",
      pausedUntil: 300,
      pauseReason: "cooldown",
      pauseLevel: 2,
      futureField: "preserved",
    };
    window.localStorage.setItem("fb_auth_state", JSON.stringify(history));
    window.localStorage.setItem("ig_auth_state", JSON.stringify(history));
    window.localStorage.setItem("li_auth_state", JSON.stringify(history));
    window.localStorage.setItem("youtube_auth_state", JSON.stringify(history));
    const playlist = JSON.stringify({
      playlistId: "PL12345678",
      playlistUrl: "https://www.youtube.com/playlist?list=PL12345678",
      syncedVideoIds: ["12345678901"],
    });
    window.localStorage.setItem("youtube_offline_playlist_state", playlist);

    await disconnectFbForFactoryReset();
    await disconnectIgForFactoryReset();
    await disconnectLiForFactoryReset();
    await disconnectYouTubeForFactoryReset();

    expect(invoke).toHaveBeenCalledWith("fb_disconnect");
    expect(invoke).toHaveBeenCalledWith("ig_disconnect");
    expect(invoke).toHaveBeenCalledWith("li_disconnect");
    expect(invoke).toHaveBeenCalledWith("yt_disconnect");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "fb_disconnect",
      "ig_disconnect",
      "li_disconnect",
      "yt_disconnect",
    ]);
    expect(clearPlatformUA).not.toHaveBeenCalled();
    for (const key of [
      "fb_auth_state",
      "ig_auth_state",
      "li_auth_state",
      "youtube_auth_state",
    ]) {
      expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({
        isAuthenticated: false,
        lastCapturedAt: 200,
        pausedUntil: 300,
        pauseReason: "Provider work is temporarily paused.",
        pauseLevel: 2,
      });
      expect(JSON.parse(window.localStorage.getItem(key)!)).not.toHaveProperty("futureField");
      expect(JSON.parse(window.localStorage.getItem(key)!)).not.toHaveProperty("lastCaptureError");
    }
    expect(window.localStorage.getItem("youtube_offline_playlist_state")).toBe(playlist);
  });

  it("rejects native disconnect failures", async () => {
    const error = new Error("native session store is unavailable");
    invoke.mockRejectedValueOnce(error);

    await expect(disconnectFb()).rejects.toBe(error);
  });
});
