import { test, expect } from "./fixtures/app";

test("startup clears stale Facebook auth when local WebView cookies are logged out", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
      }),
    );
    window.localStorage.setItem(
      "fb_auth_state",
      JSON.stringify({ isAuthenticated: true, lastCheckedAt: 1775146800000 }),
    );

    (window as unknown as {
      __TAURI_MOCK_SOCIAL_COOKIE_STATES__: Record<string, unknown>;
    }).__TAURI_MOCK_SOCIAL_COOKIE_STATES__ = {
      facebook: {
        available: true,
        hasAuthCookie: false,
        cookieCount: 6,
        cookieNames: ["datr", "fr", "ps_l", "ps_n", "sb", "wd"],
        error: null,
      },
    };
  });

  await app.goto();
  await app.waitForReady();

  const authState = await page.evaluate(() => {
    const store = (window as unknown as {
      __FREED_STORE__: {
        getState: () => {
          fbAuth: { isAuthenticated: boolean; lastCaptureError?: string };
        };
      };
    }).__FREED_STORE__;
    return store.getState().fbAuth;
  });

  expect(authState).toEqual({
    isAuthenticated: false,
    lastCheckedAt: 1775146800000,
    lastCaptureError:
      "Facebook is not connected in the local WebView session. Reconnect Facebook and try again.",
  });

  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("fb_auth_state")))
    .toContain('"isAuthenticated":false');
});
