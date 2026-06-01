import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "../../api/oauth/google";

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("Google OAuth token proxy", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GDRIVE_CLIENT_ID", "pwa-client.apps.googleusercontent.com");
    vi.stubEnv("GDRIVE_CLIENT_SECRET", "pwa-secret");
    vi.stubEnv("GDRIVE_DESKTOP_CLIENT_ID", "desktop-client.apps.googleusercontent.com");
    vi.stubEnv("GDRIVE_DESKTOP_CLIENT_SECRET", "desktop-secret");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }),
    })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the desktop client secret for desktop token exchanges", async () => {
    const res = createResponse();

    await handler({
      method: "POST",
      body: {
        code: "auth-code",
        verifier: "verifier",
        redirectUri: "http://localhost:45555/callback",
        clientId: "desktop-client.apps.googleusercontent.com",
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = new URLSearchParams(String(init?.body ?? ""));
    expect(body.get("client_id")).toBe("desktop-client.apps.googleusercontent.com");
    expect(body.get("client_secret")).toBe("desktop-secret");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("http://localhost:45555/callback");
  });

  it("rejects unknown requested clients before calling Google", async () => {
    const res = createResponse();

    await handler({
      method: "POST",
      body: {
        code: "auth-code",
        verifier: "verifier",
        redirectUri: "http://localhost:45555/callback",
        clientId: "unknown-client.apps.googleusercontent.com",
      },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "OAuth client is not configured on server" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
