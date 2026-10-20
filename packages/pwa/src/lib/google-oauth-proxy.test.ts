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

  it.each([
    "https://x-aubreyfs-projects.vercel.app",
    "https://attacker.example",
    "https://app.freed.wtf.attacker.example",
    "null",
  ])("rejects a browser request from foreign origin %s before calling Google", async (origin) => {
    const res = createResponse();

    await handler({
      method: "POST",
      headers: { origin, host: "app.freed.wtf" },
      body: { grantType: "refresh_token", refreshToken: "stolen-refresh-token" },
    }, res);

    expect(res.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["no Origin (Desktop and library service)", {}],
    ["the production PWA", { origin: "https://app.freed.wtf", host: "app.freed.wtf" }],
    ["the dev PWA", { origin: "https://dev-app.freed.wtf", host: "dev-app.freed.wtf" }],
    [
      "a preview calling its own deployment",
      {
        origin: "https://freed-pwa-abc-aubreyfs-projects.vercel.app",
        host: "freed-pwa-abc-aubreyfs-projects.vercel.app",
      },
    ],
  ])("allows refresh from %s", async (_label, headers) => {
    const res = createResponse();

    await handler({
      method: "POST",
      headers,
      body: { grantType: "refresh_token", refreshToken: "refresh-token" },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed bodies before calling Google", async () => {
    for (const body of [
      { grantType: "client_credentials" },
      { grantType: "refresh_token", refreshToken: { $ne: "" } },
      { code: "c", verifier: "v", redirectUri: "x".repeat(5000) },
    ]) {
      const res = createResponse();
      await handler({ method: "POST", body }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns only the OAuth error code from Google failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "invalid_grant",
        error_description: "Bad Request with secret-bearing detail",
      }),
    })));
    const res = createResponse();

    await handler({
      method: "POST",
      body: { grantType: "refresh_token", refreshToken: "refresh-token" },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "invalid_grant" });
  });
});
