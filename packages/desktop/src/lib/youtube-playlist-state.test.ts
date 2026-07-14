import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("./automerge", () => ({
  getSavedYouTubeVideoUrls: vi.fn(async () => []),
}));

vi.mock("./runtime-health-events", () => ({
  recordRuntimeHealthEvent: vi.fn(),
}));

import {
  clearYouTubePlaylistState,
  getYouTubePlaylistState,
} from "./youtube-playlist";

const storageKey = "youtube_offline_playlist_state";

describe("YouTube playlist factory reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("clears account-specific playlist handoff and progress state", () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      playlistId: "PL12345678",
      playlistUrl: "https://www.youtube.com/playlist?list=PL12345678",
      lastSyncedAt: 123,
      syncedVideoIds: ["12345678901"],
    }));
    const listener = vi.fn();
    window.addEventListener("freed:youtube-offline-playlist", listener);

    try {
      clearYouTubePlaylistState();
    } finally {
      window.removeEventListener("freed:youtube-offline-playlist", listener);
    }

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(getYouTubePlaylistState()).toEqual({});
    expect(listener).toHaveBeenCalledOnce();
  });

  it("propagates playlist storage removal failures", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => clearYouTubePlaylistState()).toThrow("storage unavailable");
  });
});
