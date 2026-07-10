import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredGoogleOAuthState,
  clearStoredGoogleOAuthScopes,
  createGoogleOAuthRelayTarget,
  createGoogleOAuthState,
  getStoredGoogleOAuthState,
  getStoredGoogleOAuthScopes,
  getGoogleOAuthRedirectUri,
  getOAuthCallbackUri,
  readGoogleOAuthState,
  storeGoogleOAuthState,
  storeGoogleOAuthScopes,
} from "./oauth-redirect";

describe("OAuth redirect helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("uses the production callback for dev Google OAuth", () => {
    expect(getGoogleOAuthRedirectUri("https://dev-app.freed.wtf")).toBe(
      "https://app.freed.wtf/oauth-callback",
    );
    expect(getGoogleOAuthRedirectUri("https://app.freed.wtf")).toBe(
      "https://app.freed.wtf/oauth-callback",
    );
    expect(getGoogleOAuthRedirectUri("http://localhost:1421")).toBe(
      "http://localhost:1421/oauth-callback",
    );
    expect(getGoogleOAuthRedirectUri("https://preview-aubreyfs-projects.vercel.app")).toBe(
      "https://preview-aubreyfs-projects.vercel.app/oauth-callback",
    );
  });

  it("relays a Google callback back to the original dev app origin", () => {
    vi.setSystemTime(new Date("2026-05-31T18:00:00.000Z"));

    const state = createGoogleOAuthState("https://dev-app.freed.wtf", "nonce");
    const params = new URLSearchParams({
      code: "auth-code",
      state,
      scope: "https://www.googleapis.com/auth/contacts.readonly",
    });

    expect(createGoogleOAuthRelayTarget("https://app.freed.wtf", params)).toBe(
      "https://dev-app.freed.wtf/oauth-callback?code=auth-code&state=" +
        encodeURIComponent(state) +
        "&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcontacts.readonly&oauth_relay=1",
    );
  });

  it("preserves the YouTube OAuth purpose through relay state", () => {
    const state = createGoogleOAuthState(
      "https://dev-app.freed.wtf",
      "youtube-nonce",
      "youtube",
    );

    expect(readGoogleOAuthState(state)?.purpose).toBe("youtube");
    expect(
      createGoogleOAuthRelayTarget(
        "https://app.freed.wtf",
        new URLSearchParams({ code: "auth-code", state }),
      ),
    ).toContain("https://dev-app.freed.wtf/oauth-callback");
  });

  it("stores the exact state value for callback verification", () => {
    const state = createGoogleOAuthState("http://localhost:1421", "nonce", "youtube");
    storeGoogleOAuthState(state);
    expect(getStoredGoogleOAuthState()).toBe(state);
    clearStoredGoogleOAuthState();
    expect(getStoredGoogleOAuthState()).toBeNull();
  });

  it("stores requested Google scopes for token response fallback", () => {
    storeGoogleOAuthScopes(["scope.read", "scope.write"]);
    expect(getStoredGoogleOAuthScopes()).toBe("scope.read scope.write");
    clearStoredGoogleOAuthScopes();
    expect(getStoredGoogleOAuthScopes()).toBeNull();
  });

  it("does not relay to untrusted origins", () => {
    const state = createGoogleOAuthState("https://dev-app.freed.wtf", "nonce");
    const decoded = JSON.parse(atob(state));
    decoded.returnOrigin = "https://attacker.example";
    const hostileState = btoa(JSON.stringify(decoded)).replace(/\+/g, "-").replace(/\//g, "_");

    expect(
      createGoogleOAuthRelayTarget(
        "https://app.freed.wtf",
        new URLSearchParams({ code: "auth-code", state: hostileState }),
      ),
    ).toBeNull();

    const wildcardPreviewState = createGoogleOAuthState(
      "https://hostile-aubreyfs-projects.vercel.app",
      "preview-nonce",
      "youtube",
    );
    expect(
      createGoogleOAuthRelayTarget(
        "https://app.freed.wtf",
        new URLSearchParams({ code: "auth-code", state: wildcardPreviewState }),
      ),
    ).toBeNull();
  });

  it("builds callback URLs from explicit origins", () => {
    expect(getOAuthCallbackUri("https://preview-aubreyfs-projects.vercel.app")).toBe(
      "https://preview-aubreyfs-projects.vercel.app/oauth-callback",
    );
  });
});
