import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initiateGoogleOAuth } = vi.hoisted(() => ({
  initiateGoogleOAuth: vi.fn(),
}));

vi.mock("./cloud-oauth", () => ({
  getGoogleOAuthClientId: () => "youtube-client.apps.googleusercontent.com",
  initiateGoogleOAuth,
}));

import {
  clearYouTubeAuth,
  fetchYouTubeWithAuth,
  getStoredYouTubeToken,
  getValidYouTubeAccessToken,
  hasYouTubePlaylistAccess,
  initiateYouTubeOAuth,
  needsYouTubeReconnect,
  storeYouTubeToken,
} from "./youtube-auth";

const READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

describe("YouTube device-local OAuth credentials", () => {
  beforeEach(() => {
    localStorage.clear();
    initiateGoogleOAuth.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps YouTube credentials separate and never carries credentials across grants", () => {
    localStorage.setItem("freed_cloud_token_meta_gdrive", "drive-token-metadata");
    storeYouTubeToken({
      accessToken: "read-access",
      refreshToken: "read-refresh",
      scope: READ_SCOPE,
    });
    storeYouTubeToken({
      accessToken: "write-access",
      scope: WRITE_SCOPE,
    });

    expect(getStoredYouTubeToken()).toMatchObject({
      accessToken: "write-access",
      scope: WRITE_SCOPE,
    });
    expect(getStoredYouTubeToken()?.refreshToken).toBeUndefined();
    expect(hasYouTubePlaylistAccess()).toBe(true);
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBe("drive-token-metadata");
  });

  it("requests the write grant only for Freed Offline", async () => {
    await initiateYouTubeOAuth("readonly");
    await initiateYouTubeOAuth("playlist");

    expect(initiateGoogleOAuth).toHaveBeenNthCalledWith(1, "youtube", [READ_SCOPE]);
    expect(initiateGoogleOAuth).toHaveBeenNthCalledWith(2, "youtube", [WRITE_SCOPE]);
  });

  it("refreshes an expired token and preserves its scopes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T18:00:00.000Z"));
    storeYouTubeToken({
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1,
      scope: `${READ_SCOPE} ${WRITE_SCOPE}`,
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: "fresh-access",
      expires_in: 3600,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getValidYouTubeAccessToken()).resolves.toBe("fresh-access");
    expect(getStoredYouTubeToken()).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "refresh-token",
      scope: `${READ_SCOPE} ${WRITE_SCOPE}`,
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      grantType: "refresh_token",
      refreshToken: "refresh-token",
      clientId: "youtube-client.apps.googleusercontent.com",
    });
  });

  it("retries one API 401 with a refreshed bearer token", async () => {
    storeYouTubeToken({
      accessToken: "old-access",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60_000,
      scope: READ_SCOPE,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "fresh-access",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchYouTubeWithAuth("https://www.googleapis.com/youtube/v3/subscriptions"))
      .resolves.toMatchObject({ status: 200 });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer old-access");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer fresh-access");
  });

  it("marks a rejected refresh grant for explicit reconnection", async () => {
    storeYouTubeToken({
      accessToken: "expired-access",
      refreshToken: "revoked-refresh",
      expiresAt: Date.now() - 1,
      scope: READ_SCOPE,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "invalid_grant",
    }), { status: 400, headers: { "Content-Type": "application/json" } })));

    await expect(getValidYouTubeAccessToken()).rejects.toThrow("invalid_grant");
    expect(needsYouTubeReconnect()).toBe(true);
    await expect(getValidYouTubeAccessToken()).rejects.toThrow("Reconnect YouTube");
  });

  it("marks a repeated API 401 for explicit reconnection", async () => {
    storeYouTubeToken({
      accessToken: "old-access",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60_000,
      scope: READ_SCOPE,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "fresh-access",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchYouTubeWithAuth("https://www.googleapis.com/youtube/v3/subscriptions"))
      .resolves.toMatchObject({ status: 401 });
    expect(needsYouTubeReconnect()).toBe(true);
  });

  it("clears only the local YouTube credential", () => {
    localStorage.setItem("freed_cloud_token_meta_gdrive", "keep-me");
    storeYouTubeToken({ accessToken: "youtube-access" });
    clearYouTubeAuth();

    expect(getStoredYouTubeToken()).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBe("keep-me");
  });
});
