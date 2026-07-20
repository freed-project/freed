import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
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
  prepareReleaseTagPublisher,
  provisionReleaseTagPublisher,
  revokeReleaseTagPublisher,
  rotateReleaseTagPublisher,
} from "./release-tag-publisher-install.mjs";
import {
  releaseTagPublisherNativePairSha256,
  verifyReleaseTagPublisherBindingShape,
} from "./lib/release-tag-publisher-binding.mjs";

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

function createNativeInstallHarness({
  failTarget = null,
  failureCount = Number.POSITIVE_INFINITY,
} = {}) {
  const root = realpathSync(
    mkdtempSync(path.join(fixtureRoot, "native-install-")),
  );
  const hostPath = path.join(root, "installed", "release-tag-publisher");
  const provisionerPath = path.join(
    root,
    "installed",
    "release-tag-publisher-provision",
  );
  const configPath = path.join(root, "installed", "release-tag-publisher.json");
  const installs = [];
  let failuresRemaining = failureCount;
  const dependencies = {
    repoRoot: fixtureRoot,
    tempRoot: root,
    buildScript: path.join(root, "build.sh"),
    hostPath,
    provisionerPath,
    configPath,
    inspectInstalledHost() {},
    run(executable, args) {
      if (executable === "/bin/bash") {
        const hostOutput = args[args.indexOf("--host-output") + 1];
        const provisionerOutput =
          args[args.indexOf("--provisioner-output") + 1];
        writeFileSync(hostOutput, "new-host-generation", { mode: 0o700 });
        writeFileSync(provisionerOutput, "new-provisioner-generation", {
          mode: 0o700,
        });
        return { status: 0, stdout: "", stderr: "" };
      }
      assert.equal(executable, "/usr/bin/sudo");
      assert.equal(args[0], "/usr/bin/install");
      const installArgs = args.slice(1);
      const target = installArgs.at(-1);
      if (installArgs[0] === "-d") {
        mkdirSync(target, { recursive: true, mode: 0o755 });
        installs.push({ target, directory: true });
        return { status: 0, stdout: "", stderr: "" };
      }
      const source = installArgs.at(-2);
      const mode = Number.parseInt(
        installArgs[installArgs.indexOf("-m") + 1],
        8,
      );
      installs.push({ target, source, directory: false });
      if (
        failuresRemaining > 0 &&
        (target === failTarget ||
          (failTarget === "host" && target === hostPath) ||
          (failTarget === "provisioner" && target === provisionerPath))
      ) {
        failuresRemaining -= 1;
        return { status: 1, stdout: "", stderr: "injected install failure" };
      }
      if (existsSync(target)) chmodSync(target, 0o600);
      copyFileSync(source, target);
      chmodSync(target, mode);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  return {
    root,
    hostPath,
    provisionerPath,
    configPath,
    installs,
    dependencies,
  };
}

function seedLegacyActiveNativePair(harness) {
  mkdirSync(path.dirname(harness.hostPath), { recursive: true });
  writeFileSync(harness.hostPath, "old-host-generation", { mode: 0o700 });
  writeFileSync(harness.provisionerPath, "old-unsafe-provisioner", {
    mode: 0o700,
  });
  writeFileSync(
    harness.configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-binding",
        status: "active",
        repo: "freed-project/freed",
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        publisherPath: harness.hostPath,
        publisherSha256: digest("old-host-generation"),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
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
    verifyInstalledNativePair() {},
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

test("native preparation records one recoverable exact pair generation", () => {
  const harness = createNativeInstallHarness();
  const value = prepareReleaseTagPublisher({
    dependencies: harness.dependencies,
  });
  const binding = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(binding.schemaVersion, 2);
  assert.equal(binding.status, "prepared");
  assert.equal(binding.publisherSha256, digest("new-host-generation"));
  assert.equal(binding.provisionerSha256, digest("new-provisioner-generation"));
  assert.equal(
    binding.nativePairSha256,
    releaseTagPublisherNativePairSha256(binding),
  );
  assert.deepEqual(
    harness.installs.map(({ target }) => target),
    [
      path.dirname(harness.hostPath),
      harness.configPath,
      harness.provisionerPath,
      harness.hostPath,
      harness.configPath,
    ],
  );
  assert.equal(value.nativePairSha256, binding.nativePairSha256);
});

test("native preparation changes no executable when the fail-closed barrier cannot land", () => {
  const harness = createNativeInstallHarness();
  seedLegacyActiveNativePair(harness);
  const legacyBinding = readFileSync(harness.configPath, "utf8");
  let failed = false;
  const installRun = harness.dependencies.run;
  harness.dependencies.run = (executable, args, options) => {
    if (
      !failed &&
      executable === "/usr/bin/sudo" &&
      args.at(-1) === harness.configPath
    ) {
      failed = true;
      return { status: 1, stdout: "", stderr: "injected barrier failure" };
    }
    return installRun(executable, args, options);
  };

  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /cutover binding installation failed: injected barrier failure/,
  );
  assert.equal(readFileSync(harness.configPath, "utf8"), legacyBinding);
  assert.equal(readFileSync(harness.hostPath, "utf8"), "old-host-generation");
  assert.equal(
    readFileSync(harness.provisionerPath, "utf8"),
    "old-unsafe-provisioner",
  );
});

test("native preparation leaves the schema 2 barrier when provisioner replacement fails", () => {
  const harness = createNativeInstallHarness({ failTarget: "provisioner" });
  seedLegacyActiveNativePair(harness);

  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /lockdown provisioner installation failed: injected install failure/,
  );
  const barrier = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(barrier.schemaVersion, 2);
  assert.equal(barrier.status, "preparing");
  assert.throws(
    () =>
      verifyReleaseTagPublisherBindingShape(barrier, {
        statuses: ["active"],
      }),
    /binding is missing or malformed/,
  );
  assert.equal(readFileSync(harness.hostPath, "utf8"), "old-host-generation");
  assert.equal(
    readFileSync(harness.provisionerPath, "utf8"),
    "old-unsafe-provisioner",
  );
});

test("native preparation leaves a fail-closed barrier when host replacement fails", () => {
  const harness = createNativeInstallHarness({ failTarget: "host" });
  seedLegacyActiveNativePair(harness);
  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /host installation failed: injected install failure/,
  );
  const barrier = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(barrier.status, "preparing");
  assert.throws(
    () =>
      verifyReleaseTagPublisherBindingShape(barrier, {
        statuses: ["active"],
      }),
    /binding is missing or malformed/,
  );
  assert.equal(readFileSync(harness.hostPath, "utf8"), "old-host-generation");
  assert.equal(
    readFileSync(harness.provisionerPath, "utf8"),
    "new-provisioner-generation",
  );
  assert.equal(barrier.provisionerSha256, digest("new-provisioner-generation"));
});

test("native preparation retry recovers a host replacement interruption", () => {
  const harness = createNativeInstallHarness({
    failTarget: "host",
    failureCount: 1,
  });
  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /host installation failed/,
  );
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "preparing",
  );
  const recovered = prepareReleaseTagPublisher({
    dependencies: harness.dependencies,
  });
  const prepared = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(prepared.status, "prepared");
  assert.equal(recovered.nativePairSha256, prepared.nativePairSha256);
  assert.equal(
    digest(readFileSync(harness.hostPath)),
    prepared.publisherSha256,
  );
  assert.equal(
    digest(readFileSync(harness.provisionerPath)),
    prepared.provisionerSha256,
  );
});

test("native preparation keeps the barrier until the complete pair is durably prepared", () => {
  const harness = createNativeInstallHarness();
  seedLegacyActiveNativePair(harness);
  const installRun = harness.dependencies.run;
  let configInstalls = 0;
  harness.dependencies.run = (executable, args, options) => {
    if (
      executable === "/usr/bin/sudo" &&
      args.at(-1) === harness.configPath &&
      (configInstalls += 1) === 2
    ) {
      return {
        status: 1,
        stdout: "",
        stderr: "injected prepared binding failure",
      };
    }
    return installRun(executable, args, options);
  };

  assert.throws(
    () => prepareReleaseTagPublisher({ dependencies: harness.dependencies }),
    /prepared native pair binding installation failed: injected prepared binding failure/,
  );
  const barrier = JSON.parse(readFileSync(harness.configPath, "utf8"));
  assert.equal(barrier.status, "preparing");
  assert.throws(
    () =>
      verifyReleaseTagPublisherBindingShape(barrier, {
        statuses: ["active"],
      }),
    /binding is missing or malformed/,
  );
  assert.equal(digest(readFileSync(harness.hostPath)), barrier.publisherSha256);
  assert.equal(
    digest(readFileSync(harness.provisionerPath)),
    barrier.provisionerSha256,
  );

  harness.dependencies.run = installRun;
  prepareReleaseTagPublisher({ dependencies: harness.dependencies });
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "prepared",
  );
});

test("activation promotes only the prepared pair and rejects later generation drift", () => {
  const harness = createNativeInstallHarness();
  prepareReleaseTagPublisher({ dependencies: harness.dependencies });
  const installRun = harness.dependencies.run;
  let hostAttestations = 0;
  let attestationOverrides = {};
  Object.assign(harness.dependencies, {
    authorizeRecovery() {},
    readInstalledConfig(filePath) {
      return JSON.parse(readFileSync(filePath, "utf8"));
    },
    run(executable, args, options) {
      if (executable !== harness.hostPath) {
        return installRun(executable, args, options);
      }
      hostAttestations += 1;
      const binding = JSON.parse(readFileSync(harness.configPath, "utf8"));
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          schemaVersion: 2,
          purpose: "freed-release-tag-publisher-readiness",
          repo: binding.repo,
          appId: binding.appId,
          appSlug: binding.appSlug,
          credentialMode: "short-lived-installation-token",
          operations: ["create-annotated-tag"],
          allowsArbitraryRefs: false,
          allowsUpdates: false,
          allowsDeletions: false,
          publisherSha256: binding.publisherSha256,
          provisionerSha256: binding.provisionerSha256,
          nativePairSha256: binding.nativePairSha256,
          ...attestationOverrides,
        }),
      };
    },
  });

  const activated = activateReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    dependencies: harness.dependencies,
  });
  assert.equal(activated.recovered, false);
  assert.equal(
    JSON.parse(readFileSync(harness.configPath, "utf8")).status,
    "active",
  );
  assert.equal(hostAttestations, 1);

  const retried = activateReleaseTagPublisher({
    appId: 4_296_969,
    appSlug: "freed-release-publisher",
    dependencies: harness.dependencies,
  });
  assert.equal(retried.recovered, true);
  assert.equal(hostAttestations, 2);

  attestationOverrides = { provisionerSha256: "0".repeat(64) };
  assert.throws(
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: harness.dependencies,
      }),
    /attestation does not match the pinned short-lived annotated-tag publisher/,
  );
  assert.equal(hostAttestations, 3);
  attestationOverrides = {};

  chmodSync(harness.provisionerPath, 0o700);
  writeFileSync(harness.provisionerPath, "unexpected-provisioner-generation");
  assert.throws(
    () =>
      activateReleaseTagPublisher({
        appId: 4_296_969,
        appSlug: "freed-release-publisher",
        dependencies: harness.dependencies,
      }),
    /native pair is mixed or incomplete/,
  );
  assert.equal(hostAttestations, 3);
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
