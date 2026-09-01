import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { LibraryServiceFailure } from "./contracts.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_HELPER = "/usr/bin/security";
const OPEN_HELPER = "/usr/bin/open";
const KEYCHAIN_SERVICE = "wtf.freed.library-service.google-drive";
const TOKEN_PROXY_URL = "https://app.freed.wtf/api/oauth/google";
const GOOGLE_DESKTOP_CLIENT_ID =
  "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
] as const;
const CALLBACK_TIMEOUT_MS = 5 * 60_000;
const MAX_SECRET_BYTES = 16_384;

export interface NodeGoogleDriveAuthDependenciesV1 {
  readonly platform?: NodeJS.Platform;
  readonly fetch?: typeof fetch;
  readonly openAuthorizationUrl?: (url: string) => Promise<void>;
  readonly persistCredential?: (
    recordId: string,
    credential: string,
  ) => Promise<void>;
  readonly timeoutMs?: number;
}

export interface NodeGoogleDriveAuthReceiptV1 {
  readonly schemaVersion: 1;
  readonly provider: "google-drive";
  readonly credentialRecordId: string;
  readonly scopes: typeof GOOGLE_DRIVE_SCOPES;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function openAuthorizationUrl(url: string): Promise<void> {
  try {
    await execFileAsync(OPEN_HELPER, [url], {
      encoding: "utf8",
      maxBuffer: 1_024,
      timeout: 5_000,
      windowsHide: true,
    });
  } catch {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
}

async function persistMacOsCredential(
  recordId: string,
  credential: string,
): Promise<void> {
  if (Buffer.byteLength(credential, "utf8") > MAX_SECRET_BYTES) {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      KEYCHAIN_HELPER,
      [
        "add-generic-password",
        "-a",
        recordId,
        "-s",
        KEYCHAIN_SERVICE,
        "-U",
        "-w",
      ],
      {
        cwd: "/",
        env: {},
        shell: false,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      },
    );
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error === undefined) resolve();
      else reject(new LibraryServiceFailure("drive_auth_failed"));
    };
    child.once("error", finish);
    child.once("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error("keychain write failed"));
    });
    child.stdin.on("error", finish);
    child.stdin.end(`${credential}\n`, "utf8");
  });
}

async function receiveAuthorizationCode(input: {
  readonly state: string;
  readonly timeoutMs: number;
  readonly open: (url: string) => Promise<void>;
  readonly buildUrl: (redirectUri: string) => string;
}): Promise<{ readonly code: string; readonly redirectUri: string }> {
  let settle:
    | ((result: {
        readonly code: string;
        readonly redirectUri: string;
      }) => void)
    | null = null;
  let refuse: ((error: unknown) => void) | null = null;
  const callback = new Promise<{
    readonly code: string;
    readonly redirectUri: string;
  }>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  let redirectUri = "";
  const server = createServer((request, response) => {
    const remote = request.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1") {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "", redirectUri);
    } catch {
      response.writeHead(400).end("Invalid callback");
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.pathname !== "/callback" || state !== input.state || !code) {
      response.writeHead(400).end("Google Drive authorization did not match.");
      refuse?.(new LibraryServiceFailure("drive_auth_failed"));
      return;
    }
    response
      .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Google Drive is connected. You can close this tab.");
    settle?.({ code, redirectUri });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new LibraryServiceFailure("drive_auth_failed");
    }
    redirectUri = `http://127.0.0.1:${address.port.toLocaleString("en-US", { useGrouping: false })}/callback`;
    await input.open(input.buildUrl(redirectUri));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new LibraryServiceFailure("drive_auth_failed")),
        input.timeoutMs,
      );
      callback.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  } catch (error) {
    if (error instanceof LibraryServiceFailure) throw error;
    throw new LibraryServiceFailure("drive_auth_failed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Complete one interactive PKCE grant and persist only the refresh token. */
export async function authorizeNodeGoogleDriveV1(
  recordId: string,
  dependencies: NodeGoogleDriveAuthDependenciesV1 = {},
): Promise<NodeGoogleDriveAuthReceiptV1> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(recordId)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "darwin" && dependencies.persistCredential === undefined) {
    throw new LibraryServiceFailure("unsupported_secret_store_or_acl_backend");
  }
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "utf8").digest(),
  );
  const state = randomUUID();
  const { code, redirectUri } = await receiveAuthorizationCode({
    state,
    timeoutMs: dependencies.timeoutMs ?? CALLBACK_TIMEOUT_MS,
    open: dependencies.openAuthorizationUrl ?? openAuthorizationUrl,
    buildUrl(callbackUri) {
      const params = new URLSearchParams({
        client_id: GOOGLE_DESKTOP_CLIENT_ID,
        redirect_uri: callbackUri,
        response_type: "code",
        scope: GOOGLE_DRIVE_SCOPES.join(" "),
        include_granted_scopes: "true",
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    },
  });
  const proxyFetch = dependencies.fetch ?? fetch;
  let response: Response;
  try {
    response = await proxyFetch(TOKEN_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        verifier,
        redirectUri,
        clientId: GOOGLE_DESKTOP_CLIENT_ID,
      }),
    });
  } catch {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
  if (!response.ok) throw new LibraryServiceFailure("drive_auth_failed");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
  const refreshToken =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as { refresh_token?: unknown }).refresh_token
      : null;
  if (
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    Buffer.byteLength(refreshToken, "utf8") > MAX_SECRET_BYTES
  ) {
    throw new LibraryServiceFailure("drive_auth_failed");
  }
  const credential = JSON.stringify({ schemaVersion: 1, refreshToken });
  await (dependencies.persistCredential ?? persistMacOsCredential)(
    recordId,
    credential,
  );
  return Object.freeze({
    schemaVersion: 1,
    provider: "google-drive",
    credentialRecordId: recordId,
    scopes: GOOGLE_DRIVE_SCOPES,
  });
}
