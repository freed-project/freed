import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activateReleaseTagPublisherBinding,
  assertReleaseAppPrivateKeyStrength,
  assertReleaseAppPrivateKeyAbsent,
  buildManifestBootstrapHtml,
  buildReleaseGitHubAppManifest,
  completeReleaseGitHubAppCreation,
  createReleaseGitHubApp,
  exchangeManifestCode,
  finalizeReleaseTagPublisherBinding,
  parseManifestCallback,
  provisionReleaseAppPrivateKey,
  releaseAppIdentityPath,
  validateManifestConversion,
  verifyInstalledReleaseApp,
  writeReleaseAppIdentity,
} from "./create-release-github-app.mjs";

const pem = generateKeyPairSync("rsa", { modulusLength: 2_048 })
  .privateKey.export({ format: "pem", type: "pkcs1" })
  .toString();
const credentialTestHome = realpathSync(os.userInfo().homedir);

function createCredentialTestDirectory(label) {
  return realpathSync(
    mkdtempSync(path.join(credentialTestHome, `.freed-${label}-`)),
  );
}

function conversion() {
  return {
    id: 123456,
    slug: "freed-release-publisher",
    name: "Freed Release Publisher",
    external_url: "https://freed.wtf",
    permissions: { contents: "write", metadata: "read" },
    events: [],
    owner: { id: 257444947, login: "freed-project", type: "Organization" },
    pem,
    client_secret: "client-secret-must-not-survive",
    webhook_secret: "webhook-secret-must-not-survive",
  };
}

function installationReadiness() {
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-installation-readiness",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    appName: "Freed Release Publisher",
    appExternalUrl: "https://freed.wtf",
    appOwnerLogin: "freed-project",
    appOwnerType: "Organization",
    appPermissions: { contents: "write", metadata: "read" },
    appEvents: [],
    installationId: 42,
    accountLogin: "freed-project",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: { contents: "write", metadata: "read" },
    repositories: ["freed-project/freed"],
  };
}

test("release App manifest is private, event-free, and Contents-only", () => {
  const manifest = buildReleaseGitHubAppManifest({
    origin: "http://127.0.0.1:43123",
  });
  assert.deepEqual(Object.keys(manifest).sort(), [
    "default_events",
    "default_permissions",
    "description",
    "name",
    "public",
    "redirect_url",
    "request_oauth_on_install",
    "setup_on_update",
    "url",
  ]);
  assert.equal("hook_attributes" in manifest, false);
  assert.deepEqual(manifest, {
    name: "Freed Release Publisher",
    url: "https://freed.wtf",
    description:
      "Creates one reviewed immutable release tag for freed-project/freed.",
    redirect_url: "http://127.0.0.1:43123/github-app/callback",
    public: false,
    default_permissions: { contents: "write" },
    default_events: [],
    request_oauth_on_install: false,
    setup_on_update: false,
  });
  const html = buildManifestBootstrapHtml({
    manifest,
    state: "f".repeat(64),
  });
  assert.match(
    html,
    /organizations\/freed-project\/settings\/apps\/new\?state=/,
  );
  assert.match(html, /method="post"/);
  assert.doesNotMatch(html, /hook_attributes|inactive-webhook/);
  assert.doesNotMatch(html, /client_secret|webhook_secret|BEGIN RSA/);
});

test("installed App verification has a hard native deadline", () => {
  const calls = [];
  const result = verifyInstalledReleaseApp(
    {
      repo: "freed-project/freed",
      appId: 123456,
      appSlug: "freed-release-publisher",
    },
    {
      publisherPath: "/fixed/release-tag-publisher",
      exec(file, args, options) {
        calls.push({ file, args, options });
        return JSON.stringify(installationReadiness());
      },
    },
  );
  assert.equal(result.installationId, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/fixed/release-tag-publisher");
  assert.equal(calls[0].options.timeout, 30_000);
  assert.equal(calls[0].options.env.PATH, "/usr/bin:/bin");
  assert.deepEqual(Object.keys(calls[0].options.env).sort(), ["HOME", "PATH"]);
});

test("manifest callback rejects missing, duplicated, and incorrect CSRF state", () => {
  const origin = "http://127.0.0.1:43123";
  const state = "a".repeat(64);
  const code = "b".repeat(40);
  assert.deepEqual(
    parseManifestCallback(
      `/github-app/callback?code=${code}&state=${state}`,
      state,
      origin,
    ),
    { code },
  );
  for (const callback of [
    `/github-app/callback?code=${code}`,
    `/github-app/callback?code=${code}&state=${"c".repeat(64)}`,
    `/github-app/callback?code=${code}&state=${state}&state=${state}`,
  ]) {
    assert.throws(
      () => parseManifestCallback(callback, state, origin),
      /callback state is invalid/,
    );
  }
});

test("manifest exchange never sends credentials", async () => {
  const calls = [];
  const result = await exchangeManifestCode("d".repeat(40), {
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        async json() {
          return conversion();
        },
      };
    },
  });
  assert.equal(result.id, 123456);
  assert.deepEqual(calls[0].options.method, "POST");
  assert.equal("body" in calls[0].options, false);
  assert.equal("Authorization" in calls[0].options.headers, false);
});

test("private key is atomically saved only in the fixed private local path", (t) => {
  const home = createCredentialTestDirectory("release-home");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const canonicalHome = home;
  assert.equal(
    assertReleaseAppPrivateKeyAbsent({ homeDirectory: canonicalHome }).ready,
    true,
  );
  const keyPath = provisionReleaseAppPrivateKey(pem, {
    homeDirectory: canonicalHome,
  });
  assert.equal(
    keyPath,
    path.join(
      canonicalHome,
      ".freed",
      "credentials",
      "github-apps",
      "freed-release-publisher.private-key.pem",
    ),
  );
  assert.equal(readFileSync(keyPath, "utf8"), pem);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(keyPath)).mode & 0o777, 0o700);
  assert.equal(
    statSync(path.join(canonicalHome, ".freed", "credentials")).mode & 0o777,
    0o700,
  );
  assert.throws(
    () =>
      provisionReleaseAppPrivateKey("not a private key", {
        homeDirectory: home,
      }),
    /not valid PKCS1 PEM/,
  );
  assert.throws(
    () =>
      provisionReleaseAppPrivateKey(pem, {
        homeDirectory: canonicalHome,
      }),
    /EEXIST|exists/,
  );
  assert.throws(
    () => assertReleaseAppPrivateKeyAbsent({ homeDirectory: canonicalHome }),
    /credential already exists/,
  );
});

test("private key storage rejects weak keys and unsafe state ancestors", (t) => {
  assert.throws(
    () =>
      assertReleaseAppPrivateKeyStrength({
        asymmetricKeyType: "rsa",
        asymmetricKeyDetails: { modulusLength: 1_024 },
      }),
    /at least 2,048 bits/,
  );

  const symlinkHome = createCredentialTestDirectory("release-symlink-home");
  t.after(() => rmSync(symlinkHome, { recursive: true, force: true }));
  const target = path.join(symlinkHome, "redirected");
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, path.join(symlinkHome, ".freed"), "dir");
  assert.throws(
    () => assertReleaseAppPrivateKeyAbsent({ homeDirectory: symlinkHome }),
    /Freed state root must use a canonical absolute path/,
  );
  assert.throws(
    () =>
      provisionReleaseAppPrivateKey(pem, { homeDirectory: symlinkHome }),
    /Freed state root must use a canonical absolute path/,
  );

  const unsafeHome = createCredentialTestDirectory("release-unsafe-home");
  t.after(() => rmSync(unsafeHome, { recursive: true, force: true }));
  const unsafeRoot = path.join(unsafeHome, ".freed");
  mkdirSync(unsafeRoot, { mode: 0o700 });
  chmodSync(unsafeRoot, 0o777);
  assert.throws(
    () => assertReleaseAppPrivateKeyAbsent({ homeDirectory: unsafeHome }),
    /Freed state root must be a protected current-user directory/,
  );
  assert.throws(
    () => provisionReleaseAppPrivateKey(pem, { homeDirectory: unsafeHome }),
    /Freed state root must be a protected current-user directory/,
  );
});

test("unsafe credential preflight stops before GitHub or host setup", async () => {
  const calls = [];
  await assert.rejects(
    createReleaseGitHubApp({
      verifyCredentialAbsent() {
        calls.push("preflight");
        throw new Error("Unsafe credential directory.");
      },
      verifyPreparedHost() {
        calls.push("host");
      },
      openUrl() {
        calls.push("browser");
      },
    }),
    /Unsafe credential directory/,
  );
  assert.deepEqual(calls, ["preflight"]);
});

test("publisher activation passes only the nonsecret App identity to pinned Node", () => {
  const calls = [];
  activateReleaseTagPublisherBinding(
    { appId: 123456, appSlug: "freed-release-publisher" },
    {
      nodePath: "/pinned/node",
      installerPath: "/repo/scripts/release-tag-publisher-install.mjs",
      exec(file, args, options) {
        calls.push({ file, args, options });
      },
    },
  );
  assert.deepEqual(calls, [
    {
      file: "/pinned/node",
      args: [
        "/repo/scripts/release-tag-publisher-install.mjs",
        "activate",
        "--app-id",
        "123456",
        "--app-slug",
        "freed-release-publisher",
      ],
      options: { stdio: "inherit" },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /BEGIN RSA|client-secret|webhook-secret/,
  );

  const finalizeCalls = [];
  finalizeReleaseTagPublisherBinding({
    nodePath: "/pinned/node",
    installerPath: "/repo/scripts/release-tag-publisher-install.mjs",
    exec(file, args, options) {
      finalizeCalls.push({ file, args, options });
    },
  });
  assert.deepEqual(finalizeCalls, [
    {
      file: "/pinned/node",
      args: [
        "/repo/scripts/release-tag-publisher-install.mjs",
        "finalize",
      ],
      options: { stdio: "inherit" },
    },
  ]);
});

test("completed creation writes and logs only nonsecret App identity", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const statuses = [];
  const opened = [];
  const sequence = [];
  let provisionedPem = "";
  const result = await completeReleaseGitHubAppCreation(conversion(), {
    provisionPrivateKey(value) {
      sequence.push("provision");
      provisionedPem = value;
    },
    writeIdentity(identity) {
      sequence.push("write-identity");
      writeReleaseAppIdentity(identity, { stateRoot: root });
    },
    activatePublisher() {
      sequence.push("activate-binding");
    },
    openUrl(url) {
      sequence.push("open-installation");
      opened.push(url);
    },
    async pollInstallation() {
      sequence.push("verify-installation");
      return { ready: true, installationId: 42 };
    },
    finalizePublisher() {
      sequence.push("finalize-binding");
    },
    onStatus(message) {
      statuses.push(message);
    },
  });
  assert.equal(provisionedPem, pem);
  assert.deepEqual(sequence, [
    "provision",
    "write-identity",
    "activate-binding",
    "open-installation",
    "verify-installation",
    "finalize-binding",
  ]);
  assert.equal(opened.length, 1);
  const installationUrl = new URL(opened[0]);
  assert.equal(installationUrl.origin, "https://github.com");
  assert.equal(
    installationUrl.pathname,
    "/apps/freed-release-publisher/installations/new",
  );
  assert.equal(installationUrl.searchParams.get("target_id"), "257444947");
  assert.deepEqual(result, {
    status: "ready",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    installationId: 42,
  });

  const identityPath = releaseAppIdentityPath(root);
  const persisted = readFileSync(identityPath, "utf8");
  const observable = `${persisted}\n${statuses.join("\n")}\n${JSON.stringify(result)}\n${opened.join("\n")}`;
  for (const secret of [
    pem,
    "client-secret-must-not-survive",
    "webhook-secret-must-not-survive",
  ]) {
    assert.equal(observable.includes(secret), false);
  }
  assert.equal(statSync(identityPath).mode & 0o777, 0o600);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(path.dirname(identityPath)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(persisted), {
    schemaVersion: 1,
    purpose: "freed-release-github-app-identity",
    organization: "freed-project",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    ownerId: 257444947,
  });
});

test("identity persistence rejects a symlinked private directory", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "unexpected-target");
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, path.join(root, "release-tag-publisher"), "dir");
  const { identity } = validateManifestConversion(conversion());
  assert.throws(
    () => writeReleaseAppIdentity(identity, { stateRoot: root }),
    /identity directory is invalid/,
  );
});
