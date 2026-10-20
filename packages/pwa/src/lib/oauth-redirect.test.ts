import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGoogleOAuthRelayTarget,
  createGoogleOAuthState,
  consumePwaOAuthRuntimeGeneration,
  getGoogleOAuthRedirectUri,
  getGoogleOAuthStartBlocker,
  getOAuthCallbackUri,
  isAllowedGoogleOAuthRelayOrigin,
  isGoogleOAuthCallbackStateValid,
  isPwaOAuthRuntimeGenerationValid,
  storePwaOAuthRuntimeGeneration,
} from "./oauth-redirect";

function encodeState(state: Record<string, unknown>): string {
  return btoa(JSON.stringify(state))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hostileRelayParams(returnOrigin: string): URLSearchParams {
  return new URLSearchParams({
    code: "victim-auth-code",
    state: encodeState({
      version: 1,
      provider: "gdrive",
      returnOrigin,
      redirectOrigin: "https://app.freed.wtf",
      nonce: "x",
      issuedAt: 0,
    }),
  });
}

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

  it.each([
    // Third-party Vercel scope or project whose hostname ends with the old suffix.
    "https://p-h-x-aubreyfs-projects.vercel.app",
    "https://x-aubreyfs-projects.vercel.app",
    "https://freed-pwa-git-main-aubreyfs-projects.vercel.app",
    "https://aubreyfs-projects.vercel.app",
    // Lookalikes and suffix confusion.
    "https://dev-app.freed.wtf.attacker.example",
    "https://evil-dev-app.freed.wtf",
    "https://dev-app.freed.wtf.vercel.app",
    "https://dev-app-freed.wtf",
    "https://DEV-APP.freed.wtf",
    // Userinfo, port, path, and trailing characters.
    "https://attacker@dev-app.freed.wtf",
    "https://dev-app.freed.wtf@attacker.example",
    "https://user:pass@dev-app.freed.wtf",
    "https://dev-app.freed.wtf:443",
    "https://dev-app.freed.wtf:8443",
    "https://dev-app.freed.wtf/",
    "https://dev-app.freed.wtf/oauth-callback",
    "https://dev-app.freed.wtf?x=1",
    "https://dev-app.freed.wtf#x",
    " https://dev-app.freed.wtf",
    // Scheme downgrade and non-web schemes.
    "http://dev-app.freed.wtf",
    "wss://dev-app.freed.wtf",
    "javascript:alert(1)",
    "tauri://localhost",
    // Local origins are never relay targets.
    "http://localhost:1421",
    "https://localhost:1421",
    "http://127.0.0.1:1421",
    // The relay itself and garbage.
    "https://app.freed.wtf",
    "",
    "null",
  ])("refuses to relay an authorization code to %s", (returnOrigin) => {
    expect(isAllowedGoogleOAuthRelayOrigin(returnOrigin, "")).toBe(false);
    expect(
      createGoogleOAuthRelayTarget("https://app.freed.wtf", hostileRelayParams(returnOrigin)),
    ).toBeNull();
  });

  it("relays only from the production relay origin with a matching redirect origin", () => {
    const params = hostileRelayParams("https://dev-app.freed.wtf");
    expect(createGoogleOAuthRelayTarget("https://app.freed.wtf", params)).not.toBeNull();
    expect(createGoogleOAuthRelayTarget("https://dev-app.freed.wtf", params)).toBeNull();
    expect(
      createGoogleOAuthRelayTarget("https://x-aubreyfs-projects.vercel.app", params),
    ).toBeNull();

    const wrongRedirect = new URLSearchParams({
      code: "auth-code",
      state: encodeState({
        version: 1,
        provider: "gdrive",
        returnOrigin: "https://dev-app.freed.wtf",
        redirectOrigin: "https://x-aubreyfs-projects.vercel.app",
        nonce: "x",
        issuedAt: 0,
      }),
    });
    expect(createGoogleOAuthRelayTarget("https://app.freed.wtf", wrongRedirect)).toBeNull();
    expect(
      createGoogleOAuthRelayTarget(
        "https://app.freed.wtf",
        new URLSearchParams({ code: "auth-code", state: "not-base64-json" }),
      ),
    ).toBeNull();
  });

  it("accepts only exact configured preview origins and never patterns", () => {
    const configured =
      " https://freed-pwa-git-feat-x-aubreyfs-projects.vercel.app ," +
      "https://*.vercel.app,*-aubreyfs-projects.vercel.app,http://insecure.example," +
      "https://trailing.example/,https://user@userinfo.example";

    expect(
      isAllowedGoogleOAuthRelayOrigin(
        "https://freed-pwa-git-feat-x-aubreyfs-projects.vercel.app",
        configured,
      ),
    ).toBe(true);
    expect(isAllowedGoogleOAuthRelayOrigin("https://dev-app.freed.wtf", configured)).toBe(true);
    for (const rejected of [
      "https://other-aubreyfs-projects.vercel.app",
      "https://x.vercel.app",
      "http://insecure.example",
      "https://trailing.example",
      "https://userinfo.example",
    ]) {
      expect(isAllowedGoogleOAuthRelayOrigin(rejected, configured)).toBe(false);
    }
  });

  it("validates callback state against this tab's nonce and origin", () => {
    const state = createGoogleOAuthState("https://dev-app.freed.wtf", "nonce-1");

    expect(isGoogleOAuthCallbackStateValid("https://dev-app.freed.wtf", state, "nonce-1")).toBe(
      true,
    );
    expect(isGoogleOAuthCallbackStateValid("https://dev-app.freed.wtf", state, "nonce-2")).toBe(
      false,
    );
    expect(isGoogleOAuthCallbackStateValid("https://dev-app.freed.wtf", state, null)).toBe(false);
    expect(isGoogleOAuthCallbackStateValid("https://dev-app.freed.wtf", state, "")).toBe(false);
    expect(isGoogleOAuthCallbackStateValid("https://app.freed.wtf", state, "nonce-1")).toBe(false);
    expect(isGoogleOAuthCallbackStateValid("https://dev-app.freed.wtf", null, "nonce-1")).toBe(
      false,
    );

    const direct = createGoogleOAuthState("http://localhost:1421", "nonce-3");
    expect(isGoogleOAuthCallbackStateValid("http://localhost:1421", direct, "nonce-3")).toBe(true);
  });

  it("blocks Google sign-in on unlisted Vercel deployments before contacting Google", () => {
    expect(getGoogleOAuthStartBlocker("https://app.freed.wtf")).toBeNull();
    expect(getGoogleOAuthStartBlocker("https://dev-app.freed.wtf")).toBeNull();
    expect(getGoogleOAuthStartBlocker("http://localhost:1421")).toBeNull();
    expect(getGoogleOAuthStartBlocker("https://freed-pwa-abc123-aubreyfs-projects.vercel.app")).toMatch(
      /preview deployment/,
    );
    expect(getGoogleOAuthStartBlocker("https://FREED.VERCEL.APP")).toMatch(/preview deployment/);
    expect(getGoogleOAuthRedirectUri("https://freed-pwa-abc123-aubreyfs-projects.vercel.app")).toBe(
      "https://freed-pwa-abc123-aubreyfs-projects.vercel.app/oauth-callback",
    );
  });

  it("builds callback URLs from explicit origins", () => {
    expect(getOAuthCallbackUri("https://preview-aubreyfs-projects.vercel.app")).toBe(
      "https://preview-aubreyfs-projects.vercel.app/oauth-callback",
    );
  });

  it("requires an exact installation generation for an OAuth callback", () => {
    storePwaOAuthRuntimeGeneration(7);

    const storedGeneration = consumePwaOAuthRuntimeGeneration();
    expect(isPwaOAuthRuntimeGenerationValid(storedGeneration, 7)).toBe(true);
    expect(isPwaOAuthRuntimeGenerationValid(storedGeneration, 8)).toBe(false);
    expect(consumePwaOAuthRuntimeGeneration()).toBeNull();
    expect(isPwaOAuthRuntimeGenerationValid(null, 7)).toBe(false);
  });

});
