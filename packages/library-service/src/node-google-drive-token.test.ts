import { describe, expect, it, vi } from "vitest";

import { createNodeGoogleDriveTokenPortV1 } from "./node-google-drive-token.js";

describe("headless Google Drive token custody", () => {
  it("reads one refresh token from the platform boundary and caches only the access token", async () => {
    let nowMs = 1_000;
    const readCredential = vi.fn(async () =>
      JSON.stringify({ schemaVersion: 1, refreshToken: "refresh-secret" }),
    );
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toContain("refresh-secret");
        return new Response(
          JSON.stringify({ access_token: "access-secret", expires_in: 3_600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    const token = createNodeGoogleDriveTokenPortV1("library-record", {
      platform: "darwin",
      nowMs: () => nowMs,
      readCredential,
      fetch: fetcher,
    });

    await expect(token.accessToken(new AbortController().signal)).resolves.toBe(
      "access-secret",
    );
    nowMs += 1_000;
    await expect(token.accessToken(new AbortController().signal)).resolves.toBe(
      "access-secret",
    );
    expect(readCredential).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed without exposing a provider response", async () => {
    const token = createNodeGoogleDriveTokenPortV1("library-record", {
      platform: "darwin",
      readCredential: async () =>
        JSON.stringify({ schemaVersion: 1, refreshToken: "refresh-secret" }),
      fetch: async () =>
        new Response("refresh-secret provider diagnostic", { status: 401 }),
    });

    await expect(
      token.accessToken(new AbortController().signal),
    ).rejects.toMatchObject({
      code: "drive_auth_failed",
      message: "drive_auth_failed",
    });
  });
});
