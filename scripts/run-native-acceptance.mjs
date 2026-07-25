#!/usr/bin/env node
// Run the native acceptance tests and refuse to report success on a platform
// where they cannot actually assert anything.
//
// These files guard launchd actors, Keychain-backed publisher trust, and the
// signed broker handoff. On Linux they skip themselves, so a green Ubuntu run
// proves nothing about them. This runner makes that explicit instead of letting
// a vacuous pass look like coverage.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_ACCEPTANCE_TEST_FILES,
  REPO_ROOT,
} from "./lib/tooling-smoke-suites.mjs";

// Native acceptance touches launchd, Keychain and the signed broker, all of
// which can block on a machine that is not provisioned for them. Cap each test
// so a block fails with a name instead of eating the job.
//
// Sized from measurement, not preference. The publish tests spawn real git and
// gh subprocesses: roughly 65s each locally, and 175-250s on a hosted macOS
// runner. An earlier 120s cap killed healthy tests and buried the one genuine
// macOS failure underneath a wall of false timeouts. That those tests are this
// slow at all is separate debt, tracked on the native acceptance issue.
export const NATIVE_TEST_TIMEOUT_MS = 420_000;

export function nativeAcceptanceIsMeaningful(platform = process.platform) {
  return platform === "darwin";
}

function main(argv) {
  const allowNonDarwin = argv.includes("--allow-non-darwin");
  if (!nativeAcceptanceIsMeaningful() && !allowNonDarwin) {
    process.stderr.write(
      `Native acceptance requires macOS. This runner is ${process.platform}, where every assertion skips itself.\n` +
        "Run this lane on a macOS runner, or pass --allow-non-darwin to acknowledge a vacuous run.\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    `Running ${NATIVE_ACCEPTANCE_TEST_FILES.length.toLocaleString()} native acceptance files on ${process.platform}.\n`,
  );
  // Without this the run has no per-test timeout, so one stuck test consumes the
  // whole job budget and reports only "cancelled" with nothing to act on. These
  // files had never executed on a real macOS runner before this lane existed;
  // the first run hung for the full 30 minute job timeout. A named timeout
  // failure is the difference between a diagnosable defect and a mystery.
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-timeout=${NATIVE_TEST_TIMEOUT_MS}`,
      ...NATIVE_ACCEPTANCE_TEST_FILES,
    ],
    { cwd: REPO_ROOT, env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.signal !== null) {
    throw new Error(`Native acceptance stopped on signal ${result.signal}.`);
  }
  process.exitCode = result.status ?? 1;
}

if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
