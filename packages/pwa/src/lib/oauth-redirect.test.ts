import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGoogleOAuthRelayTarget,
  createGoogleOAuthState,
  clearPwaOAuthSessionState,
  getGoogleOAuthRedirectUri,
  getOAuthCallbackUri,
} from "./oauth-redirect";

describe("OAuth redirect helpers", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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
  });

  it("builds callback URLs from explicit origins", () => {
    expect(getOAuthCallbackUri("https://preview-aubreyfs-projects.vercel.app")).toBe(
      "https://preview-aubreyfs-projects.vercel.app/oauth-callback",
    );
  });

  it("clears every pending OAuth handoff value during factory reset", () => {
    window.sessionStorage.setItem("freed_pkce_provider", "gdrive");
    window.sessionStorage.setItem("freed_pkce_verifier", "secret-verifier");
    window.sessionStorage.setItem(
      "freed_pkce_google_redirect_uri",
      "https://app.freed.wtf/oauth-callback",
    );
    window.sessionStorage.setItem("unrelated", "keep-me");

    clearPwaOAuthSessionState();

    expect(window.sessionStorage.getItem("freed_pkce_provider")).toBeNull();
    expect(window.sessionStorage.getItem("freed_pkce_verifier")).toBeNull();
    expect(window.sessionStorage.getItem("freed_pkce_google_redirect_uri")).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep-me");
  });

  it("propagates OAuth session removal failures", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("session storage unavailable");
    });

    expect(() => clearPwaOAuthSessionState()).toThrow("session storage unavailable");
  });
});
