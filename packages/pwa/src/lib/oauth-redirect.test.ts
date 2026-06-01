import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGoogleOAuthRelayTarget,
  createGoogleOAuthState,
  getGoogleOAuthRedirectUri,
  getOAuthCallbackUri,
} from "./oauth-redirect";

describe("OAuth redirect helpers", () => {
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
});
