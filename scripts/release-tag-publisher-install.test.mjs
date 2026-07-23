import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activateReleaseTagPublisher,
  finalizeReleaseTagPublisher,
  provisionReleaseTagPublisher,
  revokeReleaseTagPublisher,
  rotateReleaseTagPublisher,
  verifyReleaseTagPublisher,
} from "./release-tag-publisher-install.mjs";

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

function publisherBinding() {
  const publisherPath = "/usr/bin/true";
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath,
    publisherSha256: createHash("sha256")
      .update(readFileSync(publisherPath))
      .digest("hex"),
    configPath:
      "/Library/Application Support/Freed/release-tag-publisher.json",
  };
}

function publisherReadiness(binding = publisherBinding()) {
  return {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-readiness",
    repo: binding.repo,
    appId: binding.appId,
    appSlug: binding.appSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    digest: binding.publisherSha256,
  };
}

test("installer verifies the local credential only through the bounded host", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-release-publisher-install-test-"),
  );
  const configPath = path.join(root, "release-tag-publisher.json");
  const binding = { ...publisherBinding(), configPath };
  writeFileSync(configPath, `${JSON.stringify(binding)}\n`);
  const calls = [];
  const loads = [];
  try {
    const result = verifyReleaseTagPublisher({
      dependencies: {
        configPath,
        hostPath: "/usr/bin/true",
        loadBinding(options) {
          loads.push(options);
          return binding;
        },
        run(file, args, options) {
          calls.push({ file, args, options });
          return {
            status: 0,
            stdout:
              args[0] === "verify-installation"
                ? JSON.stringify(installationReadiness())
                : "",
            stderr: "",
          };
        },
      },
    });
    assert.equal(result.readiness.installationId, 42);
    assert.deepEqual(loads, [{ configPath, requiredStatus: "active" }]);
    assert.deepEqual(
      calls.map(({ args, options }) => ({
        action: args[0],
        timeout: options.timeout,
      })),
      [{ action: "verify-installation", timeout: 30_000 }],
    );
    assert.throws(
      () =>
        verifyReleaseTagPublisher({
          dependencies: {
            configPath,
            loadBinding() {
              return binding;
            },
            run() {
              return { status: 0, stdout: '{"status":"ready"}', stderr: "" };
            },
          },
        }),
      /does not match the dedicated selected-repository App contract/,
    );
    assert.throws(
      () =>
        verifyReleaseTagPublisher({
          dependencies: {
            configPath,
            loadBinding() {
              throw new Error(
                "Release tag publisher executable digest does not match its binding.",
              );
            },
            run() {
              assert.fail("Native verification must not run for a bad digest.");
            },
          },
        }),
      /digest does not match its binding/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("activation bounds credential-quiet native attestation", () => {
  const binding = publisherBinding();
  const calls = [];
  const installedStatuses = [];
  const result = activateReleaseTagPublisher({
    appId: 123456,
    appSlug: "freed-release-publisher",
    dependencies: {
      hostPath: "/usr/bin/true",
      configPath: "/Library/Application Support/Freed/release-tag-publisher.json",
      run(file, args, options) {
        calls.push({ file, args, options });
        if (file === "/usr/bin/sudo" && args[0] === "/usr/bin/install") {
          installedStatuses.push(JSON.parse(readFileSync(args.at(-2), "utf8")).status);
        }
        return {
          status: 0,
          stdout:
            args[0] === "attest"
              ? JSON.stringify(publisherReadiness(binding))
              : "",
          stderr: "",
        };
      },
    },
  });
  assert.equal(result.attestation.purpose, "freed-release-tag-publisher-readiness");
  assert.deepEqual(installedStatuses, ["pending"]);
  const attestation = calls.find(({ args }) => args[0] === "attest");
  assert.equal(attestation.options.timeout, 30_000);

  const rejectedStatuses = [];
  assert.throws(
    () =>
      activateReleaseTagPublisher({
        appId: 123456,
        appSlug: "freed-release-publisher",
        dependencies: {
          hostPath: "/usr/bin/true",
          configPath:
            "/Library/Application Support/Freed/release-tag-publisher.json",
          run(file, args) {
            if (file === "/usr/bin/sudo" && args[0] === "/usr/bin/install") {
              rejectedStatuses.push(
                JSON.parse(readFileSync(args.at(-2), "utf8")).status,
              );
            }
            return {
              status: 0,
              stdout: args[0] === "attest" ? '{"status":"ready"}' : "",
              stderr: "",
            };
          },
        },
      }),
    /does not match the pinned annotated-tag publisher/,
  );
  assert.deepEqual(rejectedStatuses, ["pending"]);
});

test("finalization verifies a pending binding before installing active", () => {
  const binding = { ...publisherBinding(), status: "pending" };
  const installedStatuses = [];
  const result = finalizeReleaseTagPublisher({
    dependencies: {
      hostPath: binding.publisherPath,
      configPath: binding.configPath,
      loadBinding(options) {
        assert.deepEqual(options, {
          configPath: binding.configPath,
          requiredStatus: "pending",
        });
        return binding;
      },
      run(file, args) {
        if (file === "/usr/bin/sudo" && args[0] === "/usr/bin/install") {
          installedStatuses.push(
            JSON.parse(readFileSync(args.at(-2), "utf8")).status,
          );
        }
        return {
          status: 0,
          stdout:
            args[0] === "verify-installation"
              ? JSON.stringify(installationReadiness())
              : "",
          stderr: "",
        };
      },
    },
  });
  assert.equal(result.readiness.installationId, 42);
  assert.equal(result.binding.status, "active");
  assert.deepEqual(installedStatuses, ["active"]);

  const rejectedStatuses = [];
  assert.throws(
    () =>
      finalizeReleaseTagPublisher({
        dependencies: {
          hostPath: binding.publisherPath,
          configPath: binding.configPath,
          loadBinding() {
            return binding;
          },
          run(file, args) {
            if (file === "/usr/bin/sudo") {
              rejectedStatuses.push(
                JSON.parse(readFileSync(args.at(-2), "utf8")).status,
              );
            }
            return {
              status: 0,
              stdout:
                args[0] === "verify-installation"
                  ? '{"status":"ready"}'
                  : "",
              stderr: "",
            };
          },
        },
      }),
    /does not match the dedicated selected-repository App contract/,
  );
  assert.deepEqual(rejectedStatuses, []);
});

test("provisioning binds the fixed local key without invoking Keychain", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-release-publisher-local-key-"),
  );
  const canonicalRoot = realpathSync(root);
  const keyPath = path.join(canonicalRoot, "release-key.pem");
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2_048 })
    .privateKey.export({ format: "pem", type: "pkcs1" })
    .toString();
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  const binding = {
    ...publisherBinding(),
    configPath: path.join(canonicalRoot, "release-tag-publisher.json"),
  };
  const calls = [];
  const installedStatuses = [];
  try {
    const result = provisionReleaseTagPublisher({
      appId: 123456,
      appSlug: "freed-release-publisher",
      privateKeyFile: keyPath,
      dependencies: {
        repoRoot: canonicalRoot,
        tempRoot: canonicalRoot,
        buildScript: "/usr/bin/true",
        hostPath: "/usr/bin/true",
        configPath: binding.configPath,
        privateKeyPath: keyPath,
        loadBinding(options) {
          return { ...binding, status: options.requiredStatus };
        },
        run(file, args, options) {
          calls.push({ file, args, options });
          if (file === "/usr/bin/sudo" && args[0] === "/usr/bin/install") {
            const source = args.at(-2);
            if (source.endsWith("release-tag-publisher.json")) {
              installedStatuses.push(
                JSON.parse(readFileSync(source, "utf8")).status,
              );
            }
          }
          return {
            status: 0,
            stdout:
              args[0] === "attest"
                ? JSON.stringify(publisherReadiness(binding))
                : args[0] === "verify-installation"
                  ? JSON.stringify(installationReadiness())
                : "",
            stderr: "",
          };
        },
      },
    });
    assert.equal(result.privateKeyPath, keyPath);
    assert.equal(result.finalized.readiness.installationId, 42);
    assert.deepEqual(installedStatuses, ["pending", "active"]);
    assert.equal(calls.some(({ args }) => args[0] === "verify-installation"), true);
    assert.equal(
      calls.some(({ args }) => ["provision", "rotate", "revoke"].includes(args[0])),
      false,
    );
    const build = calls.find(({ args }) => args.includes("--host-output"));
    assert.ok(build);
    assert.equal(build.args.includes("--provisioner-output"), false);
    assert.ok(
      calls.some(
        ({ file, args }) =>
          file === "/usr/bin/sudo" &&
          args[0] === "/bin/rm" &&
          args.at(-1).endsWith("release-tag-publisher-provision"),
      ),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("unsafe local credential rotation and revocation remain disabled", () => {
  assert.throws(
    () => rotateReleaseTagPublisher(),
    /rotation is disabled/,
  );
  assert.throws(
    () => revokeReleaseTagPublisher(),
    /revocation is disabled/,
  );
});
