import { test, expect } from "./fixtures/app";

function settingsDialog(page: import("@playwright/test").Page) {
  return page.locator(".fixed.inset-0.z-50").last();
}

async function openYouTubeSettings(page: import("@playwright/test").Page): Promise<void> {
  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });
  const section = settingsDialog(page).getByRole("button", { name: "YouTube" });
  await expect(section).toBeVisible({ timeout: 5_000 });
  await section.click();
}

async function emitTauriEvent(
  page: import("@playwright/test").Page,
  event: string,
  payload: unknown,
): Promise<void> {
  await page.evaluate(
    ({ eventName, eventPayload }) => {
      const listeners = (
        window as unknown as Record<
          string,
          Record<string, Array<(event: { payload: unknown }) => void>>
        >
      ).__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) listener({ payload: eventPayload });
    },
    { eventName: event, eventPayload: payload },
  );
}

test("authenticated YouTube login captures followed channels and recent videos", async ({
  app,
  page,
  ipc,
}) => {
  const channelId = "UC1111111111111111111111";
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("yt_capture", () => new Promise((resolve) => {
    (window as unknown as Record<string, unknown>).__YOUTUBE_CAPTURE_RESOLVE__ = resolve;
  }));

  await openYouTubeSettings(page);
  await page.getByText("Log in with YouTube").click();
  await app.acceptProviderRiskIfPresent("youtube");
  await expect.poll(async () =>
    (await ipc.invocations()).some((call) => call.cmd === "yt_show_login")
  ).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__
  )).toBe(true);

  await emitTauriEvent(page, "yt-auth-result", { loggedIn: true });

  await expect(page.getByText("Connected. Syncing your subscriptions in the background.")).toBeVisible({
    timeout: 10_000,
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__
  )).toBe(false);
  await expect.poll(async () => {
    const calls = await ipc.invocations();
    const hideIndex = calls.findIndex((call) => call.cmd === "yt_hide_login");
    const captureIndex = calls.findIndex((call) => call.cmd === "yt_capture");
    return hideIndex >= 0 && captureIndex > hideIndex;
  }).toBe(true);

  let captureId = "";
  await expect.poll(async () => {
    const captureCall = (await ipc.invocations())
      .findLast((call) => call.cmd === "yt_capture");
    captureId = (captureCall?.args as { captureId?: string } | undefined)?.captureId ?? "";
    return captureId.length;
  }).toBeGreaterThan(0);

  await emitTauriEvent(page, "yt-capture-data", {
    captureId,
    stage: "channels",
    channels: [{ channelId, title: "Learning Channel" }],
    videos: [],
    channelTotal: 1,
    videoTotal: 0,
    unresolvedCount: 0,
    scrollPasses: 1,
    stopReason: "progress",
    done: false,
  });
  await emitTauriEvent(page, "yt-capture-data", {
    captureId,
    stage: "channels",
    channels: [],
    videos: [],
    rosterComplete: true,
    complete: false,
    channelTotal: 1,
    videoTotal: 0,
    unresolvedCount: 0,
    scrollPasses: 2,
    stopReason: "end-stable",
    done: true,
  });
  await emitTauriEvent(page, "yt-capture-data", {
    captureId,
    stage: "subscriptions",
    channels: [],
    videos: [{
      videoId: "dQw4w9WgXcQ",
      title: "Focused Study",
      channelId,
      channelTitle: "Learning Channel",
    }],
    rosterComplete: false,
    complete: false,
    channelTotal: 1,
    videoTotal: 1,
    unresolvedCount: 0,
    scrollPasses: 1,
    stopReason: "progress",
    done: false,
  });
  await emitTauriEvent(page, "yt-capture-data", {
    captureId,
    stage: "subscriptions",
    channels: [],
    videos: [],
    rosterComplete: false,
    complete: true,
    channelTotal: 1,
    videoTotal: 1,
    unresolvedCount: 0,
    scrollPasses: 2,
    stopReason: "end-stable",
    done: true,
  });
  await page.evaluate(({ expectedCaptureId, expectedChannelId }) => {
    const globals = window as unknown as Record<string, unknown>;
    const resolve = globals.__YOUTUBE_CAPTURE_RESOLVE__ as ((value: unknown) => void) | undefined;
    const channel = { channelId: expectedChannelId, title: "Learning Channel" };
    const video = {
      videoId: "dQw4w9WgXcQ",
      title: "Focused Study",
      channelId: expectedChannelId,
      channelTitle: "Learning Channel",
    };
    resolve?.({
      stages: [{
        captureId: expectedCaptureId,
        stage: "channels",
        channels: [channel],
        videos: [],
        rosterComplete: true,
        complete: false,
        channelTotal: 1,
        videoTotal: 0,
        candidateCount: 1,
        unresolvedCount: 0,
        scrollPasses: 2,
        stopReason: "end-stable",
        pageEvidence: true,
        explicitEmpty: false,
        unsupportedCandidateCount: 0,
        workBudgetExceeded: false,
        deadlineExceeded: false,
        pendingContinuation: false,
        done: true,
      }, {
        captureId: expectedCaptureId,
        stage: "subscriptions",
        channels: [channel],
        videos: [video],
        rosterComplete: false,
        complete: true,
        channelTotal: 1,
        videoTotal: 1,
        candidateCount: 1,
        unresolvedCount: 0,
        scrollPasses: 2,
        stopReason: "end-stable",
        pageEvidence: true,
        explicitEmpty: false,
        unsupportedCandidateCount: 0,
        workBudgetExceeded: false,
        deadlineExceeded: false,
        pendingContinuation: false,
        done: true,
      }],
    });
    delete globals.__YOUTUBE_CAPTURE_RESOLVE__;
  }, { expectedCaptureId: captureId, expectedChannelId: channelId });

  await expect(page.getByText("Connected. Subscription sync finished.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Found 1 followed channel and 1 video.")).toBeVisible();

  const stored = await page.evaluate(({ expectedChannelId }) => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        accounts: Record<string, unknown>;
        items: Array<{ globalId: string }>;
      };
    };
    const state = store.getState();
    return {
      hasChannel: Boolean(state.accounts[`social:youtube:${expectedChannelId}`]),
      hasVideo: state.items.some((item) => item.globalId === "youtube:yt:video:dQw4w9WgXcQ"),
    };
  }, { expectedChannelId: channelId });
  expect(stored).toEqual({ hasChannel: true, hasVideo: true });
});

test("YouTube login still syncs when the first hide request fails", async ({
  app,
  page,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("yt_hide_login", () => {
    throw new Error("Transient hide failure");
  });
  await ipc.setHandler("yt_capture", (args) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__ = false;
    const listeners = (
      window as unknown as Record<
        string,
        Record<string, Array<(event: { payload: unknown }) => void>>
      >
    ).__TAURI_EVENT_LISTENERS__ ?? {};
    const captureId = (args as { captureId?: string } | undefined)?.captureId;
    if (!captureId) throw new Error("Missing YouTube capture ID");
    const channelsPayload = {
      captureId,
      stage: "channels",
      channels: [],
      videos: [],
      rosterComplete: true,
      complete: false,
      channelTotal: 0,
      videoTotal: 0,
      candidateCount: 0,
      unresolvedCount: 0,
      scrollPasses: 1,
      stopReason: "end-stable",
      pageEvidence: true,
      explicitEmpty: true,
      unsupportedCandidateCount: 0,
      workBudgetExceeded: false,
      deadlineExceeded: false,
      pendingContinuation: false,
      done: true,
    };
    const subscriptionsPayload = {
      captureId,
      stage: "subscriptions",
      channels: [],
      videos: [],
      rosterComplete: false,
      complete: true,
      channelTotal: 0,
      videoTotal: 0,
      candidateCount: 0,
      unresolvedCount: 0,
      scrollPasses: 1,
      stopReason: "end-stable",
      pageEvidence: true,
      explicitEmpty: true,
      unsupportedCandidateCount: 0,
      workBudgetExceeded: false,
      deadlineExceeded: false,
      pendingContinuation: false,
      done: true,
    };
    for (const listener of listeners["yt-capture-data"] ?? []) {
      listener({ payload: channelsPayload });
      listener({ payload: subscriptionsPayload });
    }
    return { stages: [channelsPayload, subscriptionsPayload] };
  });

  await openYouTubeSettings(page);
  await page.getByText("Log in with YouTube").click();
  await app.acceptProviderRiskIfPresent("youtube");
  await emitTauriEvent(page, "yt-auth-result", { loggedIn: true });

  await expect(page.getByText("Connected. Subscription sync finished.")).toBeVisible({
    timeout: 10_000,
  });
  await expect.poll(async () => {
    const calls = await ipc.invocations();
    const hideIndex = calls.findIndex((call) => call.cmd === "yt_hide_login");
    const captureIndex = calls.findIndex((call) => call.cmd === "yt_capture");
    return hideIndex >= 0 && captureIndex > hideIndex;
  }).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_YOUTUBE_WINDOW_VISIBLE__
  )).toBe(false);
});

test("manually saved YouTube URLs sync through the rendered Freed Offline action", async ({
  app,
  page,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();
  await page.evaluate(async () => {
    const globals = window as unknown as Record<string, unknown>;
    const store = globals.__FREED_STORE__ as {
      setState: (next: Record<string, unknown>) => void;
    };
    store.setState({ ytAuth: { isAuthenticated: true, lastCheckedAt: Date.now() } });
    const automerge = globals.__FREED_AUTOMERGE__ as {
      docAddFeedItem: (item: unknown) => Promise<void>;
    };
    await automerge.docAddFeedItem({
      globalId: "saved:youtube:dQw4w9WgXcQ",
      platform: "saved",
      contentType: "article",
      capturedAt: Date.now(),
      publishedAt: Date.now(),
      author: { id: "channel", handle: "channel", displayName: "Learning Channel" },
      content: {
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Focused Study",
        },
      },
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      topics: [],
      userState: { hidden: false, saved: true, archived: false, tags: [] },
    });
  });
  await ipc.setHandler("yt_add_to_offline_playlist", (args) => {
    const listeners = (window as unknown as Record<string, Record<string, Array<(event: { payload: unknown }) => void>>>).__TAURI_EVENT_LISTENERS__ ?? {};
    const videoUrl = (args as { videoUrl?: string }).videoUrl ?? "";
    const videoId = new URL(videoUrl).searchParams.get("v");
    const payload = {
      videoId,
      result: "added",
      success: true,
      added: true,
      playlistId: "PL-freed-offline",
      playlistUrl: "https://www.youtube.com/playlist?list=PL-freed-offline",
    };
    for (const listener of listeners["yt-playlist-result"] ?? []) listener({ payload });
    return null;
  });

  await openYouTubeSettings(page);
  await expect(page.getByText("1 saved YouTube video.")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("youtube-sync-saved-playlist").click();
  await app.acceptProviderRiskIfPresent("youtube");

  await expect(page.getByText("1 added, 0 already confirmed. Freed Offline is up to date.")).toBeVisible({
    timeout: 10_000,
  });
  const calls = await ipc.invocations();
  expect(calls.filter((call) => call.cmd === "yt_add_to_offline_playlist")).toHaveLength(1);
});
