import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, EventHandler>();
  const state = {
    accounts: {} as Record<string, unknown>,
    items: [] as Array<{ globalId: string }>,
    ytAuth: { isAuthenticated: true } as Record<string, unknown>,
    setYtAuth: vi.fn((next: Record<string, unknown>) => {
      state.ytAuth = next;
    }),
  };
  return {
    listeners,
    state,
    invoke: vi.fn(),
    reconcile: vi.fn(),
    getSavedUrls: vi.fn(),
    recordHealth: vi.fn(),
    recordScrape: vi.fn(),
    recordRuntime: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: EventHandler) => {
    mocks.listeners.set(event, handler);
    return () => {
      if (mocks.listeners.get(event) === handler) mocks.listeners.delete(event);
    };
  }),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./automerge", () => ({
  docReconcileYouTubeCapture: mocks.reconcile,
  getSavedYouTubeVideoUrls: mocks.getSavedUrls,
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => mocks.state,
  },
}));

vi.mock("./provider-health", () => ({
  recordProviderHealthEvent: mocks.recordHealth,
}));

vi.mock("./runtime-health-events", () => ({
  recordScrapeOutcome: mocks.recordScrape,
  recordRuntimeHealthEvent: mocks.recordRuntime,
}));

import { checkYouTubeAuth } from "./youtube-auth";
import { captureYouTube, fetchYouTubeCapture } from "./youtube-capture";
import {
  addYouTubeVideoToOfflinePlaylist,
  clearYouTubePlaylistState,
  getYouTubePlaylistState,
  resetYouTubePlaylistProgress,
  syncSavedYouTubeVideosToOfflinePlaylist,
} from "./youtube-playlist";

function emit(event: string, payload: unknown): void {
  const handler = mocks.listeners.get(event);
  if (!handler) throw new Error(`Missing listener for ${event}`);
  handler({ payload });
}

describe("YouTube native bridge", () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.invoke.mockReset();
    mocks.reconcile.mockReset();
    mocks.getSavedUrls.mockReset();
    mocks.recordHealth.mockReset();
    mocks.recordScrape.mockReset();
    mocks.recordRuntime.mockReset();
    mocks.state.accounts = {};
    mocks.state.items = [];
    mocks.state.ytAuth = { isAuthenticated: true };
    mocks.state.setYtAuth.mockClear();
    localStorage.clear();
  });

  it("registers the auth listener before invoking the native check", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      expect(command).toBe("yt_check_auth");
      emit("yt-auth-result", { loggedIn: true });
      return true;
    });

    await expect(checkYouTubeAuth()).resolves.toBe(true);
    expect(mocks.listeners.has("yt-auth-result")).toBe(false);
  });

  it("normalizes a complete authenticated roster and subscriptions capture", async () => {
    const channelId = "UC1111111111111111111111";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      expect(args).toEqual({ includeRoster: true });
      emit("yt-capture-data", {
        channels: [{ channelId, title: "Learning Channel", handle: "@learning" }],
        videos: [{
          videoId: "dQw4w9WgXcQ",
          title: "Focused Study",
          channelId,
          channelTitle: "Learning Channel",
        }, {
          videoId: "abcdefghijk",
          title: "Short distraction",
          channelId,
          channelTitle: "Learning Channel",
          isShort: true,
        }, {
          videoId: "lmNOPqrST_-",
          title: "Second focused lesson",
          channelId,
          channelTitle: "Learning Channel",
        }],
        rosterComplete: true,
        complete: true,
        unresolvedCount: 0,
        scrollPasses: 3,
        stopReason: "stable",
        done: true,
      });
      return null;
    });

    const result = await fetchYouTubeCapture();

    expect(result.accounts).toHaveLength(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.globalId).toBe("youtube:yt:video:dQw4w9WgXcQ");
    expect(result.items[0]!.publishedAt).toBeGreaterThan(result.items[1]!.publishedAt);
    expect(result.diag).toMatchObject({
      rosterComplete: true,
      unresolvedCount: 0,
      scrollPasses: 3,
      shortsSkipped: 1,
      stopReason: "stable",
      errorStage: null,
    });
  });

  it("skips the full roster page during scheduled recent-video refreshes", async () => {
    const channelId = "UC1111111111111111111111";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      expect(args).toEqual({ includeRoster: false });
      emit("yt-capture-data", {
        videos: [{
          videoId: "dQw4w9WgXcQ",
          title: "Focused Study",
          channelId,
          channelTitle: "Learning Channel",
        }],
        rosterComplete: false,
        done: true,
      });
      return null;
    });

    const result = await captureYouTube("scheduled");

    expect(result.diag.rosterComplete).toBe(false);
    expect(mocks.reconcile).toHaveBeenCalledWith(
      [],
      expect.arrayContaining([
        expect.objectContaining({ globalId: "youtube:yt:video:dQw4w9WgXcQ" }),
      ]),
      expect.objectContaining({ rosterComplete: false }),
    );
  });

  it("serializes concurrent capture listeners so events cannot cross requests", async () => {
    const channelId = "UC1111111111111111111111";
    let call = 0;
    mocks.invoke.mockImplementation(async (_command: string, args?: { includeRoster?: boolean }) => {
      const videoId = call === 0 ? "dQw4w9WgXcQ" : "lmNOPqrST_-";
      emit("yt-capture-data", {
        videos: [{
          videoId,
          title: `Lesson ${call.toLocaleString()}`,
          channelId,
          channelTitle: "Learning Channel",
        }],
        rosterComplete: false,
        done: true,
      });
      expect(args?.includeRoster).toBe(call === 0);
      call += 1;
      return null;
    });

    const [full, incremental] = await Promise.all([
      fetchYouTubeCapture(true),
      fetchYouTubeCapture(false),
    ]);

    expect(full.items.map((item) => item.globalId)).toEqual([
      "youtube:yt:video:dQw4w9WgXcQ",
    ]);
    expect(incremental.items.map((item) => item.globalId)).toEqual([
      "youtube:yt:video:lmNOPqrST_-",
    ]);
  });

  it("persists the capture once and records bounded health evidence", async () => {
    const channelId = "UC1111111111111111111111";
    mocks.invoke.mockImplementation(async () => {
      emit("yt-capture-data", {
        channels: [{ channelId, title: "Learning Channel" }],
        videos: [{
          videoId: "dQw4w9WgXcQ",
          title: "Focused Study",
          channelId,
          channelTitle: "Learning Channel",
        }],
        rosterComplete: true,
        done: true,
      });
      return null;
    });

    const result = await captureYouTube("manual");

    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.reconcile.mock.calls[0]?.[2]).toMatchObject({ rosterComplete: true });
    expect(mocks.recordHealth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "youtube",
      outcome: "success",
      itemsSeen: 1,
      itemsAdded: 1,
    }));
    expect(mocks.recordScrape).toHaveBeenCalledWith(expect.objectContaining({
      provider: "youtube",
      trigger: "manual",
      itemsExtracted: 1,
      itemsPersisted: 1,
    }));
    expect(result.diag.itemsAdded).toBe(1);
  });

  it("turns an expired website session into a reconnect state", async () => {
    localStorage.setItem("youtube_offline_playlist_state", JSON.stringify({
      playlistId: "PL-freed-offline",
      playlistUrl: "https://www.youtube.com/playlist?list=PL-freed-offline",
    }));
    mocks.invoke.mockImplementation(async () => {
      emit("yt-capture-data", {
        stage: "subscriptions",
        done: true,
        error: "The YouTube website session is not signed in.",
      });
      return null;
    });

    const result = await captureYouTube("manual");

    expect(result.diag.errorStage).toBe("auth");
    expect(mocks.state.setYtAuth).toHaveBeenCalledWith(expect.objectContaining({
      isAuthenticated: false,
    }));
    expect(getYouTubePlaylistState()).toEqual({});
  });

  it("uses the rendered playlist result and stores only nonsecret playlist metadata", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      expect(command).toBe("yt_add_to_offline_playlist");
      emit("yt-playlist-result", {
        result: "added",
        success: true,
        playlistId: "PL-attacker-event",
        playlistUrl: "https://attacker.example/playlist?list=PL-attacker-event",
      });
      emit("yt-playlist-result", {
        videoId: "dQw4w9WgXcQ",
        result: "added",
        success: true,
        added: true,
        playlistId: "PL-freed-offline",
        playlistUrl: "https://attacker.example/playlist?list=PL-freed-offline",
        clickCount: 2,
        navigationCount: 1,
      });
      return null;
    });

    const result = await addYouTubeVideoToOfflinePlaylist(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );

    expect(result.added).toBe(true);
    expect(getYouTubePlaylistState()).toMatchObject({
      playlistId: "PL-freed-offline",
      playlistUrl: "https://www.youtube.com/playlist?list=PL-freed-offline",
    });
    expect(getYouTubePlaylistState().syncedVideoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(mocks.recordRuntime).toHaveBeenCalledWith(expect.objectContaining({
      event: "youtube_playlist_outcome",
      result: "added",
    }));

    resetYouTubePlaylistProgress();
    expect(getYouTubePlaylistState().syncedVideoIds).toEqual([]);

    clearYouTubePlaylistState();
    expect(getYouTubePlaylistState()).toEqual({});
  });

  it("syncs each saved video sequentially through the website action", async () => {
    mocks.getSavedUrls.mockResolvedValue([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=abcdefghijk",
    ]);
    let call = 0;
    mocks.invoke.mockImplementation(async () => {
      const videoId = call === 0 ? "dQw4w9WgXcQ" : "abcdefghijk";
      emit("yt-playlist-result", {
        videoId,
        result: call === 0 ? "added" : "existing",
        success: true,
        added: call === 0,
        alreadyPresent: call !== 0,
        playlistId: "PL-freed-offline",
        playlistUrl: "https://www.youtube.com/playlist?list=PL-freed-offline",
      });
      call += 1;
      return null;
    });

    await expect(syncSavedYouTubeVideosToOfflinePlaylist()).resolves.toMatchObject({
      requestedCount: 2,
      addedCount: 1,
      existingCount: 1,
      remainingCount: 0,
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    await expect(syncSavedYouTubeVideosToOfflinePlaylist()).resolves.toMatchObject({
      requestedCount: 2,
      addedCount: 0,
      existingCount: 2,
      remainingCount: 0,
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("caps each saved playlist batch and resumes from local checkpoints", async () => {
    const urls = Array.from({ length: 26 }, (_, index) => {
      const videoId = index.toString(36).padStart(11, "0");
      return `https://www.youtube.com/watch?v=${videoId}`;
    });
    mocks.getSavedUrls.mockResolvedValue(urls);
    mocks.invoke.mockImplementation(async (_command: string, args?: { videoUrl?: string }) => {
      const videoId = new URL(args?.videoUrl ?? "https://www.youtube.com").searchParams.get("v");
      emit("yt-playlist-result", {
        videoId,
        result: "added",
        success: true,
        added: true,
        playlistId: "PL-freed-offline",
      });
      return null;
    });

    await expect(syncSavedYouTubeVideosToOfflinePlaylist()).resolves.toMatchObject({
      requestedCount: 26,
      addedCount: 25,
      remainingCount: 1,
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(25);

    await expect(syncSavedYouTubeVideosToOfflinePlaylist()).resolves.toMatchObject({
      requestedCount: 26,
      addedCount: 1,
      existingCount: 25,
      remainingCount: 0,
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(26);
  });

  it("can stop a saved playlist batch before provider navigation begins", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(syncSavedYouTubeVideosToOfflinePlaylist([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ], controller.signal)).rejects.toThrow("stopped");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
