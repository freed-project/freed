import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const shellOpenMock = vi.fn();
let oauthListener: ((event: { payload: { code: string; state: string } }) => void) | null = null;
let unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, callback: typeof oauthListener) => {
    oauthListener = callback;
    return unlistenMock;
  }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: shellOpenMock,
}));

vi.mock("./automerge", () => ({
  getDocBinary: vi.fn(async () => new Uint8Array()),
  mergeDoc: vi.fn(),
  setRelayClientCount: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./provider-health", () => ({
  recordProviderHealthEvent: vi.fn(),
}));

describe("desktop Google OAuth", () => {
  beforeEach(() => {
    oauthListener = null;
    unlistenMock = vi.fn();
    vi.resetModules();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(45555);
    shellOpenMock.mockReset();
    vi.stubEnv(
      "VITE_GDRIVE_DESKTOP_CLIENT_ID",
      "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    );
    vi.stubEnv("VITE_GDRIVE_TOKEN_PROXY_URL", "https://app.freed.wtf/api/oauth/google");
    localStorage.clear();
  });

  async function completeGoogleOAuth() {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    shellOpenMock.mockImplementation(async (authUrl: string) => {
      const state = new URL(authUrl).searchParams.get("state");
      if (!state) throw new Error("Missing OAuth state");
      queueMicrotask(() => {
        oauthListener?.({ payload: { code: "auth-code", state } });
      });
    });

    const { initiateDesktopOAuth } = await import("./sync");
    const token = await initiateDesktopOAuth("gdrive");

    expect(token).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    return fetchMock;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("exchanges Google desktop callbacks through the token proxy using the desktop client", async () => {
    const fetchMock = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    expect(openedAuthUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(new URL(openedAuthUrl).searchParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [proxyUrl, request] = fetchMock.mock.calls[0]!;
    expect(proxyUrl).toBe("https://app.freed.wtf/api/oauth/google");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      code: "auth-code",
      verifier: expect.any(String),
      redirectUri: "http://localhost:45555/callback",
      clientId: "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    });
  });

  it("falls back to the public Google desktop client when local preview env is absent", async () => {
    vi.unstubAllEnvs();
    const fetchMock = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    const openedParams = new URL(openedAuthUrl).searchParams;
    expect(openedParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
    expect(openedParams.get("redirect_uri")).toBe("http://localhost:45555/callback");

    const [, request] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      redirectUri: "http://localhost:45555/callback",
      clientId: "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    });
  });

  it("falls back to the public Google desktop client when local preview env is empty", async () => {
    vi.stubEnv("VITE_GDRIVE_DESKTOP_CLIENT_ID", "");
    const fetchMock = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    expect(new URL(openedAuthUrl).searchParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");

    const [, request] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      clientId: "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    });
  });

  it("cancels a pending Google desktop callback wait", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    shellOpenMock.mockResolvedValue(undefined);

    const { initiateDesktopOAuth } = await import("./sync");
    const controller = new AbortController();
    const promise = initiateDesktopOAuth("gdrive", { signal: controller.signal });

    await vi.waitFor(() => {
      expect(shellOpenMock).toHaveBeenCalledTimes(1);
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(unlistenMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
