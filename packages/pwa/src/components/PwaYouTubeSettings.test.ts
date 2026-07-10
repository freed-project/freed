/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  savedVideoUrls: [] as string[],
  tokenPresent: false,
  playlistAccess: false,
  reconnectRequired: false,
  initiateOAuth: vi.fn(),
  syncSavedVideos: vi.fn(),
  syncSubscriptions: vi.fn(),
}));

vi.mock("../lib/automerge", () => ({
  getSavedYouTubeVideoUrls: async () => mocks.savedVideoUrls,
}));

vi.mock("../lib/youtube-auth", () => ({
  clearYouTubeAuth: vi.fn(),
  getStoredYouTubeToken: () => mocks.tokenPresent ? { accessToken: "token" } : null,
  hasYouTubePlaylistAccess: () => mocks.playlistAccess,
  initiateYouTubeOAuth: mocks.initiateOAuth,
  needsYouTubeReconnect: () => mocks.reconnectRequired,
}));

vi.mock("../lib/youtube-integration", () => ({
  getYouTubeIntegrationState: () => ({
    subscriptionCount: 0,
    videoCount: 0,
    offlinePlaylistItemCount: 0,
  }),
  subscribeYouTubeIntegrationState: () => () => {},
  syncSavedYouTubeVideos: mocks.syncSavedVideos,
  syncYouTubeSubscriptions: mocks.syncSubscriptions,
}));

import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { PwaYouTubeSettings } from "./PwaYouTubeSettings";

const platform = {
  store: ((selector: (state: Record<string, unknown>) => unknown) => selector({})) as PlatformConfig["store"],
  SourceIndicator: null,
  HeaderSyncIndicator: null,
  SettingsExtraSections: null,
  LegalSettingsContent: null,
  FeedEmptyState: null,
  XSettingsContent: null,
  FacebookSettingsContent: null,
  InstagramSettingsContent: null,
  LinkedInSettingsContent: null,
  GoogleContactsSettingsContent: null,
  openUrl: vi.fn(),
} as unknown as PlatformConfig;

async function renderSettings() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(
      PlatformProvider,
      { value: platform, children: createElement(PwaYouTubeSettings) },
    ));
    await Promise.resolve();
  });
  return { container, root };
}

describe("PwaYouTubeSettings", () => {
  beforeEach(() => {
    mocks.savedVideoUrls = [];
    mocks.tokenPresent = false;
    mocks.playlistAccess = false;
    mocks.reconnectRequired = false;
    vi.clearAllMocks();
    mocks.syncSavedVideos.mockResolvedValue({ addedCount: 1, existingCount: 0 });
    mocks.syncSubscriptions.mockResolvedValue({
      subscriptionCount: 1,
      videoCount: 5,
      hydratedChannelCount: 1,
      skippedChannelCount: 0,
      recentVideosComplete: true,
    });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts with the read-only connection", async () => {
    const { container, root } = await renderSettings();
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Connect YouTube",
    );
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.initiateOAuth).toHaveBeenCalledWith("readonly");
    await act(async () => root.unmount());
  });

  it("reports when recent video enrichment is partial", async () => {
    mocks.tokenPresent = true;
    mocks.syncSubscriptions.mockResolvedValue({
      subscriptionCount: 3,
      videoCount: 5,
      hydratedChannelCount: 2,
      skippedChannelCount: 1,
      recentVideosComplete: false,
    });
    const { container, root } = await renderSettings();
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Sync followed videos",
    );

    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain(
      "Imported 3 followed channels and 5 recent videos. Recent video checks completed for 2 channels; 1 could not be checked.",
    );
    await act(async () => root.unmount());
  });

  it("syncs each canonical saved video once after playlist authorization", async () => {
    mocks.tokenPresent = true;
    mocks.playlistAccess = true;
    mocks.savedVideoUrls = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"];
    const { container, root } = await renderSettings();
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Sync 1 saved video",
    );
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.syncSavedVideos).toHaveBeenCalledWith();
    expect(container.textContent).toContain("1 added, 0 already present");
    await act(async () => root.unmount());
  });

  it("offers reconnection with the previously granted playlist scope", async () => {
    mocks.tokenPresent = true;
    mocks.playlistAccess = true;
    mocks.reconnectRequired = true;
    const { container, root } = await renderSettings();
    expect(container.textContent).toContain("Reconnect needed");
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Reconnect YouTube",
    );
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.initiateOAuth).toHaveBeenCalledWith("playlist");
    await act(async () => root.unmount());
  });
});
