#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  loadAndVerifyReleaseTagPublisher,
  publishReleaseTag,
  verifyReleaseTagPublisherInstallation,
} from "./lib/release-tag-publisher.mjs";

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(
      "Usage: node scripts/release-tag-publisher.mjs <attest|verify-installation|publish> [publisher arguments]\n",
    );
    return;
  }
  if (!["attest", "verify-installation", "publish"].includes(command)) {
    throw new Error(
      "Release tag publisher command must be attest, verify-installation, or publish.",
    );
  }
  const binding = loadAndVerifyReleaseTagPublisher();
  if (command === "attest") {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-binding",
        repo: binding.repo,
        appId: binding.appId,
        appSlug: binding.appSlug,
        publisherPath: binding.publisherPath,
        publisherSha256: binding.publisherSha256,
      })}\n`,
    );
    return;
  }
  if (command === "verify-installation") {
    const result = verifyReleaseTagPublisherInstallation(binding);
    process.stdout.write(`${JSON.stringify(result.attestation)}\n`);
    return;
  }
  publishReleaseTag(binding, args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
