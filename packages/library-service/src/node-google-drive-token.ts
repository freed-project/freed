import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LibraryServiceFailure } from "./contracts.js";
import type { LibraryServiceGoogleDriveTokenPortV1 } from "./google-drive-publication.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_HELPER = "/usr/bin/security";
const KEYCHAIN_SERVICE = "wtf.freed.library-service.google-drive";
const TOKEN_PROXY_URL = "https://app.freed.wtf/api/oauth/google";
const GOOGLE_DESKTOP_CLIENT_ID =
  "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com";
const MAX_SECRET_BYTES = 16_384;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const TOKEN_REFRESH_FALLBACK_MS = 55 * 60_000;

interface StoredGoogleDriveCredentialV1 {
  readonly schemaVersion: 1;
  readonly refreshToken: string;
}

interface TokenProxyResponseV1 {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
}

export interface NodeGoogleDriveTokenDependenciesV1 {
  readonly platform?: NodeJS.Platform;
  readonly nowMs?: () => number;
  readonly readCredential?: (recordId: string) => Promise<string>;
  readonly fetch?: typeof fetch;
}

function parseStoredCredential(text: string): StoredGoogleDriveCredentialV1 {
  if (Buffer.byteLength(text, "utf8") > MAX_SECRET_BYTES) {
    throw new LibraryServiceFailure("drive_credential_unavailable");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LibraryServiceFailure("drive_credential_unavailable");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(",") !== "refreshToken,schemaVersion" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (value as { refreshToken?: unknown }).refreshToken !== "string" ||
    (value as { refreshToken: string }).refreshToken.length === 0 ||
    Buffer.byteLength(
      (value as { refreshToken: string }).refreshToken,
      "utf8",
    ) > MAX_SECRET_BYTES
  ) {
    throw new LibraryServiceFailure("drive_credential_unavailable");
  }
  return Object.freeze({
    schemaVersion: 1,
    refreshToken: (value as { refreshToken: string }).refreshToken,
  });
}

async function readMacOsCredential(recordId: string): Promise<string> {
  try {
    const result = await execFileAsync(
      KEYCHAIN_HELPER,
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", recordId, "-w"],
      {
        encoding: "utf8",
        maxBuffer: MAX_SECRET_BYTES + 1,
        timeout: 5_000,
        windowsHide: true,
      },
    );
    return result.stdout.trimEnd();
  } catch {
    throw new LibraryServiceFailure("drive_credential_unavailable");
  }
}

function parseAccessToken(
  value: TokenProxyResponseV1,
  nowMs: number,
): { readonly accessToken: string; readonly expiresAt: number } {
  if (
    typeof value.access_token !== "string" ||
    value.access_token.length === 0 ||
    Buffer.byteLength(value.access_token, "utf8") > MAX_SECRET_BYTES
  ) {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
  const expiresAt =
    typeof value.expires_in === "number" &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in > 0 &&
    value.expires_in <= 86_400
      ? nowMs + value.expires_in * 1_000
      : nowMs + TOKEN_REFRESH_FALLBACK_MS;
  return Object.freeze({ accessToken: value.access_token, expiresAt });
}

/** Resolve short-lived Google Drive access tokens without persisting them. */
export function createNodeGoogleDriveTokenPortV1(
  recordId: string,
  dependencies: NodeGoogleDriveTokenDependenciesV1 = {},
): LibraryServiceGoogleDriveTokenPortV1 {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(recordId)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "darwin" && dependencies.readCredential === undefined) {
    throw new LibraryServiceFailure("unsupported_secret_store_or_acl_backend");
  }
  const readCredential = dependencies.readCredential ?? readMacOsCredential;
  const googleFetch = dependencies.fetch ?? fetch;
  const now = dependencies.nowMs ?? Date.now;
  let cached: {
    readonly accessToken: string;
    readonly expiresAt: number;
  } | null = null;
  let pending: Promise<string> | null = null;

  return Object.freeze({
    async accessToken(signal: AbortSignal): Promise<string> {
      const currentTime = now();
      if (
        cached !== null &&
        cached.expiresAt - currentTime > TOKEN_REFRESH_SKEW_MS
      ) {
        return cached.accessToken;
      }
      if (pending !== null) return pending;
      pending = (async () => {
        if (signal.aborted) {
          throw new LibraryServiceFailure("startup_cancelled");
        }
        const credential = parseStoredCredential(
          await readCredential(recordId),
        );
        let response: Response;
        try {
          response = await googleFetch(TOKEN_PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grantType: "refresh_token",
              refreshToken: credential.refreshToken,
              clientId: GOOGLE_DESKTOP_CLIENT_ID,
            }),
            signal,
          });
        } catch {
          throw new LibraryServiceFailure("drive_auth_failed");
        }
        if (!response.ok) {
          throw new LibraryServiceFailure("drive_auth_failed");
        }
        let payload: TokenProxyResponseV1;
        try {
          payload = (await response.json()) as TokenProxyResponseV1;
        } catch {
          throw new LibraryServiceFailure("drive_auth_failed");
        }
        cached = parseAccessToken(payload, now());
        return cached.accessToken;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  });
}
