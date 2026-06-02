import { describe, expect, it } from "vitest";
import {
  reconcileSocialAuthStateHint,
  type SocialProviderCookieState,
} from "./social-auth-cookie-state";

function cookieState(
  provider: SocialProviderCookieState["provider"],
  hasAuthCookie: boolean,
): SocialProviderCookieState {
  return {
    provider,
    available: true,
    hasAuthCookie,
    cookieCount: hasAuthCookie ? 1 : 0,
    cookieNames: hasAuthCookie ? ["c_user"] : [],
    error: null,
  };
}

describe("social auth cookie state", () => {
  it("clears stale Facebook auth when the local WebView cookie store lacks auth cookies", () => {
    const reconciled = reconcileSocialAuthStateHint(
      "facebook",
      { isAuthenticated: true, lastCheckedAt: 123 },
      cookieState("facebook", false),
    );

    expect(reconciled).toEqual({
      isAuthenticated: false,
      lastCheckedAt: 123,
      lastCaptureError:
        "Facebook is not connected in the local WebView session. Reconnect Facebook and try again.",
    });
  });

  it("keeps auth state when local cookie diagnostics are unavailable", () => {
    const auth = { isAuthenticated: true, lastCheckedAt: 123 };

    expect(reconcileSocialAuthStateHint("facebook", auth, null)).toBe(auth);
  });

  it("does not mark disconnected providers connected from cookie names alone", () => {
    const auth = { isAuthenticated: false };

    expect(reconcileSocialAuthStateHint("facebook", auth, cookieState("facebook", true))).toBe(auth);
  });
});
