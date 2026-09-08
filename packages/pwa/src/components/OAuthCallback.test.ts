/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://freed-pwa-preview-aubreyfs-projects.vercel.app/oauth-callback"}
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const syncMocks = vi.hoisted(() => ({
  captureCloudLifecycle: vi.fn(() => ({ isCurrent: () => true })),
  startCloudSync: vi.fn(() => Promise.resolve()),
  storeCloudToken: vi.fn(),
}));

vi.mock("../lib/sync", () => syncMocks);
vi.mock("../lib/factory-reset-coordinator", () => ({
  assertPwaRuntimeCurrent: vi.fn(),
  capturePwaRuntimeLifecycle: vi.fn(() => ({
    generation: 7,
    isCurrent: () => true,
  })),
}));

import { OAuthCallback } from "./OAuthCallback";

describe("OAuthCallback", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/oauth-callback?code=authorization-code&oauth_relay=1",
    );
    sessionStorage.clear();
    sessionStorage.setItem("freed_pkce_provider", "gdrive");
    sessionStorage.setItem("freed_pkce_verifier", "pkce-verifier");
    sessionStorage.setItem("freed_pkce_installation_generation", "7");
    sessionStorage.setItem(
      "freed_pkce_google_redirect_uri",
      "https://app.freed.wtf/oauth-callback",
    );
    syncMocks.captureCloudLifecycle.mockClear();
    syncMocks.startCloudSync.mockClear();
    syncMocks.storeCloudToken.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
    document.body.replaceChildren();
  });

  it("preserves the authorization redirect URI through the callback exchange", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(OAuthCallback));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe("/api/oauth/google");
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "authorization-code",
      verifier: "pkce-verifier",
      redirectUri: "https://app.freed.wtf/oauth-callback",
    });
    expect(sessionStorage.getItem("freed_pkce_google_redirect_uri")).toBeNull();
    expect(syncMocks.storeCloudToken).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
