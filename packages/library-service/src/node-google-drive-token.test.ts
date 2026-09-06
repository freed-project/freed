import { describe, expect, it, vi } from "vitest";

import { createNodeGoogleDriveTokenPortV1 } from "./node-google-drive-token.js";

describe("headless Google Drive token custody", () => {
  it("fences cached tokens permanently after the sealed record revision changes", async () => {
    let revision = "a".repeat(64);
    const fetcher = vi.fn(async () =>
      Response.json({ access_token: "synthetic-access", expires_in: 3_600 }),
    );
    const token = createNodeGoogleDriveTokenPortV1("library-record", {
      platform: "linux",
      credentialRevision: async () => revision,
      readCredential: async () =>
        JSON.stringify({ schemaVersion: 1, refreshToken: "synthetic-refresh" }),
      fetch: fetcher,
    });
    await expect(token.accessToken(new AbortController().signal)).resolves.toBe(
      "synthetic-access",
    );
    revision = "b".repeat(64);
    await expect(
      token.accessToken(new AbortController().signal),
    ).rejects.toThrow("drive_credential_unavailable");
    revision = "a".repeat(64);
    await expect(
      token.accessToken(new AbortController().signal),
    ).rejects.toThrow("drive_credential_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not make a refresh request after cancellation during credential reading", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn();
    const token = createNodeGoogleDriveTokenPortV1("library-record", {
      platform: "linux",
      fetch: fetcher,
      readCredential: async () => {
        controller.abort();
        return JSON.stringify({
          schemaVersion: 1,
          refreshToken: "synthetic-refresh",
        });
      },
    });
    await expect(token.accessToken(controller.signal)).rejects.toThrow(
      "startup_cancelled",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a refresh response when custody changes during the request", async () => {
    let revision = "a".repeat(64);
    const token = createNodeGoogleDriveTokenPortV1("library-record", {
      platform: "linux",
      credentialRevision: async () => revision,
      readCredential: async () =>
        JSON.stringify({ schemaVersion: 1, refreshToken: "synthetic-refresh" }),
      fetch: async () => {
        revision = "b".repeat(64);
        return Response.json({
          access_token: "must-not-be-returned",
          expires_in: 3_600,
        });
      },
    });
    await expect(
      token.accessToken(new AbortController().signal),
    ).rejects.toThrow("drive_credential_unavailable");
  });

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
