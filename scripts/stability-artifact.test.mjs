import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  stabilityArtifactDigest,
  validateStabilityArtifact,
  writeStabilityArtifact,
} from "./lib/stability-artifacts.mjs";

function controllerArtifact(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "stability-controller",
    taskId: "P1-04",
    createdAt: "2026-07-10T20:00:00.000Z",
    status: "selected",
    source: {
      status: "healthy",
      references: [
        { reference: "triage/generation.json", digest: "a".repeat(64) },
      ],
    },
    payload: {
      currentState: "triaged",
      evidenceQuality: "attributable",
      metricContract: "active-operation-window-destruction",
      authority: "pr-only",
      providerRiskStatus: "not-provider-visible",
      exclusivityKey: "preflight-recycle-behavior",
      nextSkill: "freed-build-feature",
    },
    ...overrides,
  };
}

function memoryArtifact(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "memory-profile",
    taskId: "P2-01",
    createdAt: "2026-07-10T20:00:00.000Z",
    status: "pass",
    identity: {
      version: "26.7.1000-dev",
      commitSha: "b".repeat(40),
      channel: "dev",
    },
    window: {
      start: "2026-07-10T18:00:00.000Z",
      end: "2026-07-10T20:00:00.000Z",
    },
    source: {
      status: "healthy",
      references: [
        { reference: "soaks/P2-01/metrics.tsv", digest: "c".repeat(64) },
      ],
    },
    payload: {
      scenario: "large-document-idle",
      comparisonCohort: "apple-silicon-32gb-large",
      metricId: "main-footprint-slope",
      budget: { value: 5, unit: "MiB/hour" },
      contributors: [],
      measuredScope: ["Freed Desktop native and attributed WebKit RSS"],
      excludedScope: ["machine-wide unrelated WebKit processes"],
    },
    ...overrides,
  };
}

test("stability artifacts validate and write one immutable content-addressed file", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-stability-artifact-"));
  const artifact = controllerArtifact();
  assert.doesNotThrow(() => validateStabilityArtifact(artifact));
  const first = writeStabilityArtifact(artifact, { artifactRoot: root });
  const second = writeStabilityArtifact(artifact, { artifactRoot: root });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.path, second.path);
  const stored = JSON.parse(readFileSync(first.path, "utf8"));
  assert.equal(stored.artifactDigest, stabilityArtifactDigest(artifact));
  assert.ok(first.path.includes(path.join("stability-controller", "P1-04")));
});

test("stability artifact reuse rejects conflicting bytes at the content address", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-stability-artifact-conflict-"),
  );
  const artifact = controllerArtifact();
  const first = writeStabilityArtifact(artifact, { artifactRoot: root });
  writeFileSync(first.path, "{}\n");

  assert.throws(
    () => writeStabilityArtifact(artifact, { artifactRoot: root }),
    /Existing stability artifact content differs/,
  );
});

test("stability artifacts reject missing kind-specific output fields", () => {
  const artifact = controllerArtifact();
  delete artifact.payload.nextSkill;
  assert.throws(
    () => validateStabilityArtifact(artifact),
    /payload.nextSkill is required/,
  );
  assert.throws(
    () => validateStabilityArtifact(controllerArtifact({ status: "merged" })),
    /status must be one of/,
  );
});

test("stability artifacts reject empty evidence and mistyped kind payloads", () => {
  assert.throws(
    () =>
      validateStabilityArtifact(
        controllerArtifact({
          source: { status: "healthy", references: [] },
        }),
      ),
    /source.references must contain at least one immutable reference/,
  );
  assert.throws(
    () =>
      validateStabilityArtifact(
        controllerArtifact({
          payload: {
            ...controllerArtifact().payload,
            authority: "unbounded",
            nextSkill: 42,
          },
        }),
      ),
    /payload.authority must be observe-only[\s\S]*payload.nextSkill must be a non-empty string/,
  );
});

test("provider review artifacts require named providers and human-readable risk fields", () => {
  const artifact = controllerArtifact({
    kind: "provider-risk-review",
    status: "behavior_approved",
    payload: {
      providers: null,
      observableBehavior: 1,
      fingerprintingRisk: "YouTube can observe the changed contact pattern.",
      lowestProfileAlternative:
        "Keep the current pattern and collect passive evidence.",
      allowedBehavior: "Only the named YouTube capture flow.",
    },
  });
  assert.throws(
    () => validateStabilityArtifact(artifact),
    /payload.providers must be an array[\s\S]*payload.observableBehavior must be a non-empty string/,
  );
});

test("stability artifacts reject unknown optional metric ids", () => {
  const valid = controllerArtifact({
    kind: "provider-risk-review",
    status: "diff_authorized",
    payload: {
      providers: ["other"],
      observableBehavior: "Observe the reviewed provider behavior.",
      fingerprintingRisk: "The provider can observe authenticated requests.",
      lowestProfileAlternative: "Keep provider contact disabled.",
      allowedBehavior: "Only the exact reviewed provider behavior.",
      metricId: "renderer-recovery-count",
    },
  });
  assert.doesNotThrow(() => validateStabilityArtifact(valid));
  assert.throws(
    () =>
      validateStabilityArtifact({
        ...valid,
        payload: {
          ...valid.payload,
          metricId: "unregistered-provider-wish",
        },
      }),
    /payload.metricId must name a registered stability metric/,
  );
});

test("stability artifact validation rejects a stale embedded digest", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-stability-artifact-digest-"),
  );
  const stored = writeStabilityArtifact(controllerArtifact(), {
    artifactRoot: root,
  }).artifact;
  assert.doesNotThrow(() => validateStabilityArtifact(stored));
  assert.throws(
    () =>
      validateStabilityArtifact({
        ...stored,
        payload: { ...stored.payload, currentState: "implemented" },
      }),
    /artifactDigest does not match the artifact content/,
  );
});

test("memory profile artifacts require an immutable source and typed budget", () => {
  assert.doesNotThrow(() => validateStabilityArtifact(memoryArtifact()));
  assert.throws(
    () =>
      validateStabilityArtifact(
        memoryArtifact({
          source: {
            status: "healthy",
            references: [{ reference: "metrics.tsv" }],
          },
          payload: { ...memoryArtifact().payload, budget: "under five" },
        }),
      ),
    /source.references\[0\]\.digest must be SHA-256[\s\S]*payload.budget must be an object/,
  );
});
