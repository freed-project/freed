import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseReleaseVersion,
  releaseVersionFromComponents,
} from "./release-version.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "release-version.mjs",
);

test("release version parser returns canonical production and dev identities", () => {
  assert.deepEqual(
    parseReleaseVersion("v26.7.1200", { requireTagPrefix: true }),
    {
      tag: "v26.7.1200",
      version: "26.7.1200",
      appVersion: "26.7.1200",
      channel: "production",
      major: 26,
      month: 7,
      patch: 1200,
      day: 12,
      build: 0,
      dayKey: "26.7.12",
    },
  );
  assert.equal(
    parseReleaseVersion("26.7.1201", { channel: "dev" }).version,
    "26.7.1201-dev",
  );
  assert.equal(
    parseReleaseVersion("26.7.1201-dev", { channel: "dev" }).appVersion,
    "26.7.1201",
  );
});

test("release version parser rejects noncanonical and platform-invalid values", () => {
  for (const value of [
    "026.7.1200",
    "26.07.1200",
    "26.7.01200",
    "256.7.1200",
    "26.0.1200",
    "26.13.1200",
    "26.7.99",
    "26.7.3200",
    "26.7.1200-beta",
    "26.7.1200-dev.1",
    "v26.7.1200",
  ]) {
    assert.throws(() => parseReleaseVersion(value), Error, value);
  }
  assert.throws(
    () => parseReleaseVersion("26.7.1200-dev", { channel: "production" }),
    /Production releases require canonical numeric CalVer/,
  );
});

test("release component encoding rejects build overflow before it shifts the day", () => {
  assert.equal(
    releaseVersionFromComponents({
      major: 26,
      month: 7,
      day: 12,
      build: 99,
      channel: "production",
    }).version,
    "26.7.1299",
  );
  assert.throws(
    () =>
      releaseVersionFromComponents({
        major: 26,
        month: 7,
        day: 12,
        build: 100,
        channel: "production",
      }),
    /outside the supported range 0 through 99/,
  );
});

test("release version command normalizes dev versions and fails before shell mutation", () => {
  assert.equal(
    execFileSync(process.execPath, [script, "--channel=dev", "26.7.1204"], {
      encoding: "utf8",
    }).trim(),
    "26.7.1204-dev",
  );
  const invalid = spawnSync(
    process.execPath,
    [script, "--channel=production", "26.7.3200"],
    { encoding: "utf8" },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /encodes day 32/);

  const buildOverflow = spawnSync(
    process.execPath,
    [
      script,
      "--channel=production",
      "--major=26",
      "--month=7",
      "--day=12",
      "--build=100",
    ],
    { encoding: "utf8" },
  );
  assert.equal(buildOverflow.status, 1);
  assert.match(
    buildOverflow.stderr,
    /outside the supported range 0 through 99/,
  );
});
