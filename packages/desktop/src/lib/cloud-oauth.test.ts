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
    const oauthCalls: Array<{ url: string; body: string; contentType: string }> = [];
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "start_oauth_server") return 45555;
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push({
          url: String(args?.url ?? ""),
          body: String(args?.body ?? ""),
          contentType: String(args?.contentType ?? ""),
        });
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });

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

    return oauthCalls;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("exchanges Google desktop callbacks directly through native Google OAuth", async () => {
    const oauthCalls = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    expect(openedAuthUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(new URL(openedAuthUrl).searchParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");

    expect(oauthCalls).toHaveLength(1);
    const request = oauthCalls[0]!;
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(request.contentType).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(request.body);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toEqual(expect.any(String));
    expect(body.get("redirect_uri")).toBe("http://localhost:45555/callback");
    expect(body.get("client_id")).toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
    expect(body.has("client_secret")).toBe(false);
  });

  it("falls back to the public Google desktop client when local preview env is absent", async () => {
    vi.unstubAllEnvs();
    const oauthCalls = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    const openedParams = new URL(openedAuthUrl).searchParams;
    expect(openedParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
    expect(openedParams.get("redirect_uri")).toBe("http://localhost:45555/callback");

    const body = new URLSearchParams(oauthCalls[0]!.body);
    expect(body.get("redirect_uri")).toBe("http://localhost:45555/callback");
    expect(body.get("client_id")).toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
  });

  it("falls back to the public Google desktop client when local preview env is empty", async () => {
    vi.stubEnv("VITE_GDRIVE_DESKTOP_CLIENT_ID", "");
    const oauthCalls = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    expect(new URL(openedAuthUrl).searchParams.get("client_id"))
      .toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");

    const body = new URLSearchParams(oauthCalls[0]!.body);
    expect(body.get("client_id")).toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
  });

  it("exchanges non-default Google desktop clients directly unless proxy is forced", async () => {
    vi.stubEnv("VITE_GDRIVE_DESKTOP_CLIENT_ID", "custom-web-client.apps.googleusercontent.com");
    const oauthCalls = await completeGoogleOAuth();

    const openedAuthUrl = shellOpenMock.mock.calls[0]?.[0] as string;
    expect(new URL(openedAuthUrl).searchParams.get("client_id"))
      .toBe("custom-web-client.apps.googleusercontent.com");

    expect(oauthCalls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(oauthCalls[0]?.contentType).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(oauthCalls[0]!.body);
    expect(body.get("client_id")).toBe("custom-web-client.apps.googleusercontent.com");
    expect(body.get("redirect_uri")).toBe("http://localhost:45555/callback");
  });

  it("keeps the token proxy path only when explicitly forced", async () => {
    vi.stubEnv("VITE_GDRIVE_DESKTOP_CLIENT_ID", "custom-web-client.apps.googleusercontent.com");
    vi.stubEnv("VITE_GDRIVE_FORCE_TOKEN_PROXY", "1");
    const oauthCalls = await completeGoogleOAuth();

    expect(oauthCalls[0]?.url).toBe("https://app.freed.wtf/api/oauth/google");
    expect(oauthCalls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(oauthCalls[0]!.body)).toMatchObject({
      clientId: "custom-web-client.apps.googleusercontent.com",
      redirectUri: "http://localhost:45555/callback",
    });
  });

  it("refreshes Google desktop tokens through native Google OAuth", async () => {
    const oauthCalls: Array<{ url: string; body: string; contentType: string }> = [];
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push({
          url: String(args?.url ?? ""),
          body: String(args?.body ?? ""),
          contentType: String(args?.contentType ?? ""),
        });
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1,
    }));

    const { getValidCloudToken } = await import("./sync");

    await expect(getValidCloudToken("gdrive")).resolves.toBe("refreshed-access-token");
    expect(oauthCalls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(oauthCalls[0]?.contentType).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(oauthCalls[0]!.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-token");
    expect(body.get("client_id")).toBe("304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com");
  });

  it("cancels a pending Google desktop callback wait", async () => {
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
    expect(invokeMock).not.toHaveBeenCalledWith("google_oauth_proxy_request", expect.anything());
  });

  it("surfaces Google token response bodies from native exchange failures", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "start_oauth_server") return 45555;
      if (cmd === "google_oauth_proxy_request") {
        return {
          status: 400,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            error: "invalid_scope",
            error_description: "Contacts API has not been enabled.",
          }))),
        };
      }
      return null;
    });
    shellOpenMock.mockImplementation(async (authUrl: string) => {
      const state = new URL(authUrl).searchParams.get("state");
      if (!state) throw new Error("Missing OAuth state");
      queueMicrotask(() => {
        oauthListener?.({ payload: { code: "auth-code", state } });
      });
    });

    const { initiateDesktopOAuth } = await import("./sync");

    await expect(initiateDesktopOAuth("gdrive")).rejects.toThrow(
      "Google token exchange failed (400): Contacts API has not been enabled.",
    );
  });

  it("keeps non-JSON Google token failures actionable", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "start_oauth_server") return 45555;
      if (cmd === "google_oauth_proxy_request") {
        return {
          status: 502,
          headers: [["content-type", "text/html"]],
          body: Array.from(new TextEncoder().encode("<html>bad gateway</html>")),
        };
      }
      return null;
    });
    shellOpenMock.mockImplementation(async (authUrl: string) => {
      const state = new URL(authUrl).searchParams.get("state");
      if (!state) throw new Error("Missing OAuth state");
      queueMicrotask(() => {
        oauthListener?.({ payload: { code: "auth-code", state } });
      });
    });

    const { initiateDesktopOAuth } = await import("./sync");

    await expect(initiateDesktopOAuth("gdrive")).rejects.toThrow(
      "Google token exchange failed (502): <html>bad gateway</html>",
    );
  });
});
