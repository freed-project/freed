import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activateReleaseTagPublisherBinding,
  buildManifestBootstrapHtml,
  buildReleaseGitHubAppManifest,
  completeReleaseGitHubAppCreation,
  exchangeManifestCode,
  parseManifestCallback,
  provisionReleaseAppPrivateKey,
  releaseAppIdentityPath,
  validateManifestConversion,
  writeReleaseAppIdentity,
} from "./create-release-github-app.mjs";

const pem = `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(512)}\n-----END RSA PRIVATE KEY-----\n`;

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

test("release App manifest is private, event-free, and Contents-only", () => {
  const manifest = buildReleaseGitHubAppManifest({
    origin: "http://127.0.0.1:43123",
  });
  assert.deepEqual(manifest, {
    name: "Freed Release Publisher",
    url: "https://freed.wtf",
    description:
      "Creates one reviewed immutable release tag for freed-project/freed.",
    hook_attributes: {
      url: "http://127.0.0.1:43123/github-app/inactive-webhook",
      active: false,
    },
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
  assert.doesNotMatch(html, /client_secret|webhook_secret|BEGIN RSA/);
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

test("private key is piped to the fixed provisioner and never placed in arguments", () => {
  const calls = [];
  provisionReleaseAppPrivateKey(pem, {
    spawn(file, args, options) {
      calls.push({ file, args, options });
      return { status: 0 };
    },
  });
  assert.deepEqual(calls[0].args, [
    "provision",
    "--host",
    "/Library/Application Support/Freed/release-tag-publisher",
  ]);
  assert.equal(calls[0].options.input, pem);
  assert.doesNotMatch(JSON.stringify(calls[0].args), /BEGIN RSA/);
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
