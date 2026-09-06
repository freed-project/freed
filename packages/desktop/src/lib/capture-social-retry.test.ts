import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    feeds: {},
    items: [],
    xAuth: {
      isAuthenticated: false,
      cookies: null as { ct0: string; authToken: string } | null,
    },
    fbAuth: { isAuthenticated: true },
    igAuth: { isAuthenticated: false },
    liAuth: { isAuthenticated: false },
    substackAuth: { isAuthenticated: false },
    mediumAuth: { isAuthenticated: false },
    ytAuth: { isAuthenticated: false },
    setSyncing: vi.fn(),
    setError: vi.fn(),
  };

  return {
    state,
    addDebugEvent: vi.fn(),
    captureFbFeed: vi.fn(),
    captureIgFeed: vi.fn(),
    captureLiFeed: vi.fn(),
    captureSubstackFeed: vi.fn(),
    captureMediumFeed: vi.fn(),
    captureYouTube: vi.fn(),
    captureXTimeline: vi.fn(),
    refreshLibraryFeeds: vi.fn(),
    isProviderPaused: vi.fn(() => false),
    recordProviderHealthEvent: vi.fn(),
    withProviderSyncing: vi.fn(
      async (_provider: string, run: () => Promise<unknown>) => run(),
    ),
    sqliteActive: false,
    writerAllowed: true,
    writerConfigured: true,
    writerError: null as Error | null,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: mocks.addDebugEvent,
}));

vi.mock("./library-client", () => ({
  refreshLibraryFeeds: mocks.refreshLibraryFeeds,
}));

vi.mock("./fb-capture", () => ({
  captureFbFeed: mocks.captureFbFeed,
}));

vi.mock("./instagram-capture", () => ({
  captureIgFeed: mocks.captureIgFeed,
}));

vi.mock("./li-capture", () => ({
  captureLiFeed: mocks.captureLiFeed,
}));

vi.mock("./substack-capture", () => ({
  captureSubstackFeed: mocks.captureSubstackFeed,
}));

vi.mock("./medium-capture", () => ({
  captureMediumFeed: mocks.captureMediumFeed,
}));

vi.mock("./youtube-capture", () => ({
  captureYouTube: mocks.captureYouTube,
}));

vi.mock("./x-capture", () => ({
  captureXTimeline: mocks.captureXTimeline,
}));

vi.mock("./provider-health", () => ({
  isProviderPaused: mocks.isProviderPaused,
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => mocks.state,
  },
  withProviderSyncing: mocks.withProviderSyncing,
}));

vi.mock("./sqlite-library", () => ({
  isSqliteLibraryActive: () => mocks.sqliteActive,
  sqliteLibraryCloudWriterAdmissionStatus: vi.fn(async () => {
    if (mocks.writerError) throw mocks.writerError;
    return {
      configured: mocks.writerConfigured,
      allowed: mocks.writerAllowed,
      localWriterId: "writer-local",
      activeWriterId: mocks.writerAllowed ? "writer-local" : "writer-other",
      storageEpoch: "epoch-1",
      controlRevision: "revision-1",
      verifiedAtMs: 1,
    };
  }),
}));

let captureModule: typeof import("./capture");

describe("scheduled social capture retries", () => {
  beforeAll(async () => {
    captureModule = await import("./capture");
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.addDebugEvent.mockClear();
    mocks.captureFbFeed.mockReset();
    mocks.captureIgFeed.mockReset();
    mocks.captureLiFeed.mockReset();
    mocks.captureSubstackFeed.mockReset();
    mocks.captureMediumFeed.mockReset();
    mocks.captureYouTube.mockReset();
    mocks.captureXTimeline.mockReset();
    mocks.refreshLibraryFeeds.mockReset();
    mocks.isProviderPaused.mockReset();
    mocks.isProviderPaused.mockReturnValue(false);
    mocks.recordProviderHealthEvent.mockClear();
    mocks.withProviderSyncing.mockClear();
    mocks.state.setSyncing.mockClear();
    mocks.state.setError.mockClear();
    mocks.state.xAuth = { isAuthenticated: false, cookies: null };
    mocks.state.fbAuth = { isAuthenticated: true };
    mocks.state.igAuth = { isAuthenticated: false };
    mocks.state.liAuth = { isAuthenticated: false };
    mocks.state.substackAuth = { isAuthenticated: false };
    mocks.state.mediumAuth = { isAuthenticated: false };
    mocks.state.ytAuth = { isAuthenticated: false };
    mocks.sqliteActive = false;
    mocks.writerAllowed = true;
    mocks.writerConfigured = true;
    mocks.writerError = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("leaves scheduled Facebook deferrals to the durable Meta scheduler", async () => {
    mocks.captureFbFeed
      .mockResolvedValueOnce({
        items: [],
        diag: {
          errorStage: "memory_pressure",
          errorMessage:
            "Facebook sync did not start because Freed Desktop memory is high.",
        },
      })
      .mockResolvedValueOnce({
        items: [],
        diag: {
          errorStage: null,
          errorMessage: null,
        },
      });

    await captureModule.refreshSocialProvider("facebook", "scheduled");

    expect(mocks.captureFbFeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mocks.captureFbFeed).toHaveBeenCalledTimes(1);
  });

  it("does not contact providers after another Desktop becomes the writer", async () => {
    mocks.sqliteActive = true;
    mocks.writerAllowed = false;

    const result = await captureModule.refreshSocialProvider(
      "facebook",
      "scheduled",
    );
    await captureModule.refreshScheduledRssFeeds();

    expect(result).toMatchObject({
      status: "deferred",
      stage: "retired_writer",
    });
    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(mocks.captureXTimeline).not.toHaveBeenCalled();
    expect(mocks.captureYouTube).not.toHaveBeenCalled();
    expect(mocks.refreshLibraryFeeds).not.toHaveBeenCalled();
  });

  it.each([
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "substack",
    "medium",
  ] as const)(
    "distinguishes missing and unreadable writer admission for %s without provider contact",
    async (provider) => {
      mocks.sqliteActive = true;
      mocks.writerAllowed = false;
      mocks.writerConfigured = false;
      expect(await captureModule.refreshSocialProvider(provider)).toMatchObject(
        {
          status: "ignored",
          stage: "writer_admission_missing",
        },
      );
      expect(
        await captureModule.refreshSocialProvider(provider, "scheduled"),
      ).toMatchObject({
        status: "deferred",
        stage: "writer_admission_missing",
      });
      mocks.writerError = new Error("database is locked");
      expect(await captureModule.refreshSocialProvider(provider)).toMatchObject(
        {
          status: "ignored",
          stage: "writer_admission_unavailable",
        },
      );
      expect(
        await captureModule.refreshSocialProvider(provider, "scheduled"),
      ).toMatchObject({
        status: "deferred",
        stage: "writer_admission_unavailable",
      });
      expect(mocks.captureLiFeed).not.toHaveBeenCalled();
      expect(mocks.captureIgFeed).not.toHaveBeenCalled();
      expect(mocks.captureFbFeed).not.toHaveBeenCalled();
      expect(mocks.captureYouTube).not.toHaveBeenCalled();
      expect(mocks.withProviderSyncing).not.toHaveBeenCalled();
    },
  );

  it.each(["facebook", "instagram"] as const)(
    "retains the due %s opportunity through missing and unreadable admission",
    async (provider) => {
      const schedule = await import("./provider-sync-schedule-state");
      localStorage.clear();
      const random = { uniform: () => 0.5, id: () => "admission-replay" };
      schedule.initializeProviderSchedules({ now: 1_000, random });
      const before = schedule.getProviderScheduleSnapshot(provider).record!;
      const other = provider === "facebook" ? "instagram" : "facebook";
      const otherBefore = schedule.getProviderScheduleSnapshot(other).record!;
      mocks.sqliteActive = true;
      mocks.writerAllowed = false;
      mocks.writerConfigured = false;
      let now = before.nextDueAt + 1;
      for (const stage of [
        "writer_admission_missing",
        "writer_admission_unavailable",
      ]) {
        mocks.writerError =
          stage === "writer_admission_unavailable"
            ? new Error("unreadable")
            : null;
        const claim = schedule.claimProviderSchedule({ provider, now, random });
        expect(claim.status).toBe("claimed");
        if (claim.status !== "claimed") throw new Error("Expected claim");
        const contact = vi.fn();
        const result = await captureModule.refreshSocialProvider(
          provider,
          "scheduled",
          contact,
        );
        expect(result).toMatchObject({ status: "deferred", stage });
        expect(contact).not.toHaveBeenCalled();
        expect(
          schedule.settleProviderSchedule({
            provider,
            attemptId: claim.attempt.attemptId,
            now,
            random,
            status: result.status,
            stage: result.stage,
          }),
        ).toBe(true);
        const after = schedule.getProviderScheduleSnapshot(provider).record!;
        expect(after).toMatchObject({
          phase: "locally_deferred",
          nextDueAt: before.nextDueAt,
          consecutiveFailures: before.consecutiveFailures,
          previousBackoffMs: before.previousBackoffMs,
          yieldFactor: before.yieldFactor,
          regime: before.regime,
        });
        expect(after.attempt).toBeUndefined();
        expect(after.localEligibilityRetryAt).toBeGreaterThan(now);
        expect(after.localEligibilityRetryAt! - now).toBeGreaterThanOrEqual(
          45_000,
        );
        expect(after.localEligibilityRetryAt! - now).toBeLessThanOrEqual(
          120_000,
        );
        expect(
          schedule
            .listDueProviderSchedules(now)
            .some((due) => due.provider === provider),
        ).toBe(false);
        now = after.localEligibilityRetryAt! + 1;
      }
      // Listing due work may mark the peer due, but cannot consume its interval.
      expect(schedule.getProviderScheduleSnapshot(other).record).toEqual({
        ...otherBefore,
        phase: "due",
      });
      expect(mocks.withProviderSyncing).not.toHaveBeenCalled();
      const recovered = schedule.claimProviderSchedule({
        provider,
        now,
        random,
      });
      expect(recovered.status).toBe("claimed");
      if (recovered.status !== "claimed")
        throw new Error("Expected recovery claim");
      expect(recovered.attempt.scheduledAt).toBe(before.nextDueAt);
      // A genuine contacted settlement consumes the next interval, unlike the local skips.
      schedule.markProviderContactIssued({
        provider,
        attemptId: recovered.attempt.attemptId,
        now,
      });
      schedule.settleProviderSchedule({
        provider,
        attemptId: recovered.attempt.attemptId,
        now,
        random,
        status: "success",
        itemsSeen: 2,
        itemsAdded: 1,
      });
      const settled = schedule.getProviderScheduleSnapshot(provider).record!;
      expect(settled.phase).toBe("settled");
      expect(settled.nextDueAt - now).toBeGreaterThanOrEqual(
        before.bounds.lowerMs,
      );
      expect(settled.nextDueAt - now).toBeLessThanOrEqual(
        before.bounds.upperMs,
      );
    },
  );

  it("returns success details when Facebook sees posts", async () => {
    mocks.captureFbFeed.mockResolvedValueOnce({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        postsExtracted: 4,
        itemsAdded: 0,
      },
    });

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(result).toMatchObject({
      provider: "facebook",
      status: "success",
      postsExtracted: 4,
      itemsAdded: 0,
    });
  });

  it("passes the durable contact callback through every scheduled provider adapter", async () => {
    const onProviderContact = vi.fn();
    mocks.state.xAuth = {
      isAuthenticated: true,
      cookies: { ct0: "ct0", authToken: "auth" },
    };
    mocks.state.igAuth = { isAuthenticated: true };
    mocks.state.liAuth = { isAuthenticated: true };
    mocks.state.substackAuth = { isAuthenticated: true };
    mocks.state.mediumAuth = { isAuthenticated: true };
    mocks.state.ytAuth = { isAuthenticated: true };
    const feedResult = {
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        postsExtracted: 1,
        itemsAdded: 0,
      },
    };
    mocks.captureFbFeed.mockResolvedValue(feedResult);
    mocks.captureIgFeed.mockResolvedValue(feedResult);
    mocks.captureLiFeed.mockResolvedValue(feedResult);
    mocks.captureXTimeline.mockResolvedValue({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        tweetsExtracted: 1,
        itemsAdded: 0,
      },
    });
    const essayResult = {
      items: [],
      accounts: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        entriesExtracted: 1,
        profilesExtracted: 0,
        itemsAdded: 0,
        accountsAdded: 0,
      },
    };
    mocks.captureSubstackFeed.mockResolvedValue(essayResult);
    mocks.captureMediumFeed.mockResolvedValue(essayResult);
    mocks.captureYouTube.mockResolvedValue({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        videosExtracted: 1,
        itemsAdded: 0,
      },
    });

    for (const provider of [
      "x",
      "facebook",
      "instagram",
      "linkedin",
      "youtube",
      "substack",
      "medium",
    ] as const) {
      await captureModule.refreshSocialProvider(
        provider,
        "scheduled",
        onProviderContact,
      );
    }

    expect(mocks.captureXTimeline).toHaveBeenCalledWith(
      mocks.state.xAuth.cookies,
      undefined,
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureFbFeed).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureIgFeed).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureLiFeed).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureYouTube).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureSubstackFeed).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
    expect(mocks.captureMediumFeed).toHaveBeenCalledWith(
      "scheduled",
      onProviderContact,
    );
  });

  it("returns empty when Facebook sees no posts", async () => {
    mocks.captureFbFeed.mockResolvedValueOnce({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        postsExtracted: 0,
        itemsAdded: 0,
      },
    });

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(result).toMatchObject({
      provider: "facebook",
      status: "empty",
      stage: "empty",
      postsExtracted: 0,
      itemsAdded: 0,
    });
  });

  it("returns ignored when Facebook is not authenticated", async () => {
    mocks.state.fbAuth = { isAuthenticated: false };

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "auth",
    });
  });

  it("does not start automatic capture when provider health fails closed", async () => {
    mocks.isProviderPaused.mockReturnValue(true);

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook", "scheduled");

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(mocks.withProviderSyncing).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "paused",
    });
  });

  it("refuses every social capture before provider contact in follower mode", async () => {
    window.localStorage.setItem("freed.libraryCore.desktopRoleV1", "follower");

    const result = await captureModule.refreshSocialProvider(
      "facebook",
      "scheduled",
    );

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(mocks.withProviderSyncing).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "deferred",
      stage: "follower",
    });
  });

  it("summarizes Substack graph and activity records", async () => {
    mocks.state.substackAuth = { isAuthenticated: true };
    mocks.captureSubstackFeed.mockResolvedValueOnce({
      items: [],
      accounts: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        entriesExtracted: 3,
        profilesExtracted: 5,
        itemsAdded: 2,
        accountsAdded: 4,
      },
    });

    const result = await captureModule.refreshSocialProvider(
      "substack",
      "scheduled",
    );

    expect(mocks.captureSubstackFeed).toHaveBeenCalledWith("scheduled");
    expect(result).toMatchObject({
      provider: "substack",
      status: "success",
      postsExtracted: 8,
      itemsAdded: 6,
    });
  });

  it("retries a local cooldown without immediate provider traffic", async () => {
    mocks.state.mediumAuth = { isAuthenticated: true };
    mocks.captureMediumFeed
      .mockResolvedValueOnce({
        items: [],
        accounts: [],
        diag: {
          errorStage: "cooldown",
          errorMessage: "Cooling down.",
          retryAfterMs: 300_000,
          entriesExtracted: 0,
          profilesExtracted: 0,
          itemsAdded: 0,
          accountsAdded: 0,
        },
      })
      .mockResolvedValueOnce({
        items: [],
        accounts: [],
        diag: {
          errorStage: null,
          errorMessage: null,
          entriesExtracted: 0,
          profilesExtracted: 0,
          itemsAdded: 0,
          accountsAdded: 0,
        },
      });

    const first = await captureModule.refreshSocialProvider(
      "medium",
      "scheduled",
    );

    expect(first.status).toBe("deferred");
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(2);
    expect(mocks.captureMediumFeed).toHaveBeenLastCalledWith("deferred_retry");
  });
});
