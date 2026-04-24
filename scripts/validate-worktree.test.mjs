import test from "node:test";
import assert from "node:assert/strict";

import {
  buildValidationPlan,
  collectReleaseArtifactsToValidate,
  describePlan,
  parseArgs,
} from "./validate-worktree.mjs";

test("parseArgs accepts mode and changed files", () => {
  const parsed = parseArgs([
    "--mode",
    "feature",
    "--changed-files",
    "website/src/app/page.tsx",
    "README.md",
  ]);

  assert.equal(parsed.mode, "feature");
  assert.deepEqual(parsed.changedFiles, [
    "website/src/app/page.tsx",
    "README.md",
  ]);
});

test("feature plan for website-only changes stays on website checks", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["website/src/app/roadmap/RoadmapContent.tsx"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "website production build",
    "website tests",
  ]);
});

test("feature plan for shared changes covers both desktop and pwa surfaces", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/shared/src/schema.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "pwa production build",
    "pwa typecheck",
    "pwa unit tests",
    "desktop unit tests",
    "desktop e2e smoke",
  ]);
});

test("dev plan uses the fast desktop smoke lane", () => {
  const labels = describePlan(buildValidationPlan("dev", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(!labels.includes("desktop e2e full"));
  assert.ok(!labels.includes("desktop e2e perf"));
  assert.ok(!labels.includes("desktop e2e visual"));
});

test("production plan includes full, perf, visual, and production builds", () => {
  const labels = describePlan(buildValidationPlan("production", []));

  assert.ok(labels.includes("desktop e2e smoke"));
  assert.ok(labels.includes("desktop e2e full"));
  assert.ok(labels.includes("desktop e2e perf"));
  assert.ok(labels.includes("desktop e2e visual"));
  assert.ok(labels.includes("desktop production build"));
});

test("release mode remains a compatibility alias for production", () => {
  assert.deepEqual(
    describePlan(buildValidationPlan("release", [])),
    describePlan(buildValidationPlan("production", [])),
  );
});

test("feature plan for capture-only changes runs the touched workspace check", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["packages/capture-rss/src/index.ts"]),
  );

  assert.deepEqual(labels, [
    "root typecheck",
    "packages/capture-rss build",
  ]);
});

test("feature plan for release tooling changes runs script tests and artifact validation", () => {
  const labels = describePlan(
    buildValidationPlan("feature", ["scripts/prepare-release-notes.mjs"]),
  );

  assert.equal(labels[0], "root typecheck");
  assert.ok(labels.includes("release notes shared tests"));
  assert.ok(labels.includes("release note artifact validation"));
});

test("collectReleaseArtifactsToValidate resolves markdown artifacts to their json pairs", () => {
  const artifacts = collectReleaseArtifactsToValidate([
    "release-notes/releases/v26.4.1602.md",
  ]);

  assert.deepEqual(artifacts, ["release-notes/releases/v26.4.1602.json"]);
});
