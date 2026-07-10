/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  startCloudSync: vi.fn(),
  storeCloudToken: vi.fn(),
}));

vi.mock("../lib/sync", () => ({
  startCloudSync: syncMocks.startCloudSync,
  storeCloudToken: syncMocks.storeCloudToken,
}));

import { OAuthCallback } from "./OAuthCallback";
import {
  createGoogleOAuthState,
  storeGoogleOAuthRedirectUri,
  storeGoogleOAuthScopes,
  storeGoogleOAuthState,
} from "../lib/oauth-redirect";
import { getStoredYouTubeToken } from "../lib/youtube-auth";

async function flushEffects(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("OAuthCallback YouTube flow", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    syncMocks.startCloudSync.mockReset();
    syncMocks.storeCloudToken.mockReset();
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("stores a separate YouTube token and falls back to the requested scopes", async () => {
    const state = createGoogleOAuthState(window.location.origin, "nonce", "youtube");
    const requestedScope = "https://www.googleapis.com/auth/youtube.force-ssl";
    sessionStorage.setItem("freed_pkce_provider", "youtube");
    sessionStorage.setItem("freed_pkce_verifier", "verifier");
    storeGoogleOAuthRedirectUri(`${window.location.origin}/oauth-callback`);
    storeGoogleOAuthState(state);
    storeGoogleOAuthScopes([requestedScope]);
    localStorage.setItem("freed_youtube_integration_v1", JSON.stringify({
      subscriptionCount: 42,
      videoCount: 99,
      offlinePlaylistId: "other-account-playlist",
      offlinePlaylistUrl: "https://www.youtube.com/playlist?list=other-account-playlist",
      offlinePlaylistItemCount: 7,
    }));
    window.history.replaceState(
      null,
      "",
      `/oauth-callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "youtube-access",
      refresh_token: "youtube-refresh",
      expires_in: 3600,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(OAuthCallback));
    });
    await flushEffects();

    expect(container.textContent).toContain("YouTube connected");
    expect(getStoredYouTubeToken()).toMatchObject({
      accessToken: "youtube-access",
      refreshToken: "youtube-refresh",
      scope: requestedScope,
    });
    expect(syncMocks.storeCloudToken).not.toHaveBeenCalled();
    expect(syncMocks.startCloudSync).not.toHaveBeenCalled();
    expect(localStorage.getItem("freed_youtube_integration_v1")).toBeNull();

    await act(async () => root.unmount());
  });
});
