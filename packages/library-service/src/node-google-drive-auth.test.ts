import { describe, expect, it, vi } from "vitest";

import { authorizeNodeGoogleDriveV1 } from "./node-google-drive-auth.js";

describe("headless Google Drive PKCE authorization", () => {
  it("requests only Library Core Drive scopes and stores only the refresh token", async () => {
    let authorizationUrl: URL | null = null;
    let persisted = "";
    const proxyFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.code).toBe("authorization-code");
        expect(body.verifier).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(body.redirectUri).toMatch(
          /^http:\/\/127\.0\.0\.1:\d+\/callback$/u,
        );
        return new Response(
          JSON.stringify({
            access_token: "short-lived-access-token",
            refresh_token: "refresh-secret",
            expires_in: 3_600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const receipt = await authorizeNodeGoogleDriveV1("library-drive", {
      platform: "darwin",
      fetch: proxyFetch,
      async openAuthorizationUrl(url) {
        authorizationUrl = new URL(url);
        const callback = new URL(
          authorizationUrl.searchParams.get("redirect_uri")!,
        );
        callback.searchParams.set("code", "authorization-code");
        callback.searchParams.set(
          "state",
          authorizationUrl.searchParams.get("state")!,
        );
        setImmediate(() => void fetch(callback));
      },
      async persistCredential(_recordId, credential) {
        persisted = credential;
      },
    });

    expect(authorizationUrl).not.toBeNull();
    const scopes = authorizationUrl!.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/drive.appdata",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/contacts.readonly",
    );
    expect(JSON.parse(persisted)).toEqual({
      schemaVersion: 1,
      refreshToken: "refresh-secret",
    });
    expect(persisted).not.toContain("short-lived-access-token");
    expect(receipt).toEqual({
      schemaVersion: 1,
      provider: "google-drive",
      credentialRecordId: "library-drive",
      scopes,
    });
  });

  it("rejects a callback with the wrong state before token exchange", async () => {
    const proxyFetch = vi.fn();
    await expect(
      authorizeNodeGoogleDriveV1("library-drive", {
        platform: "darwin",
        fetch: proxyFetch,
        async openAuthorizationUrl(url) {
          const authorization = new URL(url);
          const callback = new URL(
            authorization.searchParams.get("redirect_uri")!,
          );
          callback.searchParams.set("code", "authorization-code");
          callback.searchParams.set("state", "wrong-state");
          setImmediate(() => void fetch(callback));
        },
        persistCredential: async () => undefined,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "drive_auth_failed" });
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
