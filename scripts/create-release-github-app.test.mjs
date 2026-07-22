import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  activateReleaseTagPublisherBinding,
  buildManifestBootstrapHtml,
  buildReleaseGitHubAppManifest,
  completeReleaseGitHubAppCreation,
  createReleaseGitHubApp,
  exchangeManifestCode,
  parseManifestCallback,
  provisionReleaseAppPrivateKey,
  RELEASE_GITHUB_APP_OPERATION_ID_ENV,
  releaseAppIdentityPath,
  validateManifestConversion,
  verifyInstalledReleaseApp,
  writeReleaseAppIdentity,
} from "./create-release-github-app.mjs";

const pem = `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(512)}\n-----END RSA PRIVATE KEY-----\n`;
const operationId = "a".repeat(64);
const otherOperationId = "b".repeat(64);

function conversion() {
  return {
    id: 4_296_969,
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
    appId: 4_296_969,
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

function crashIdentityWrite(root, identity, checkpointName, opId = operationId) {
  const moduleUrl = new URL("./create-release-github-app.mjs", import.meta.url)
    .href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { writeReleaseAppIdentity } from ${JSON.stringify(moduleUrl)};
        writeReleaseAppIdentity(${JSON.stringify(identity)}, {
          stateRoot: ${JSON.stringify(root)},
          operationId: ${JSON.stringify(opId)},
          checkpoint(name) {
            if (name === ${JSON.stringify(checkpointName)}) process.kill(process.pid, "SIGKILL");
          },
        });
      `,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
}

function onlyPendingPath(root) {
  const directory = path.dirname(releaseAppIdentityPath(root));
  const pending = readdirSync(directory).filter((name) =>
    name.endsWith(".pending"),
  );
  assert.equal(pending.length, 1);
  return path.join(directory, pending[0]);
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
  assert.equal(result.id, 4_296_969);
  assert.deepEqual(calls[0].options.method, "POST");
  assert.equal("body" in calls[0].options, false);
  assert.equal("Authorization" in calls[0].options.headers, false);
});

test("manifest conversion accepts only the dedicated release App identity", () => {
  for (const invalid of [
    { ...conversion(), id: 4_296_970 },
    { ...conversion(), id: "4296969" },
    { ...conversion(), slug: "Freed-Release-Publisher" },
    {
      ...conversion(),
      owner: { ...conversion().owner, id: "257444947" },
    },
  ]) {
    assert.throws(
      () => validateManifestConversion(invalid),
      /did not return the expected private organization App identity/,
    );
  }
});

test("App creation retains one caller operation ID through manifest completion", async () => {
  const gates = [];
  const opened = [];
  const phases = [];
  let closed = false;
  const result = await createReleaseGitHubApp({
    operationId,
    requirePromotionReadiness(input) {
      gates.push(input);
    },
    verifyPreparedHost() {},
    createListener({ state }) {
      assert.match(state, /^[0-9a-f]{64}$/);
      return {
        listening: Promise.resolve(),
        callback: Promise.resolve({ code: "c".repeat(40) }),
        origin: "http://127.0.0.1:43123",
        close() {
          closed = true;
        },
      };
    },
    openUrl(url) {
      opened.push(url);
    },
    async exchangeCode(code) {
      assert.equal(code, "c".repeat(40));
      return conversion();
    },
    async completeCreation(value, options) {
      assert.deepEqual(value, conversion());
      assert.equal(options.operationId, operationId);
      return completeReleaseGitHubAppCreation(value, {
        ...options,
        writeIdentity(_identity, writeOptions) {
          phases.push(["identity", writeOptions.operationId]);
        },
        provisionPrivateKey(value, provisionOptions) {
          phases.push(["credential", provisionOptions.operationId]);
          provisionReleaseAppPrivateKey(value, {
            ...provisionOptions,
            spawn: () => ({ status: 0 }),
          });
        },
        activatePublisher(identity, activationOptions) {
          phases.push(["activation", activationOptions.operationId]);
          activateReleaseTagPublisherBinding(identity, {
            ...activationOptions,
            nodePath: "/pinned/node",
            installerPath: "/pinned/installer",
            exec() {},
          });
        },
        openUrl(url) {
          opened.push(url);
        },
        async pollInstallation() {
          return { ready: true, installationId: 42 };
        },
      });
    },
  });
  assert.deepEqual(result, {
    status: "ready",
    repo: "freed-project/freed",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    installationId: 42,
  });
  assert.equal(opened.length, 2);
  assert.equal(closed, true);
  assert.deepEqual(phases, [
    ["identity", operationId],
    ["credential", operationId],
    ["activation", operationId],
  ]);
  assert.deepEqual(gates, [
    {
      action: "release-tag-publisher.create-existing-app",
      operationId,
    },
    {
      action: "release-tag-publisher.create-existing-app",
      operationId,
    },
    {
      action: "release-tag-publisher.create-existing-app",
      operationId,
    },
    {
      action: "release-tag-publisher.create-existing-app",
      operationId,
    },
  ]);
});

test("App creation rejects an absent caller operation ID before side effects", async () => {
  let touched = false;
  await assert.rejects(
    createReleaseGitHubApp({
      verifyPreparedHost() {
        touched = true;
      },
    }),
    /requires one canonical operation ID/,
  );
  assert.equal(touched, false);
});

test("CLI usage names the caller-retained operation ID environment variable", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./create-release-github-app.mjs", import.meta.url)),
      "--help",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(RELEASE_GITHUB_APP_OPERATION_ID_ENV));
  assert.match(result.stdout, /caller-retained/);
});

test("installed release App verification has a hard deadline", () => {
  const calls = [];
  const result = verifyInstalledReleaseApp(
    {
      repo: "freed-project/freed",
      appId: 4_296_969,
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
});

test("App creation fails before local or GitHub side effects while promotion is unavailable", async () => {
  const calls = [];
  await assert.rejects(
    createReleaseGitHubApp({
      operationId,
      verifyPreparedHost() {
        calls.push("verify-host");
      },
      openUrl() {
        calls.push("open-url");
      },
      exchangeCode() {
        calls.push("exchange-code");
      },
      completeCreation() {
        calls.push("complete-creation");
      },
    }),
    /creation and credential promotion are unavailable/,
  );
  assert.deepEqual(calls, []);
});

test("direct private key provisioning fails before spawning while promotion is unavailable", () => {
  let spawned = false;
  assert.throws(
    () =>
      provisionReleaseAppPrivateKey(pem, {
        operationId,
        spawn() {
          spawned = true;
          return { status: 0 };
        },
      }),
    /creation and credential promotion are unavailable/,
  );
  assert.equal(spawned, false);
});

test("private key is piped to the fixed provisioner and never placed in arguments", () => {
  const calls = [];
  const gates = [];
  provisionReleaseAppPrivateKey(pem, {
    operationId,
    requirePromotionReadiness(input) {
      gates.push(input);
    },
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
  assert.deepEqual(gates, [
    {
      action: "release-tag-publisher.create-existing-app",
      operationId,
    },
  ]);
});

test("publisher activation passes only the nonsecret App identity to pinned Node", () => {
  const calls = [];
  activateReleaseTagPublisherBinding(
    { appId: 4_296_969, appSlug: "freed-release-publisher" },
    {
      operationId,
      requirePromotionReadiness(input) {
        calls.push({ gate: input });
      },
      nodePath: "/pinned/node",
      installerPath: "/repo/scripts/release-tag-publisher-install.mjs",
      exec(file, args, options) {
        calls.push({ file, args, options });
      },
    },
  );
  assert.deepEqual(calls, [
    {
      gate: {
        action: "release-tag-publisher.create-existing-app",
        operationId,
      },
    },
    {
      file: "/pinned/node",
      args: [
        "/repo/scripts/release-tag-publisher-install.mjs",
        "activate",
        "--app-id",
        "4296969",
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
  const operationIds = [];
  let provisionedPem = "";
  const result = await completeReleaseGitHubAppCreation(conversion(), {
    operationId,
    requirePromotionReadiness() {},
    provisionPrivateKey(value, options) {
      sequence.push("provision");
      provisionedPem = value;
      operationIds.push(options.operationId);
    },
    writeIdentity(identity, options) {
      sequence.push("write-identity");
      writeReleaseAppIdentity(identity, { stateRoot: root, ...options });
    },
    activatePublisher(_identity, options) {
      sequence.push("activate-binding");
      operationIds.push(options.operationId);
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
  assert.deepEqual(operationIds, [operationId, operationId]);
  assert.deepEqual(sequence, [
    "write-identity",
    "provision",
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
    appId: 4_296_969,
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
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    ownerId: 257444947,
  });
});

test("initial App setup records identity before any private key mutation", async () => {
  let provisioned = false;
  await assert.rejects(
    completeReleaseGitHubAppCreation(conversion(), {
      operationId,
      requirePromotionReadiness() {},
      writeIdentity() {
        throw new Error("injected identity persistence failure");
      },
      provisionPrivateKey() {
        provisioned = true;
      },
    }),
    /injected identity persistence failure/,
  );
  assert.equal(provisioned, false);
});

test("initial App setup never replaces an existing App identity", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { identity } = validateManifestConversion(conversion());
  const identityPath = writeReleaseAppIdentity(identity, {
    stateRoot: root,
    operationId,
  });
  const original = readFileSync(identityPath, "utf8");

  assert.equal(
    writeReleaseAppIdentity(identity, { stateRoot: root, operationId }),
    identityPath,
  );
  assert.equal(readFileSync(identityPath, "utf8"), original);

  assert.throws(
    () =>
      writeReleaseAppIdentity(
        { ...identity, ownerId: identity.ownerId + 1 },
        { stateRoot: root, operationId },
      ),
    /EEXIST|file exists/i,
  );
  assert.equal(readFileSync(identityPath, "utf8"), original);
});

test("identity persistence recovers an exact hard-link commit after process death", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-crash-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { identity } = validateManifestConversion(conversion());
  const moduleUrl = new URL("./create-release-github-app.mjs", import.meta.url)
    .href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { writeReleaseAppIdentity } from ${JSON.stringify(moduleUrl)};
        writeReleaseAppIdentity(${JSON.stringify(identity)}, {
          stateRoot: ${JSON.stringify(root)},
          operationId: ${JSON.stringify(operationId)},
          checkpoint(name) {
            if (name === "identity-linked-fsynced") process.kill(process.pid, "SIGKILL");
          },
        });
      `,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, null);
  assert.equal(child.signal, "SIGKILL");

  const identityPath = releaseAppIdentityPath(root);
  const pendingPath = path.join(
    path.dirname(identityPath),
    readdirSync(path.dirname(identityPath)).find((name) =>
      name.endsWith(".pending"),
    ),
  );
  const committedBeforeRecovery = statSync(identityPath);
  const pendingBeforeRecovery = statSync(pendingPath);
  assert.equal(committedBeforeRecovery.ino, pendingBeforeRecovery.ino);
  assert.equal(committedBeforeRecovery.nlink, 2);

  assert.equal(
    writeReleaseAppIdentity(identity, { stateRoot: root, operationId }),
    identityPath,
  );
  assert.equal(existsSync(pendingPath), false);
  assert.equal(statSync(identityPath).nlink, 1);
  assert.deepEqual(JSON.parse(readFileSync(identityPath, "utf8")), identity);
});

test("identity persistence recovers every request-bound write checkpoint", (t) => {
  const { identity } = validateManifestConversion(conversion());
  const expected = Buffer.from(`${JSON.stringify(identity, null, 2)}\n`);
  for (const [label, checkpointName] of [
    ["zero", "identity-before-write"],
    ["half", "identity-partial-fsynced"],
    ["full-before-fsync", "identity-full-written"],
    ["full-after-fsync", "identity-full-fsynced"],
  ]) {
    const root = mkdtempSync(
      path.join(os.tmpdir(), `freed-release-app-${label}-`),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const child = crashIdentityWrite(root, identity, checkpointName);
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, null);
    assert.equal(child.signal, "SIGKILL");
    const pendingPath = onlyPendingPath(root);
    const pendingSize = statSync(pendingPath).size;
    if (label === "zero") assert.equal(pendingSize, 0);
    if (label === "half") {
      assert.ok(pendingSize > 0 && pendingSize < expected.length);
    }
    if (label.startsWith("full")) assert.equal(pendingSize, expected.length);
    const identityPath = writeReleaseAppIdentity(identity, {
      stateRoot: root,
      operationId,
    });
    assert.deepEqual(readFileSync(identityPath), expected);
    assert.equal(existsSync(pendingPath), false);
  }

  const missingNewlineRoot = mkdtempSync(
    path.join(os.tmpdir(), "freed-release-app-missing-newline-"),
  );
  t.after(() =>
    rmSync(missingNewlineRoot, { recursive: true, force: true }),
  );
  const missingNewlineChild = crashIdentityWrite(
    missingNewlineRoot,
    identity,
    "identity-before-write",
  );
  assert.equal(missingNewlineChild.signal, "SIGKILL");
  const missingNewlinePending = onlyPendingPath(missingNewlineRoot);
  writeFileSync(missingNewlinePending, expected.subarray(0, -1), {
    mode: 0o600,
  });
  const recovered = writeReleaseAppIdentity(identity, {
    stateRoot: missingNewlineRoot,
    operationId,
  });
  assert.deepEqual(readFileSync(recovered), expected);
  expected.fill(0);
});

test("identity persistence requires the same operation and preserves foreign partials", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-op-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { identity } = validateManifestConversion(conversion());
  assert.throws(
    () => writeReleaseAppIdentity(identity, { stateRoot: root }),
    /canonical operation ID/,
  );
  const child = crashIdentityWrite(
    root,
    identity,
    "identity-partial-fsynced",
  );
  assert.equal(child.signal, "SIGKILL");
  const foreignPending = onlyPendingPath(root);
  const before = readFileSync(foreignPending);
  const metadataBefore = statSync(foreignPending);
  assert.throws(
    () =>
      writeReleaseAppIdentity(identity, {
        stateRoot: root,
        operationId: otherOperationId,
      }),
    /different release GitHub App identity operation/,
  );
  assert.deepEqual(readFileSync(foreignPending), before);
  assert.equal(statSync(foreignPending).ino, metadataBefore.ino);
  before.fill(0);
});

test("identity persistence rejects a symlinked private directory", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "unexpected-target");
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, path.join(root, "release-tag-publisher"), "dir");
  const { identity } = validateManifestConversion(conversion());
  assert.throws(
    () =>
      writeReleaseAppIdentity(identity, { stateRoot: root, operationId }),
    /identity directory is invalid/,
  );
});
