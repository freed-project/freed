import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginFactoryResetBoundary,
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

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
  resetYouTubePlaylistStateForTests,
  syncSavedYouTubeVideosToOfflinePlaylist,
} from "./youtube-playlist";

function emit(event: string, payload: unknown): void {
  const handler = mocks.listeners.get(event);
  if (!handler) throw new Error(`Missing listener for ${event}`);
  handler({ payload });
}

interface CaptureArgs {
  includeRoster: boolean;
  captureId: string;
}

function expectCaptureArgs(args: unknown, includeRoster: boolean): CaptureArgs {
  expect(args).toEqual({
    includeRoster,
    captureId: expect.any(String),
  });
  const captureArgs = args as CaptureArgs;
  expect(captureArgs.captureId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return captureArgs;
}

function emitCapture(args: CaptureArgs, payload: Record<string, unknown>): void {
  emit("yt-capture-data", { captureId: args.captureId, ...payload });
}

type CaptureStage = "channels" | "subscriptions";

interface CaptureStageRecords {
  channels?: Array<Record<string, unknown>>;
  videos?: Array<Record<string, unknown>>;
}

function terminalStage(
  args: CaptureArgs,
  stage: CaptureStage,
  records: CaptureStageRecords = {},
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const channels = records.channels ?? [];
  const videos = records.videos ?? [];
  const primaryRecords = stage === "channels" ? channels : videos;
  return {
    captureId: args.captureId,
    stage,
    channels,
    videos,
    rosterComplete: stage === "channels",
    complete: stage === "subscriptions",
    channelTotal: channels.length,
    videoTotal: videos.length,
    candidateCount: primaryRecords.length,
    unresolvedCount: 0,
    scrollPasses: 1,
    stopReason: "end-stable",
    pageEvidence: true,
    explicitEmpty: primaryRecords.length === 0,
    unsupportedCandidateCount: 0,
    pendingContinuation: false,
    workBudgetExceeded: false,
    deadlineExceeded: false,
    done: true,
    ...overrides,
  };
}

function captureResult(...stages: Array<Record<string, unknown>>): {
  stages: Array<Record<string, unknown>>;
} {
  return { stages };
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
    resetYouTubePlaylistStateForTests();
  });

  afterEach(() => {
    resetFactoryResetStateForTests();
  });

  it("does not issue a raw capture after the reset boundary closes", async () => {
    beginFactoryResetBoundary();

    await expect(fetchYouTubeCapture()).rejects.toThrow("Factory reset is in progress");

    expect(mocks.invoke).not.toHaveBeenCalledWith("yt_capture", expect.anything());
  });

  it("drains an issued raw capture and rejects its late native result", async () => {
    let resolveCapture!: (value: { stages: [] }) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "yt_capture") {
        return new Promise<{ stages: [] }>((resolve) => {
          resolveCapture = resolve;
        });
      }
      return Promise.resolve();
    });

    const capture = fetchYouTubeCapture();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "yt_capture",
      expect.anything(),
    ));
    const clearDocument = vi.fn(async () => undefined);
    const reset = runFactoryResetOperations({
      quiesceLocalWriters: [],
      clearDeviceStores: () => [],
      clearLocalSettings: [],
      clearLocalData: [],
      clearProviderDataAndConnections: async () => undefined,
      clearDocument,
    });
    await Promise.resolve();
    expect(clearDocument).not.toHaveBeenCalled();

    resolveCapture({ stages: [] });
    await expect(capture).rejects.toThrow("Factory reset is in progress");
    await reset;

    expect(clearDocument).toHaveBeenCalledOnce();
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
    const channels = [{ channelId, title: "Learning Channel", handle: "@learning" }];
    const videos = [{
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
    }];
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      emitCapture(captureArgs, {
        stage: "channels",
        channels,
        candidateCount: 1,
        unresolvedCount: 1,
        scrollPasses: 1,
        done: false,
      });
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos,
        candidateCount: 3,
        scrollPasses: 1,
        done: false,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", { channels }, {
          candidateCount: 1,
          scrollPasses: 3,
        }),
        terminalStage(captureArgs, "subscriptions", { videos }, {
          candidateCount: 3,
          scrollPasses: 2,
        }),
      );
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
      stopReason: "end-stable",
      errorStage: null,
    });
  });

  it("aggregates matching progress idempotently and ignores stale capture events", async () => {
    const channelId = "UC1111111111111111111111";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      emit("yt-capture-data", {
        captureId: "11111111-1111-4111-8111-111111111111",
        stage: "subscriptions",
        videos: [{
          videoId: "staleVideo1",
          title: "Stale lesson",
          channelId,
          channelTitle: "Learning Channel",
        }],
        done: true,
        error: "The YouTube website session is not signed in.",
      });
      emitCapture(captureArgs, {
        stage: "channels",
        channels: [{ channelId, title: "Learning Channel" }],
        candidateCount: 4,
        scrollPasses: 1,
        done: false,
      });
      emitCapture(captureArgs, {
        stage: "channels",
        channels: [{ channelId, title: "Learning Channel", handle: "@learning" }],
        rosterComplete: true,
        candidateCount: 4,
        scrollPasses: 2,
        done: true,
      });
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos: [{
          videoId: "dQw4w9WgXcQ",
          title: "Focused Study",
          channelId,
          channelTitle: "Learning Channel",
        }],
        candidateCount: 1,
        scrollPasses: 1,
        done: false,
      });
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos: [{
          videoId: "dQw4w9WgXcQ",
          title: "Focused Study",
          description: "A deeper description from a later pass.",
          channelId,
          channelTitle: "Learning Channel",
        }, {
          videoId: "lmNOPqrST_-",
          title: "Second focused lesson",
          channelId,
          channelTitle: "Learning Channel",
        }],
        candidateCount: 2,
        complete: true,
        scrollPasses: 2,
        done: true,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", {
          channels: [{ channelId, title: "Learning Channel", handle: "@learning" }],
        }, { candidateCount: 4, scrollPasses: 2 }),
        terminalStage(captureArgs, "subscriptions", {
          videos: [{
            videoId: "dQw4w9WgXcQ",
            title: "Focused Study",
            description: "A deeper description from the native terminal receipt.",
            channelId,
            channelTitle: "Learning Channel",
          }, {
            videoId: "lmNOPqrST_-",
            title: "Second focused lesson",
            channelId,
            channelTitle: "Learning Channel",
          }],
        }, { candidateCount: 2, scrollPasses: 2 }),
      );
    });

    const result = await fetchYouTubeCapture();

    expect(result.accounts).toHaveLength(1);
    expect(result.items.map((item) => item.globalId)).toEqual([
      "youtube:yt:video:dQw4w9WgXcQ",
      "youtube:yt:video:lmNOPqrST_-",
    ]);
    expect(result.items[0]?.content.text).toContain("deeper description");
    expect(result.diag).toMatchObject({
      channelsExtracted: 1,
      videosExtracted: 2,
      accountsNormalized: 1,
      itemsNormalized: 2,
      rosterComplete: true,
      errorStage: null,
    });
  });

  it("rejects renderer event finals without an authoritative native return", async () => {
    const channelId = "UC1111111111111111111111";
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      captureId = captureArgs.captureId;
      emit("yt-capture-data", terminalStage(captureArgs, "channels", {
        channels: [{ channelId, title: "Learning Channel" }],
      }));
      emit("yt-capture-data", {
        captureId: "22222222-2222-4222-8222-222222222222",
        stage: "subscriptions",
        done: true,
      });
      emit("yt-capture-data", terminalStage(captureArgs, "subscriptions", {}, {
        candidateCount: 7,
        scrollPasses: 4,
      }));
      return captureResult();
    });

    const result = await captureYouTube("manual");

    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toContain(
      "ended without final markers for channels, subscriptions",
    );
    expect(result.diag.errorMessage).toContain("stage=subscriptions");
    expect(result.diag.errorMessage).toContain("candidates=7");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
    expect(mocks.listeners.has("yt-capture-data")).toBe(false);
  });

  it("rejects mismatched authoritative totals and cancels the exact capture", async () => {
    const channelId = "UC1111111111111111111111";
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      captureId = captureArgs.captureId;
      return captureResult(
        terminalStage(captureArgs, "channels", {
          channels: [{ channelId, title: "Learning Channel" }],
        }, { channelTotal: 2 }),
        terminalStage(captureArgs, "subscriptions"),
      );
    });

    const result = await captureYouTube("manual");

    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toContain(
      "ended incomplete for channels stopReason=end-stable",
    );
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
    expect(mocks.listeners.has("yt-capture-data")).toBe(false);
  });

  it.each([
    "workBudgetExceeded",
    "deadlineExceeded",
    "pendingContinuation",
  ] as const)(
    "rejects an authoritative terminal missing %s",
    async (missingField) => {
      let captureId = "";
      mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "yt_hide_login") {
          expect(args).toEqual({ captureId });
          return null;
        }
        expect(command).toBe("yt_capture");
        const captureArgs = expectCaptureArgs(args, false);
        captureId = captureArgs.captureId;
        const terminal = terminalStage(captureArgs, "subscriptions");
        delete terminal[missingField];
        return captureResult(terminal);
      });

      const result = await fetchYouTubeCapture(false);

      expect(result.diag.errorStage).toBe("extract");
      expect(result.diag.errorMessage).toContain(
        "ended incomplete for subscriptions stopReason=end-stable",
      );
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
    },
  );

  it("rejects an authoritative terminal with a pending continuation", async () => {
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, false);
      captureId = captureArgs.captureId;
      return captureResult(
        terminalStage(
          captureArgs,
          "subscriptions",
          {},
          { pendingContinuation: true },
        ),
      );
    });

    const result = await fetchYouTubeCapture(false);

    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toContain(
      "ended incomplete for subscriptions stopReason=end-stable",
    );
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
  });

  it("accepts authoritative zero unresolved after positive progress", async () => {
    const channelId = "UC1111111111111111111111";
    const channels = [{ channelId, title: "Learning Channel" }];
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      emitCapture(captureArgs, {
        stage: "channels",
        channels,
        candidateCount: 3,
        unresolvedCount: 2,
        scrollPasses: 1,
        done: false,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", { channels }, {
          candidateCount: 3,
          scrollPasses: 2,
        }),
        terminalStage(captureArgs, "subscriptions"),
      );
    });

    const result = await captureYouTube("manual");

    expect(result.diag).toMatchObject({
      errorStage: null,
      rosterComplete: true,
      unresolvedCount: 0,
    });
    expect(mocks.reconcile).toHaveBeenCalledOnce();
  });

  it("uses complete native finals when renderer delivery is delayed or absent", async () => {
    const channelId = "UC1111111111111111111111";
    const channels = [{ channelId, title: "Learning Channel" }];
    const videos = [{
      videoId: "dQw4w9WgXcQ",
      title: "Focused Study",
      channelId,
      channelTitle: "Learning Channel",
    }, {
      videoId: "lmNOPqrST_-",
      title: "Second focused lesson",
      channelId,
      channelTitle: "Learning Channel",
    }];
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
      emitCapture(captureArgs, {
        stage: "channels",
        channels: [{ channelId, title: "Learning" }],
        unresolvedCount: 1,
        done: false,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", { channels }),
        terminalStage(captureArgs, "subscriptions", { videos }),
      );
    });

    const result = await fetchYouTubeCapture();

    expect(result.accounts).toHaveLength(1);
    expect(result.items.map((item) => item.globalId)).toEqual([
      "youtube:yt:video:dQw4w9WgXcQ",
      "youtube:yt:video:lmNOPqrST_-",
    ]);
    expect(result.diag).toMatchObject({ errorStage: null, unresolvedCount: 0 });
  });

  it("rejects an incomplete channel final and does not reconcile partial results", async () => {
    const channelId = "UC1111111111111111111111";
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      captureId = captureArgs.captureId;
      emitCapture(captureArgs, {
        stage: "channels",
        channels: [{ channelId, title: "Learning Channel" }],
        rosterComplete: false,
        unresolvedCount: 2,
        candidateCount: 3,
        scrollPasses: 5,
        stopReason: "unresolved",
        done: true,
      });
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos: [],
        complete: true,
        stopReason: "end-stable",
        done: true,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", {
          channels: [{ channelId, title: "Learning Channel" }],
        }, {
          rosterComplete: false,
          unresolvedCount: 2,
          candidateCount: 3,
          scrollPasses: 5,
          stopReason: "unresolved",
        }),
        terminalStage(captureArgs, "subscriptions"),
      );
    });

    const result = await captureYouTube("manual");

    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toContain(
      "ended incomplete for channels stopReason=unresolved",
    );
    expect(result.diag.errorMessage).toContain("stage=channels");
    expect(result.diag.errorMessage).toContain("candidates=3");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
  });

  it("rejects an incomplete subscriptions final in a roster-free capture", async () => {
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, false);
      captureId = captureArgs.captureId;
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos: [],
        complete: false,
        candidateCount: 18,
        scrollPasses: 7,
        stopReason: "deadline",
        done: true,
      });
      return captureResult(terminalStage(captureArgs, "subscriptions", {}, {
        complete: false,
        candidateCount: 18,
        scrollPasses: 7,
        stopReason: "deadline",
      }));
    });

    const result = await captureYouTube("scheduled");

    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toContain(
      "ended incomplete for subscriptions stopReason=deadline",
    );
    expect(result.diag.errorMessage).toContain("stage=subscriptions");
    expect(result.diag.errorMessage).toContain("candidates=18");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
  });

  it("adds matching progress diagnostics to a native capture rejection", async () => {
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, false);
      captureId = captureArgs.captureId;
      emitCapture(captureArgs, {
        stage: "subscriptions",
        candidateCount: 1_234,
        scrollPasses: 9,
        done: false,
      });
      throw new Error("YouTube subscriptions capture timed out.");
    });

    const result = await fetchYouTubeCapture(false);

    expect(result.diag.errorStage).toBe("invoke");
    expect(result.diag.errorMessage).toContain(
      "YouTube subscriptions capture timed out.",
    );
    expect(result.diag.errorMessage).toContain("stage=subscriptions");
    expect(result.diag.errorMessage).toContain(
      `candidates=${(1_234).toLocaleString()}`,
    );
    expect(result.diag.errorMessage?.match(/Last progress stage=/g)).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
  });

  it("times out with latest progress and cancels only the active capture", async () => {
    vi.useFakeTimers();
    let captureId = "";
    try {
      mocks.invoke.mockImplementation((command: string, args?: unknown) => {
        if (command === "yt_hide_login") {
          expect(args).toEqual({ captureId });
          return Promise.resolve(null);
        }
        expect(command).toBe("yt_capture");
        const captureArgs = expectCaptureArgs(args, false);
        captureId = captureArgs.captureId;
        emitCapture(captureArgs, {
          stage: "subscriptions",
          candidateCount: 18,
          scrollPasses: 6,
          done: false,
        });
        return new Promise(() => undefined);
      });

      const pending = fetchYouTubeCapture(false);
      await vi.advanceTimersByTimeAsync(275_000);
      const result = await pending;

      expect(result.diag.errorStage).toBe("invoke");
      expect(result.diag.errorMessage).toContain("YouTube capture timed out.");
      expect(result.diag.errorMessage).toContain("stage=subscriptions");
      expect(result.diag.errorMessage).toContain("candidates=18");
      expect(result.diag.errorMessage).toContain("scrollPasses=6");
      expect(result.diag.errorMessage?.match(/Last progress stage=/g)).toHaveLength(1);
      expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
      expect(mocks.listeners.has("yt-capture-data")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the full roster page during scheduled recent-video refreshes", async () => {
    const channelId = "UC1111111111111111111111";
    const videos = [{
      videoId: "dQw4w9WgXcQ",
      title: "Focused Study",
      channelId,
      channelTitle: "Learning Channel",
    }];
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, false);
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos,
        rosterComplete: false,
        complete: true,
        done: true,
      });
      return captureResult(terminalStage(captureArgs, "subscriptions", { videos }));
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
    const captureIds: string[] = [];
    mocks.invoke.mockImplementation(async (_command: string, args?: unknown) => {
      const captureArgs = expectCaptureArgs(args, call === 0);
      captureIds.push(captureArgs.captureId);
      const videoId = call === 0 ? "dQw4w9WgXcQ" : "lmNOPqrST_-";
      const channels = [{ channelId, title: "Learning Channel" }];
      const videos = [{
        videoId,
        title: `Lesson ${call.toLocaleString()}`,
        channelId,
        channelTitle: "Learning Channel",
      }];
      if (call === 0) {
        emitCapture(captureArgs, {
          stage: "channels",
          channels,
          rosterComplete: true,
          done: true,
        });
      }
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos,
        rosterComplete: false,
        complete: true,
        done: true,
      });
      const stages = call === 0
        ? [terminalStage(captureArgs, "channels", { channels })]
        : [];
      stages.push(terminalStage(captureArgs, "subscriptions", { videos }));
      call += 1;
      return captureResult(...stages);
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
    expect(new Set(captureIds).size).toBe(2);
  });

  it("persists the capture once and records bounded health evidence", async () => {
    const channelId = "UC1111111111111111111111";
    const channels = [{ channelId, title: "Learning Channel" }];
    const videos = [{
      videoId: "dQw4w9WgXcQ",
      title: "Focused Study",
      channelId,
      channelTitle: "Learning Channel",
    }];
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      emitCapture(captureArgs, {
        stage: "channels",
        channels,
        rosterComplete: true,
        done: true,
      });
      emitCapture(captureArgs, {
        stage: "subscriptions",
        videos,
        complete: true,
        done: true,
      });
      return captureResult(
        terminalStage(captureArgs, "channels", { channels }),
        terminalStage(captureArgs, "subscriptions", { videos }),
      );
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
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") return null;
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      emitCapture(captureArgs, {
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

  it("classifies a native signed-out rejection without a renderer event", async () => {
    localStorage.setItem("youtube_offline_playlist_state", JSON.stringify({
      playlistId: "PL-freed-offline",
      playlistUrl: "https://www.youtube.com/playlist?list=PL-freed-offline",
    }));
    let captureId = "";
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "yt_hide_login") {
        expect(args).toEqual({ captureId });
        return null;
      }
      expect(command).toBe("yt_capture");
      const captureArgs = expectCaptureArgs(args, true);
      captureId = captureArgs.captureId;
      throw new Error("The YouTube website session is not signed in.");
    });

    const result = await captureYouTube("manual");

    expect(result.diag.errorStage).toBe("auth");
    expect(mocks.state.setYtAuth).toHaveBeenCalledWith(expect.objectContaining({
      isAuthenticated: false,
    }));
    expect(getYouTubePlaylistState()).toEqual({});
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("yt_hide_login", { captureId });
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

  it("does not issue playlist actions when local progress is corrupt", async () => {
    const corrupt = JSON.stringify({
      playlistId: "PL-freed-offline",
      syncedVideoIds: ["dQw4w9WgXcQ", "invalid"],
    });
    localStorage.setItem("youtube_offline_playlist_state", corrupt);

    await expect(syncSavedYouTubeVideosToOfflinePlaylist([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ])).rejects.toThrow("could not verify");

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("youtube_offline_playlist_state")).toBe(corrupt);
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
