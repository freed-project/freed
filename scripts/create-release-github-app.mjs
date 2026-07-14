#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseTagPublisherInstallationReadiness } from "./lib/release-tag-publisher.mjs";

export const RELEASE_GITHUB_APP_ORGANIZATION = "freed-project";
export const RELEASE_GITHUB_APP_REPO = "freed-project/freed";
export const RELEASE_GITHUB_APP_NAME = "Freed Release Publisher";
export const RELEASE_GITHUB_APP_SLUG = "freed-release-publisher";
export const RELEASE_TAG_PUBLISHER_PATH =
  "/Library/Application Support/Freed/release-tag-publisher";
export const RELEASE_TAG_PUBLISHER_PROVISIONER_PATH =
  "/Library/Application Support/Freed/release-tag-publisher-provision";

const CALLBACK_PATH = "/github-app/callback";
const BOOTSTRAP_PATH = "/";
const MANIFEST_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALLATION_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALLATION_POLL_MS = 2_000;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const RELEASE_TAG_PUBLISHER_INSTALLER_PATH = path.join(
  SCRIPT_DIRECTORY,
  "release-tag-publisher-install.mjs",
);

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function stateRoot(candidate = undefined) {
  const configured =
    candidate ??
    process.env.FREED_AUTOMATION_STATE_ROOT ??
    path.join(os.homedir(), ".freed", "automation");
  if (!path.isAbsolute(configured)) {
    throw new Error("The release App state root must be absolute.");
  }
  return path.resolve(configured);
}

function openPrivateDirectory(directory, { recursive, label }) {
  try {
    mkdirSync(directory, { recursive, mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let descriptor;
  try {
    descriptor = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isDirectory() ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error(`${label} must be a private current-user directory.`);
    }
    fchmodSync(descriptor, 0o700);
    return descriptor;
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new Error(`${label} is invalid.`);
  }
}

function verifyPreparedExecutable(filePath, label) {
  if (
    !path.isAbsolute(filePath) ||
    !existsSync(filePath) ||
    realpathSync(filePath) !== filePath
  ) {
    throw new Error(`${label} is not installed at its fixed path.`);
  }
  const link = lstatSync(filePath);
  const metadata = statSync(filePath);
  if (
    link.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.mode & 0o111) === 0
  ) {
    throw new Error(`${label} is not a trusted root-owned executable.`);
  }
  let parent = path.dirname(filePath);
  while (true) {
    const parentMetadata = statSync(parent);
    if (
      !parentMetadata.isDirectory() ||
      parentMetadata.uid !== 0 ||
      (parentMetadata.mode & 0o022) !== 0
    ) {
      throw new Error(`${label} has an untrusted parent directory.`);
    }
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

export function verifyPreparedReleaseTagPublisher({
  publisherPath = RELEASE_TAG_PUBLISHER_PATH,
  provisionerPath = RELEASE_TAG_PUBLISHER_PROVISIONER_PATH,
} = {}) {
  verifyPreparedExecutable(publisherPath, "The release tag publisher host");
  verifyPreparedExecutable(
    provisionerPath,
    "The release tag publisher provisioner",
  );
  return { ready: true, publisherPath, provisionerPath };
}

export function buildReleaseGitHubAppManifest({ origin }) {
  const callbackUrl = new URL(CALLBACK_PATH, origin).toString();
  return {
    name: RELEASE_GITHUB_APP_NAME,
    url: "https://freed.wtf",
    description:
      "Creates one reviewed immutable release tag for freed-project/freed.",
    redirect_url: callbackUrl,
    public: false,
    default_permissions: { contents: "write" },
    default_events: [],
    request_oauth_on_install: false,
    setup_on_update: false,
  };
}

export function buildManifestBootstrapHtml({ manifest, state }) {
  const action = new URL(
    `https://github.com/organizations/${RELEASE_GITHUB_APP_ORGANIZATION}/settings/apps/new`,
  );
  action.searchParams.set("state", state);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Create Freed Release Publisher</title></head>
  <body>
    <p>Opening GitHub App registration.</p>
    <form id="release-app-manifest" method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
    </form>
    <script>document.getElementById("release-app-manifest").submit();</script>
  </body>
</html>`;
}

export function parseManifestCallback(requestUrl, expectedState, origin) {
  const callback = new URL(requestUrl, origin);
  if (callback.pathname !== CALLBACK_PATH) {
    throw new Error("The GitHub App callback path is invalid.");
  }
  const states = callback.searchParams.getAll("state");
  const codes = callback.searchParams.getAll("code");
  if (states.length !== 1 || !safeEqual(states[0], expectedState)) {
    throw new Error("The GitHub App callback state is invalid.");
  }
  if (codes.length !== 1 || !/^[A-Za-z0-9_-]{20,255}$/.test(codes[0])) {
    throw new Error("The GitHub App callback code is invalid.");
  }
  return { code: codes[0] };
}

export async function exchangeManifestCode(
  code,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (!/^[A-Za-z0-9_-]{20,255}$/.test(code)) {
    throw new Error("The GitHub App manifest code is invalid.");
  }
  const response = await fetchImpl(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Freed-release-app-bootstrap",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response?.ok) {
    throw new Error(
      `GitHub App manifest conversion failed with status ${Number(response?.status ?? 0).toLocaleString()}.`,
    );
  }
  return response.json();
}

export function validateManifestConversion(conversion) {
  const appId = Number(conversion?.id);
  const ownerId = Number(conversion?.owner?.id);
  const pem = conversion?.pem;
  if (
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    conversion?.slug !== RELEASE_GITHUB_APP_SLUG ||
    conversion?.name !== RELEASE_GITHUB_APP_NAME ||
    conversion?.external_url !== "https://freed.wtf" ||
    JSON.stringify(Object.keys(conversion?.permissions ?? {}).sort()) !==
      JSON.stringify(["contents", "metadata"]) ||
    conversion.permissions.contents !== "write" ||
    conversion.permissions.metadata !== "read" ||
    JSON.stringify(conversion?.events ?? []) !== JSON.stringify([]) ||
    !Number.isSafeInteger(ownerId) ||
    ownerId <= 0 ||
    conversion?.owner?.login !== RELEASE_GITHUB_APP_ORGANIZATION ||
    conversion?.owner?.type !== "Organization" ||
    typeof pem !== "string" ||
    pem.length < 256 ||
    pem.length > 32 * 1024 ||
    !/^-----BEGIN RSA PRIVATE KEY-----\n[\s\S]+\n-----END RSA PRIVATE KEY-----\n?$/.test(
      pem,
    )
  ) {
    throw new Error(
      "GitHub App manifest conversion did not return the expected private organization App identity.",
    );
  }
  const identity = {
    schemaVersion: 1,
    purpose: "freed-release-github-app-identity",
    organization: RELEASE_GITHUB_APP_ORGANIZATION,
    repo: RELEASE_GITHUB_APP_REPO,
    appId,
    appSlug: RELEASE_GITHUB_APP_SLUG,
    ownerId,
  };
  return { identity, pem };
}

export function provisionReleaseAppPrivateKey(
  pem,
  {
    spawn = spawnSync,
    provisionerPath = RELEASE_TAG_PUBLISHER_PROVISIONER_PATH,
    publisherPath = RELEASE_TAG_PUBLISHER_PATH,
  } = {},
) {
  const result = spawn(
    provisionerPath,
    ["provision", "--host", publisherPath],
    {
      input: pem,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    },
  );
  if (result?.error || result?.status !== 0) {
    throw new Error(
      "The installed release tag publisher provisioner rejected the GitHub App private key.",
    );
  }
}

export function activateReleaseTagPublisherBinding(
  identity,
  {
    exec = execFileSync,
    nodePath = process.execPath,
    installerPath = RELEASE_TAG_PUBLISHER_INSTALLER_PATH,
  } = {},
) {
  try {
    exec(
      nodePath,
      [
        installerPath,
        "activate",
        "--app-id",
        identity.appId.toLocaleString("en-US", { useGrouping: false }),
        "--app-slug",
        identity.appSlug,
      ],
      { stdio: "inherit" },
    );
  } catch {
    throw new Error(
      "The release tag publisher installer could not activate the App binding.",
    );
  }
}

export function releaseAppIdentityPath(candidateStateRoot = undefined) {
  return path.join(
    stateRoot(candidateStateRoot),
    "release-tag-publisher",
    "github-app.json",
  );
}

export function writeReleaseAppIdentity(
  identity,
  { stateRoot: candidateStateRoot = undefined } = {},
) {
  if (
    !hasExactKeys(identity, [
      "appId",
      "appSlug",
      "organization",
      "ownerId",
      "purpose",
      "repo",
      "schemaVersion",
    ]) ||
    identity.schemaVersion !== 1 ||
    identity.purpose !== "freed-release-github-app-identity" ||
    identity.organization !== RELEASE_GITHUB_APP_ORGANIZATION ||
    identity.repo !== RELEASE_GITHUB_APP_REPO ||
    !Number.isSafeInteger(identity.appId) ||
    identity.appId <= 0 ||
    identity.appSlug !== RELEASE_GITHUB_APP_SLUG ||
    !Number.isSafeInteger(identity.ownerId) ||
    identity.ownerId <= 0
  ) {
    throw new Error("The release GitHub App identity record is invalid.");
  }
  const filePath = releaseAppIdentityPath(candidateStateRoot);
  const root = stateRoot(candidateStateRoot);
  const directory = path.dirname(filePath);
  const rootDescriptor = openPrivateDirectory(root, {
    recursive: true,
    label: "The release GitHub App state root",
  });
  let directoryDescriptor;
  const temporaryPath = path.join(
    directory,
    `.github-app.${process.pid.toLocaleString("en-US", { useGrouping: false })}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    directoryDescriptor = openPrivateDirectory(directory, {
      recursive: false,
      label: "The release GitHub App identity directory",
    });
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, filePath);
    fsyncSync(directoryDescriptor);
    fsyncSync(rootDescriptor);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    closeSync(rootDescriptor);
  }
  return filePath;
}

export function releaseAppInstallationUrl(identity) {
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(identity.appSlug)}/installations/new`,
  );
  url.searchParams.set(
    "target_id",
    identity.ownerId.toLocaleString("en-US", { useGrouping: false }),
  );
  return url.toString();
}

export function verifyInstalledReleaseApp(
  identity,
  { exec = execFileSync, publisherPath = RELEASE_TAG_PUBLISHER_PATH } = {},
) {
  const output = exec(
    publisherPath,
    [
      "verify-installation",
      "--repo",
      identity.repo,
      "--app-id",
      identity.appId.toLocaleString("en-US", { useGrouping: false }),
      "--app-slug",
      identity.appSlug,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  let attestation;
  try {
    attestation = JSON.parse(output);
  } catch {
    throw new Error(
      "The installed release tag publisher returned invalid installation evidence.",
    );
  }
  return verifyReleaseTagPublisherInstallationReadiness(attestation, {
    repo: identity.repo,
    releaseAppId: identity.appId,
    releaseAppSlug: identity.appSlug,
  });
}

export async function pollReleaseAppInstallation(
  identity,
  {
    verifyInstallation = verifyInstalledReleaseApp,
    timeoutMs = INSTALLATION_TIMEOUT_MS,
    intervalMs = INSTALLATION_POLL_MS,
    now = Date.now,
    wait = sleep,
  } = {},
) {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    try {
      return verifyInstallation(identity);
    } catch {
      await wait(intervalMs);
    }
  }
  throw new Error(
    "Timed out waiting for the release GitHub App installation on freed-project/freed.",
  );
}

export async function completeReleaseGitHubAppCreation(
  conversion,
  {
    provisionPrivateKey = provisionReleaseAppPrivateKey,
    writeIdentity = writeReleaseAppIdentity,
    activatePublisher = activateReleaseTagPublisherBinding,
    openUrl = (url) =>
      execFileSync("/usr/bin/open", [url], { stdio: "ignore" }),
    pollInstallation = pollReleaseAppInstallation,
    onStatus = () => {},
  } = {},
) {
  const { identity, pem } = validateManifestConversion(conversion);
  onStatus("Installing the private App credential in the release publisher.");
  provisionPrivateKey(pem);
  writeIdentity(identity);
  onStatus("Activating the root-owned App identity binding.");
  activatePublisher(identity);
  const installationUrl = releaseAppInstallationUrl(identity);
  onStatus("Opening the selected-repository installation page.");
  openUrl(installationUrl);
  const installation = await pollInstallation(identity);
  return {
    status: "ready",
    repo: identity.repo,
    appId: identity.appId,
    appSlug: identity.appSlug,
    installationId: installation.installationId,
  };
}

function createCallbackServer({ state, timeoutMs = MANIFEST_TIMEOUT_MS }) {
  let settle;
  const callback = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  let origin;
  let settled = false;
  const server = http.createServer((request, response) => {
    try {
      if (request.method === "GET" && request.url === BOOTSTRAP_PATH) {
        const manifest = buildReleaseGitHubAppManifest({ origin });
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; form-action https://github.com",
          "Referrer-Policy": "no-referrer",
        });
        response.end(buildManifestBootstrapHtml({ manifest, state }));
        return;
      }
      if (request.method === "GET" && request.url?.startsWith(CALLBACK_PATH)) {
        const value = parseManifestCallback(request.url, state, origin);
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        response.end(
          "GitHub App registration received. Return to the terminal.\n",
        );
        if (!settled) {
          settled = true;
          settle.resolve(value);
        }
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found\n");
    } catch (error) {
      response.writeHead(403, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end("GitHub App callback rejected.\n");
      if (!settled) {
        settled = true;
        settle.reject(error);
      }
    }
  });
  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The release GitHub App loopback listener failed."));
        return;
      }
      origin = `http://127.0.0.1:${address.port.toLocaleString("en-US", { useGrouping: false })}`;
      resolve();
    });
  });
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      settle.reject(
        new Error("Timed out waiting for GitHub App registration."),
      );
    }
  }, timeoutMs);
  timeout.unref();
  return {
    server,
    listening,
    callback,
    get origin() {
      return origin;
    },
    close() {
      clearTimeout(timeout);
      server.close();
    },
  };
}

export async function createReleaseGitHubApp({
  verifyPreparedHost = verifyPreparedReleaseTagPublisher,
  openUrl = (url) => execFileSync("/usr/bin/open", [url], { stdio: "ignore" }),
  exchangeCode = exchangeManifestCode,
  completeCreation = completeReleaseGitHubAppCreation,
  onStatus = () => {},
} = {}) {
  verifyPreparedHost();
  const state = randomBytes(32).toString("hex");
  const listener = createCallbackServer({ state });
  try {
    await listener.listening;
    onStatus("Opening the private GitHub App manifest.");
    openUrl(`${listener.origin}${BOOTSTRAP_PATH}`);
    const { code } = await listener.callback;
    const conversion = await exchangeCode(code);
    return await completeCreation(conversion, { onStatus });
  } finally {
    listener.close();
  }
}

function main() {
  if (process.argv.length > 2) {
    if (
      process.argv.length === 3 &&
      ["--help", "-h"].includes(process.argv[2])
    ) {
      process.stdout.write(
        "Usage: node scripts/create-release-github-app.mjs\n",
      );
      return;
    }
    throw new Error("The release GitHub App helper does not accept arguments.");
  }
  if (
    process.platform !== "darwin" ||
    !Number.isSafeInteger(process.getuid?.()) ||
    process.getuid() <= 0
  ) {
    throw new Error(
      "The release GitHub App helper must run as the non-root owner on macOS.",
    );
  }
  createReleaseGitHubApp({
    onStatus(message) {
      process.stderr.write(`${message}\n`);
    },
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Release GitHub App creation failed."}\n`,
      );
      process.exitCode = 1;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
