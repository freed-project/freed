import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  activateReleaseTagPublisher,
  discardReleaseTagPublisherRecovery,
  provisionReleaseTagPublisher,
  revokeReleaseTagPublisher,
  rotateReleaseTagPublisher,
} from "./release-tag-publisher-install.mjs";

let fixtureRoot;
let privateKey;
let privateKeyPath;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function result(action, extra = {}) {
  return `${JSON.stringify({
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-keychain-result",
    action,
    ...extra,
  })}\n`;
}

function createHarness({
  presence = "missing",
  activationError = null,
  initialDigest = null,
} = {}) {
  const calls = [];
  let storedDigest =
    presence === "present" ? (initialDigest ?? digest(privateKey)) : null;
  let prepared = 0;
  let activated = 0;
  const dependencies = {
    hostPath: "/Library/Application Support/Freed/release-tag-publisher",
    provisionerPath:
      "/Library/Application Support/Freed/release-tag-publisher-provision",
    inspectInstalledHost() {},
    authorizeRecovery(request) {
      calls.push({ authorization: request });
    },
    keychainPresence: () => (storedDigest === null ? "missing" : "present"),
    prepareReleaseTagPublisher() {
      prepared += 1;
      return { action: "prepare" };
    },
    activateReleaseTagPublisher() {
      activated += 1;
      if (activationError) throw activationError;
      return { action: "activate" };
    },
    run(executable, args, options) {
      const action = args[0];
      calls.push({ executable, args: [...args], stdio: options.stdio });
      const digestIndex = args.indexOf("--expected-sha256");
      const expected = digestIndex === -1 ? null : args[digestIndex + 1];
      if (action === "recover" || action === "rotate") {
        const supplied = readFileSync(options.stdio[0]);
        const suppliedDigest = digest(supplied);
        supplied.fill(0);
        if (suppliedDigest !== expected) {
          return {
            status: 1,
            stdout: "",
            stderr: "the admitted file digest does not match",
          };
        }
        if (action === "recover" && storedDigest !== null) {
          return { status: 1, stdout: "", stderr: "already exists" };
        }
        storedDigest = suppliedDigest;
        return {
          status: 0,
          stdout: result(action, { changed: true }),
          stderr: "",
        };
      }
      if (action === "matches") {
        if (storedDigest !== expected) {
          return { status: 1, stdout: "", stderr: "digest mismatch" };
        }
        return {
          status: 0,
          stdout: result(action, { matched: true }),
          stderr: "",
        };
      }
      if (action === "discard-recovery") {
        if (storedDigest === null) {
          return {
            status: 0,
            stdout: result(action, { changed: false }),
            stderr: "",
          };
        }
        if (storedDigest !== expected) {
          return { status: 1, stdout: "", stderr: "digest mismatch" };
        }
        storedDigest = null;
        return {
          status: 0,
          stdout: result(action, { changed: true }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${action}` };
    },
  };
  return {
    calls,
    dependencies,
    get activated() {
      return activated;
    },
    get prepared() {
      return prepared;
    },
    get storedDigest() {
      return storedDigest;
    },
    clearActivationError() {
      activationError = null;
    },
  };
}

before(() => {
  fixtureRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-release-publisher-install-")),
  );
  chmodSync(fixtureRoot, 0o700);
  ({ privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }));
  privateKeyPath = path.join(fixtureRoot, "release-app.pem");
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
});

after(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

test("recovery admits one stable descriptor and activates after exact matching", () => {
  const harness = createHarness();
  const value = provisionReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeyFile: privateKeyPath,
    dependencies: harness.dependencies,
  });
  assert.equal(value.credentialAction, "recovered");
  assert.equal(harness.prepared, 1);
  assert.equal(harness.activated, 1);
  assert.equal(harness.storedDigest, digest(privateKey));
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["recover", "matches"],
  );
  assert.deepEqual(harness.calls[0].authorization, {
    action: "release-tag-publisher.recover-existing-app",
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeySha256: digest(privateKey),
  });
  const recover = harness.calls.find((call) => call.args?.[0] === "recover");
  assert.equal(typeof recover.stdio[0], "number");
  assert.equal(
    recover.args[recover.args.indexOf("--expected-sha256") + 1],
    digest(privateKey),
  );
  assert.equal(
    harness.calls.some((call) => call.args?.includes(privateKey)),
    false,
  );
  assert.equal(
    harness.calls.some((call) => call.args?.[0] === "revoke"),
    false,
  );
});

test("recovery stays closed until exact owner confirmation is integrated", () => {
  let touched = false;
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: {
          keychainPresence() {
            touched = true;
            return "missing";
          },
          prepareReleaseTagPublisher() {
            touched = true;
          },
          run() {
            touched = true;
            return { status: 1 };
          },
        },
      }),
    /credential mutation is unavailable until one-use kernel-attested owner authorization/,
  );
  assert.equal(touched, false);

  assert.throws(
    () =>
      discardReleaseTagPublisherRecovery({
        expectedSha256: digest(privateKey),
        dependencies: {
          run() {
            touched = true;
            return { status: 1 };
          },
        },
      }),
    /credential mutation is unavailable until one-use kernel-attested owner authorization/,
  );
  assert.equal(touched, false);

  for (const operation of [
    () =>
      rotateReleaseTagPublisher({
        privateKeyFile: privateKeyPath,
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
    () =>
      revokeReleaseTagPublisher({
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: {
          run() {
            touched = true;
          },
        },
      }),
  ]) {
    assert.throws(
      operation,
      /credential mutation is unavailable until one-use kernel-attested owner authorization/,
    );
  }
  assert.equal(touched, false);
});

test("activation failure retains the recovered key and the next run resumes", () => {
  const harness = createHarness({
    activationError: new Error("injected activation failure"),
  });
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /injected activation failure/,
  );
  assert.equal(harness.storedDigest, digest(privateKey));
  assert.equal(
    harness.calls.some((call) => call.args?.[0] === "revoke"),
    false,
  );

  harness.clearActivationError();
  const resumed = provisionReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    privateKeyFile: privateKeyPath,
    dependencies: harness.dependencies,
  });
  assert.equal(resumed.credentialAction, "resumed");
  assert.equal(harness.prepared, 1);
  assert.equal(harness.activated, 2);
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["recover", "matches", "matches"],
  );
});

test("resume rejects a present credential with a different fingerprint", () => {
  const otherDigest = "f".repeat(64);
  const harness = createHarness({
    presence: "present",
    initialDigest: otherDigest,
  });
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: privateKeyPath,
        dependencies: harness.dependencies,
      }),
    /failed: digest mismatch/,
  );
  assert.equal(harness.storedDigest, otherDigest);
  assert.equal(harness.prepared, 0);
  assert.equal(harness.activated, 0);
  assert.deepEqual(
    harness.calls.filter((call) => call.args).map((call) => call.args[0]),
    ["matches"],
  );
  assert.equal(
    harness.calls.some((call) =>
      ["revoke", "discard-recovery"].includes(call.args?.[0]),
    ),
    false,
  );
});

test("recovery refuses unsafe file shapes before invoking the provisioner", () => {
  const cases = [];
  const permissive = path.join(fixtureRoot, "permissive.pem");
  writeFileSync(permissive, privateKey, { mode: 0o644 });
  cases.push(permissive);
  const linked = path.join(fixtureRoot, "linked.pem");
  linkSync(privateKeyPath, linked);
  cases.push(privateKeyPath);
  const symbolic = path.join(fixtureRoot, "symbolic.pem");
  symlinkSync(permissive, symbolic);
  cases.push(symbolic);

  for (const candidate of cases) {
    const harness = createHarness();
    assert.throws(
      () =>
        provisionReleaseTagPublisher({
          appId: 4_296_969,
          appSlug: "freed-release-publisher",
          privateKeyFile: candidate,
          dependencies: harness.dependencies,
        }),
      /private key/i,
    );
    assert.equal(harness.calls.filter((call) => call.args).length, 0);
  }
  rmSync(linked);
});

test("recovery rejects a swapped path before any provisioner call", () => {
  const candidate = path.join(fixtureRoot, "swap-source.pem");
  const displaced = path.join(fixtureRoot, "swap-displaced.pem");
  writeFileSync(candidate, privateKey, { mode: 0o600 });
  const harness = createHarness();
  harness.dependencies.keychainPresence = () => {
    renameSync(candidate, displaced);
    writeFileSync(candidate, privateKey, { mode: 0o600 });
    return "missing";
  };
  assert.throws(
    () =>
      provisionReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        privateKeyFile: candidate,
        dependencies: harness.dependencies,
      }),
    /path changed/,
  );
  assert.equal(harness.calls.filter((call) => call.args).length, 0);
  assert.equal(harness.storedDigest, null);
  assert.equal(harness.prepared, 0);
});

test("recovery rejects a FIFO without blocking or invoking the provisioner", () => {
  const fifo = path.join(fixtureRoot, "private-key.fifo");
  execFileSync("/usr/bin/mkfifo", [fifo]);
  chmodSync(fifo, 0o600);
  const installerUrl = new URL(
    "./release-tag-publisher-install.mjs",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
          import { provisionReleaseTagPublisher } from ${JSON.stringify(installerUrl)};
          try {
            provisionReleaseTagPublisher({
              appId: 4296969,
              appSlug: "freed-release-publisher",
              privateKeyFile: ${JSON.stringify(fifo)},
              dependencies: {
                keychainPresence: () => "missing",
                prepareReleaseTagPublisher: () => { throw new Error("unexpected prepare"); },
                run: () => { throw new Error("unexpected provisioner"); },
              },
            });
            process.exitCode = 2;
          } catch (error) {
            process.stderr.write(String(error?.message ?? error));
          }
        `,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(child.error?.code, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /private key file/i);
  const source = readFileSync(
    new URL("./release-tag-publisher-install.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /constants\.O_NONBLOCK/);
});
