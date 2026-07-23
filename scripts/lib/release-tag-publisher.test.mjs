import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadAndVerifyReleaseTagPublisher,
  publishReleaseTag,
  verifyReleaseTagPublisherInstallation,
  verifyReleaseTagPublisherInstallationReadiness,
  verifyReleaseTagPublisherReadiness,
} from "./release-tag-publisher.mjs";

function fixture() {
  const digest = "a".repeat(64);
  const config = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-binding",
    status: "active",
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath: "/Library/Application Support/Freed/release-tag-publisher",
    publisherSha256: digest,
  };
  const attestation = {
    schemaVersion: 1,
    purpose: "freed-release-tag-publisher-readiness",
    repo: config.repo,
    appId: config.appId,
    appSlug: config.appSlug,
    credentialMode: "short-lived-installation-token",
    operations: ["create-annotated-tag"],
    allowsArbitraryRefs: false,
    allowsUpdates: false,
    allowsDeletions: false,
    digest,
  };
  return { config, attestation, digest };
}

function installationAttestation() {
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

test("installation readiness accepts only the exact dedicated App scope", () => {
  const attestation = installationAttestation();
  const expected = {
    repo: "freed-project/freed",
    releaseAppId: 123456,
    releaseAppSlug: "freed-release-publisher",
  };
  assert.deepEqual(
    verifyReleaseTagPublisherInstallationReadiness(attestation, expected),
    { ready: true, installationId: 42, attestation },
  );
  for (const invalid of [
    { ...attestation, repositories: ["freed-project/other"] },
    {
      ...attestation,
      permissions: { contents: "write", metadata: "read", actions: "read" },
    },
    { ...attestation, repositorySelection: "all" },
    { ...attestation, appEvents: ["push"] },
    {
      ...attestation,
      appPermissions: { contents: "write", metadata: "read", actions: "read" },
    },
    { ...attestation, pem: "secret" },
  ]) {
    assert.throws(
      () => verifyReleaseTagPublisherInstallationReadiness(invalid, expected),
      /does not match the dedicated selected-repository App contract/,
    );
  }
});

test("publisher readiness accepts only the exact pinned native contract", () => {
  const { attestation, config, digest } = fixture();
  const expected = {
    repo: config.repo,
    releaseAppId: config.appId,
    releaseAppSlug: config.appSlug,
    publisherDigest: digest,
  };
  assert.deepEqual(
    verifyReleaseTagPublisherReadiness(attestation, expected),
    { ready: true, publisherDigest: digest, attestation },
  );
  for (const invalid of [
    { status: "ready" },
    { ...attestation, digest: "b".repeat(64) },
    { ...attestation, operations: ["create-annotated-tag", "delete-tag"] },
    { ...attestation, credentialMode: "keychain" },
    { ...attestation, unsupportedField: true },
  ]) {
    assert.throws(
      () => verifyReleaseTagPublisherReadiness(invalid, expected),
      /does not match the pinned annotated-tag publisher/,
    );
  }
});

test("native installation verification uses only the pinned App identity", () => {
  const binding = {
    repo: "freed-project/freed",
    appId: 123456,
    appSlug: "freed-release-publisher",
    publisherPath: "/trusted/release-tag-publisher",
  };
  const calls = [];
  const result = verifyReleaseTagPublisherInstallation(binding, {
    exec(file, args, options) {
      calls.push({ file, args, options });
      return JSON.stringify(installationAttestation());
    },
  });
  assert.equal(result.installationId, 42);
  assert.deepEqual(calls[0].args, [
    "verify-installation",
    "--repo",
    "freed-project/freed",
    "--app-id",
    "123456",
    "--app-slug",
    "freed-release-publisher",
  ]);
  assert.equal(calls[0].options.encoding, "utf8");
  assert.equal(calls[0].options.timeout, 30_000);
  assert.equal(calls[0].options.env.PATH, "/usr/bin:/bin");
});

test("static binding verification never invokes the native credential path", () => {
  const publisher = Buffer.from("fixed publisher bytes");
  const publisherSha256 = createHash("sha256").update(publisher).digest("hex");
  const configPath = "/fixed/release-tag-publisher.json";
  const publisherPath = "/fixed/release-tag-publisher";
  const config = {
    ...fixture().config,
    publisherPath,
    publisherSha256,
  };
  const verified = [];
  const reads = [];
  const result = loadAndVerifyReleaseTagPublisher({
    configPath,
    verifyFile(filePath, options) {
      verified.push({ filePath, options });
    },
    readFile(filePath, maximumBytes) {
      reads.push({ filePath, maximumBytes });
      if (filePath === configPath) {
        return Buffer.from(JSON.stringify(config));
      }
      if (filePath === publisherPath) {
        return publisher;
      }
      throw new Error(`Unexpected read: ${filePath}`);
    },
  });
  assert.deepEqual(result, { ...config, configPath });
  assert.deepEqual(verified, [
    { filePath: configPath, options: undefined },
    { filePath: publisherPath, options: { executable: true } },
  ]);
  assert.deepEqual(reads, [
    { filePath: configPath, maximumBytes: 32 * 1_024 },
    { filePath: publisherPath, maximumBytes: 64 * 1_024 * 1_024 },
  ]);

  assert.throws(
    () =>
      loadAndVerifyReleaseTagPublisher({
        configPath,
        verifyFile() {},
        readFile(filePath) {
          return filePath === configPath
            ? Buffer.from(
                JSON.stringify({ ...config, unsupportedField: true }),
              )
            : publisher;
        },
      }),
    /binding is missing or malformed/,
  );

  assert.throws(
    () =>
      loadAndVerifyReleaseTagPublisher({
        configPath,
        verifyFile() {},
        readFile(filePath) {
          return filePath === configPath
            ? Buffer.from(
                JSON.stringify({
                  ...config,
                  publisherSha256: "b".repeat(64),
                }),
              )
            : publisher;
        },
      }),
    /executable digest does not match its binding/,
  );

  const pending = { ...config, status: "pending" };
  const readPending = (filePath) =>
    filePath === configPath ? Buffer.from(JSON.stringify(pending)) : publisher;
  assert.throws(
    () =>
      loadAndVerifyReleaseTagPublisher({
        configPath,
        verifyFile() {},
        readFile: readPending,
      }),
    /binding is missing or malformed/,
  );
  assert.equal(
    loadAndVerifyReleaseTagPublisher({
      configPath,
      requiredStatus: "pending",
      verifyFile() {},
      readFile: readPending,
    }).status,
    "pending",
  );
});

test("static binding verification applies the native file size limits", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-publisher-bounds-"));
  const configPath = path.join(root, "publisher.json");
  const publisherPath = path.join(root, "publisher");
  try {
    writeFileSync(configPath, Buffer.alloc(32 * 1_024 + 1, 0x20));
    assert.throws(
      () =>
        loadAndVerifyReleaseTagPublisher({ configPath, verifyFile() {} }),
      /empty or exceeds its size limit/,
    );

    writeFileSync(
      configPath,
      JSON.stringify({
        ...fixture().config,
        publisherPath,
      }),
    );
    writeFileSync(publisherPath, "x");
    truncateSync(publisherPath, 64 * 1_024 * 1_024 + 1);
    assert.throws(
      () =>
        loadAndVerifyReleaseTagPublisher({ configPath, verifyFile() {} }),
      /empty or exceeds its size limit/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("tag publication has one hard native deadline", () => {
  const binding = fixture().config;
  const calls = [];
  const args = ["publish", "--tag", "v26.7.2200"];
  publishReleaseTag(binding, args, {
    exec(file, actualArgs, options) {
      calls.push({ file, args: actualArgs, options });
      return "";
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, binding.publisherPath);
  assert.deepEqual(calls[0].args, args);
  assert.equal(calls[0].options.timeout, 120_000);
  assert.equal(calls[0].options.env.PATH, "/usr/bin:/bin");
});
