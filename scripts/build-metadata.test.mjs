import assert from "node:assert/strict";
import test from "node:test";

import { getBuildMetadata } from "./lib/build-metadata.mjs";

test("numeric desktop dev releases keep their explicit channel and GitHub identity", () => {
  const metadata = getBuildMetadata("26.7.1200", {
    FREED_BUILD_KIND: "release",
    FREED_BUILD_CHANNEL: "dev",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REF_NAME: "v26.7.1200-dev",
    FREED_BUILD_TIMESTAMP: "2026-07-10T20:00:00.000Z",
  });

  assert.deepEqual(metadata, {
    appVersion: "26.7.1200",
    buildKind: "release",
    channel: "dev",
    commitSha: "a".repeat(40),
    commitRef: "v26.7.1200-dev",
    deployedAt: "2026-07-10T20:00:00.000Z",
  });
});

test("numeric production releases keep the production channel", () => {
  const metadata = getBuildMetadata("26.7.1200", {
    FREED_BUILD_KIND: "release",
    FREED_BUILD_CHANNEL: "production",
    GITHUB_REF_NAME: "v26.7.1200",
  });

  assert.equal(metadata.channel, "production");
});

test("release channel metadata validates explicit values and preserves safe fallbacks", () => {
  assert.equal(
    getBuildMetadata("26.7.1200", {
      FREED_BUILD_KIND: "release",
      GITHUB_REF_NAME: "v26.7.1200-dev",
    }).channel,
    "dev",
  );
  assert.throws(
    () =>
      getBuildMetadata("26.7.1200", {
        FREED_BUILD_KIND: "release",
        FREED_BUILD_CHANNEL: "staging",
      }),
    /FREED_BUILD_CHANNEL must be dev or production/,
  );
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
  assert.equal(metadata.channel, "production");
});

test("production hosting builds infer a channel without desktop release metadata", () => {
  const metadata = getBuildMetadata("26.7.1200", {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
  });

  assert.equal(metadata.buildKind, "release");
  assert.equal(metadata.channel, "production");
});
