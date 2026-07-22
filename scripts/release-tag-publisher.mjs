#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  invokeReleaseTagPublisherAction,
  loadAndVerifyReleaseTagPublisher,
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
  const hostArguments =
    args.length === 1 && command !== "publish"
      ? [
          command,
          "--repo",
          binding.repo,
          "--app-id",
          String(binding.appId),
          "--app-slug",
          binding.appSlug,
        ]
      : args;
  const result = invokeReleaseTagPublisherAction(binding, hostArguments);
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
