/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://dev-app.freed.wtf/oauth-callback"}
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
import { createGoogleOAuthState } from "../lib/oauth-redirect";

const STATE_NONCE = "state-nonce";

function setCallbackUrl(state: string): void {
  const params = new URLSearchParams({
    code: "authorization-code",
    state,
    oauth_relay: "1",
  });
  window.history.replaceState({}, "", `/oauth-callback?${params}`);
}

function stubTokenProxy() {
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
  return fetchMock;
}

async function renderCallback() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(OAuthCallback));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

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
    sessionStorage.clear();
    setCallbackUrl(createGoogleOAuthState(window.location.origin, STATE_NONCE));
    sessionStorage.setItem("freed_pkce_provider", "gdrive");
    sessionStorage.setItem("freed_pkce_verifier", "pkce-verifier");
    sessionStorage.setItem("freed_pkce_installation_generation", "7");
    sessionStorage.setItem(
      "freed_pkce_google_redirect_uri",
      "https://app.freed.wtf/oauth-callback",
    );
    sessionStorage.setItem("freed_pkce_google_state_nonce", STATE_NONCE);
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
    const fetchMock = stubTokenProxy();
    const { root } = await renderCallback();

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
    expect(sessionStorage.getItem("freed_pkce_google_state_nonce")).toBeNull();
    expect(syncMocks.storeCloudToken).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it.each([
    ["a missing state", () => setCallbackUrl("")],
    [
      "a state nonce this tab did not issue",
      () => setCallbackUrl(createGoogleOAuthState(window.location.origin, "forged")),
    ],
    [
      "a state for another origin",
      () => setCallbackUrl(createGoogleOAuthState("https://app.freed.wtf", STATE_NONCE)),
    ],
    [
      "no stored nonce",
      () => sessionStorage.removeItem("freed_pkce_google_state_nonce"),
    ],
  ])("refuses the token exchange for %s", async (_label, arrange) => {
    arrange();
    const fetchMock = stubTokenProxy();
    const { container, root } = await renderCallback();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncMocks.storeCloudToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain("missing required parameters");
    expect(sessionStorage.getItem("freed_pkce_verifier")).toBeNull();
    expect(sessionStorage.getItem("freed_pkce_google_state_nonce")).toBeNull();

    await act(async () => root.unmount());
  });
});
