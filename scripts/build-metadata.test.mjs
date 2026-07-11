import assert from "node:assert/strict";
import test from "node:test";

import { getBuildMetadata } from "./lib/build-metadata.mjs";

test("desktop release builds keep their GitHub commit identity", () => {
  const metadata = getBuildMetadata("26.7.1000-dev", {
    FREED_BUILD_KIND: "release",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REF_NAME: "v26.7.1000-dev",
    FREED_BUILD_TIMESTAMP: "2026-07-10T20:00:00.000Z",
  });

  assert.deepEqual(metadata, {
    appVersion: "26.7.1000-dev",
    buildKind: "release",
    commitSha: "a".repeat(40),
    commitRef: "v26.7.1000-dev",
    deployedAt: "2026-07-10T20:00:00.000Z",
  });
});

test("explicit build identity wins over hosting environment fallbacks", () => {
  const metadata = getBuildMetadata("26.7.1000", {
    FREED_BUILD_COMMIT_SHA: "b".repeat(40),
    FREED_BUILD_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
    VERCEL_GIT_COMMIT_REF: "www",
  });

  assert.equal(metadata.commitSha, "b".repeat(40));
  assert.equal(metadata.commitRef, "main");
});
