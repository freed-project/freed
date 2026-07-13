#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadAndVerifyReleaseTagPublisher } from "./lib/release-tag-publisher.mjs";

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(
      "Usage: node scripts/release-tag-publisher.mjs <attest|publish> [publisher arguments]\n",
    );
    return;
  }
  if (!["attest", "publish"].includes(command)) {
    throw new Error("Release tag publisher command must be attest or publish.");
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
  execFileSync(binding.publisherPath, args, { stdio: "inherit" });
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
