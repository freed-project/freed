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
  await ipc.setHandler("yt_capture", () => {
    const listeners = (window as unknown as Record<string, Record<string, Array<(event: { payload: unknown }) => void>>>).__TAURI_EVENT_LISTENERS__ ?? {};
    const payload = {
      channels: [{ channelId: "UC1111111111111111111111", title: "Learning Channel" }],
      videos: [{
        videoId: "dQw4w9WgXcQ",
        title: "Focused Study",
        channelId: "UC1111111111111111111111",
        channelTitle: "Learning Channel",
      }],
      rosterComplete: true,
      complete: true,
      unresolvedCount: 0,
      scrollPasses: 2,
      stopReason: "stable",
      done: true,
    };
    for (const listener of listeners["yt-capture-data"] ?? []) listener({ payload });
    return null;
  });

  await openYouTubeSettings(page);
  await page.getByText("Log in with YouTube").click();
  await app.acceptProviderRiskIfPresent("youtube");
  await expect.poll(async () =>
    (await ipc.invocations()).some((call) => call.cmd === "yt_show_login")
  ).toBe(true);

  await emitTauriEvent(page, "yt-auth-result", { loggedIn: true });

  await expect(page.getByText("Connected. Subscription sync finished.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Found 1 followed channel and 1 video.")).toBeVisible();
  await expect.poll(async () =>
    (await ipc.invocations()).some((call) => call.cmd === "yt_hide_login")
  ).toBe(true);

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
