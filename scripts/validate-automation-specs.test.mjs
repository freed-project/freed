import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateAutomationSpec,
  validateAutomationSpecs,
} from "./validate-automation-specs.mjs";

test("checked-in automation specifications are internally consistent", () => {
  const specs = validateAutomationSpecs();
  assert.equal(specs.length, 5);
  assert.ok(specs.some((spec) => spec.id === "freed-nightly-runner"));
  assert.ok(specs.some((spec) => spec.authority === "observe-only"));
  assert.ok(
    specs.every(
      (spec) =>
        spec.requiredHostCapabilities.includes("trusted-launcher") &&
        spec.requiredHostCapabilities.includes("short-lived-lease-handoff"),
    ),
  );
});

test("automation specifications reject stale prompt paths and unsafe observer authority", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-automation-spec-"));
  mkdirSync(path.join(root, "automation", "prompts"), { recursive: true });
  writeFileSync(
    path.join(root, "automation", "prompts", "observer.md"),
    "Inspect website/src/pages/Roadmap.tsx and continue.",
  );
  const spec = {
    schemaVersion: 1,
    id: "observer",
    name: "Observer",
    kind: "heartbeat",
    promptPath: "automation/prompts/observer.md",
    authority: "observe-only",
    providerBehavior: "forbidden",
    maxBehavioralChangesPerSoak: 0,
    stateRoot: "~/.freed/automation",
    lease: { name: "observer", maxLifetimeMs: 1_800_000 },
    localOverlayFields: ["status", "rrule", "destination", "target_thread_id"],
    requiredHostCapabilities: ["trusted-launcher", "short-lived-lease-handoff"],
  };
  assert.throws(
    () =>
      validateAutomationSpec(spec, {
        fileName: "observer.json",
        repoRoot: root,
      }),
    /obsolete public roadmap path/,
  );
});

test("automation specifications reject provider behavior without a scoped gate", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-automation-provider-spec-"),
  );
  mkdirSync(path.join(root, "automation", "prompts"), { recursive: true });
  writeFileSync(
    path.join(root, "automation", "prompts", "runner.md"),
    "Take one writer lease. Post (AI Generated). Then contact providers.",
  );
  const spec = {
    schemaVersion: 1,
    id: "runner",
    name: "Runner",
    kind: "cron",
    promptPath: "automation/prompts/runner.md",
    authority: "merge-safe",
    providerBehavior: "approval-required",
    maxBehavioralChangesPerSoak: 1,
    stateRoot: "~/.freed/automation",
    lease: { name: "runner", maxLifetimeMs: 1_800_000 },
    localOverlayFields: [
      "status",
      "rrule",
      "model",
      "reasoning_effort",
      "execution_environment",
      "target",
      "cwds",
    ],
    requiredHostCapabilities: ["trusted-launcher", "short-lived-lease-handoff"],
  };

  assert.throws(
    () =>
      validateAutomationSpec(spec, { fileName: "runner.json", repoRoot: root }),
    /must require a scoped approval record/,
  );
});

function writePromptFixture(text) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-automation-contract-"),
  );
  mkdirSync(path.join(root, "automation", "prompts"), { recursive: true });
  writeFileSync(path.join(root, "automation", "prompts", "actor.md"), text);
  return root;
}

function automationSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "actor",
    name: "Actor",
    kind: "cron",
    promptPath: "automation/prompts/actor.md",
    authority: "plan-only",
    providerBehavior: "forbidden",
    maxBehavioralChangesPerSoak: 0,
    stateRoot: "~/.freed/automation",
    lease: { name: "actor", maxLifetimeMs: 1_800_000 },
    localOverlayFields: [
      "status",
      "rrule",
      "model",
      "reasoning_effort",
      "execution_environment",
      "target",
      "cwds",
    ],
    requiredHostCapabilities: ["trusted-launcher", "short-lived-lease-handoff"],
    ...overrides,
  };
}

test("provider policy and behavioral soak allowance are independent", () => {
  const forbiddenRoot = writePromptFixture(
    "Remain plan-only. Do not trigger providers. One local product behavior is allowed.",
  );
  const forbiddenBehavior = automationSpec({ maxBehavioralChangesPerSoak: 1 });
  assert.doesNotThrow(() =>
    validateAutomationSpec(forbiddenBehavior, {
      fileName: "actor.json",
      repoRoot: forbiddenRoot,
    }),
  );

  const approvalRoot = writePromptFixture(
    "Remain plan-only. Require a scoped approval record before provider activity.",
  );
  const approvalWithoutBehavior = automationSpec({
    providerBehavior: "approval-required",
    maxBehavioralChangesPerSoak: 0,
  });
  assert.doesNotThrow(() =>
    validateAutomationSpec(approvalWithoutBehavior, {
      fileName: "actor.json",
      repoRoot: approvalRoot,
    }),
  );
});

test("PR-capable prompts require the external posting prefix", () => {
  const root = writePromptFixture(
    "Do not trigger providers. Prepare a pull request without merging it.",
  );
  const spec = automationSpec({ authority: "pr-only" });
  assert.throws(
    () =>
      validateAutomationSpec(spec, { fileName: "actor.json", repoRoot: root }),
    /PR-capable prompts must preserve the external posting prefix/,
  );
});

test("automation specifications reject unsafe local overlay fields", () => {
  const root = writePromptFixture(
    "Remain plan-only. Do not trigger providers.",
  );
  assert.throws(
    () =>
      validateAutomationSpec(
        automationSpec({ localOverlayFields: ["authority"] }),
        {
          fileName: "actor.json",
          repoRoot: root,
        },
      ),
    /unsupported localOverlayFields: authority/,
  );
  assert.throws(
    () =>
      validateAutomationSpec(
        automationSpec({ localOverlayFields: ["rrule", "rrule"] }),
        {
          fileName: "actor.json",
          repoRoot: root,
        },
      ),
    /must not contain duplicates/,
  );
});

test("automation specifications require complete host overlay and handoff contracts", () => {
  const root = writePromptFixture(
    "Remain plan-only. Do not trigger providers.",
  );
  assert.doesNotThrow(() =>
    validateAutomationSpec(
      automationSpec({
        localOverlayFields: [
          "status",
          "cadence",
          "model",
          "reasoning_effort",
          "execution_environment",
          "target",
          "cwds",
        ],
      }),
      { fileName: "actor.json", repoRoot: root },
    ),
  );
  assert.throws(
    () =>
      validateAutomationSpec(
        automationSpec({
          localOverlayFields: [
            "status",
            "rrule",
            "model",
            "reasoning_effort",
            "target",
            "cwds",
          ],
        }),
        { fileName: "actor.json", repoRoot: root },
      ),
    /cron localOverlayFields must be exactly/,
  );
  assert.throws(
    () =>
      validateAutomationSpec(
        automationSpec({ requiredHostCapabilities: ["trusted-launcher"] }),
        { fileName: "actor.json", repoRoot: root },
      ),
    /requiredHostCapabilities must be trusted-launcher and short-lived-lease-handoff/,
  );
});

test("automation specifications reject kind-inappropriate overlay fields", () => {
  const root = writePromptFixture(
    "Remain read-only. Do not trigger providers.",
  );
  const spec = automationSpec({
    kind: "heartbeat",
    authority: "observe-only",
    lease: { name: "actor", maxLifetimeMs: 1_800_000 },
    localOverlayFields: [
      "status",
      "rrule",
      "destination",
      "target_thread_id",
      "model",
    ],
  });
  assert.throws(
    () =>
      validateAutomationSpec(spec, { fileName: "actor.json", repoRoot: root }),
    /heartbeat localOverlayFields must be exactly/,
  );
});

test("checked-in specifications must match runtime actor authority", () => {
  const root = writePromptFixture(
    "Remain plan-only. Do not trigger providers.",
  );
  const spec = automationSpec();
  assert.throws(
    () =>
      validateAutomationSpec(spec, {
        fileName: "actor.json",
        repoRoot: root,
        actorPolicies: {
          actor: {
            leaseName: "actor",
            observerAuthority: "observe-only",
            providerAuthority: "forbidden",
          },
        },
      }),
    /does not match runtime actor policy observe-only/,
  );

  assert.throws(
    () =>
      validateAutomationSpec(spec, {
        fileName: "actor.json",
        repoRoot: root,
        actorPolicies: {
          actor: {
            leaseName: "actor",
            observerAuthority: "plan-only",
            providerAuthority: "approval-required",
          },
        },
      }),
    /does not match runtime actor policy approval-required/,
  );

  assert.throws(
    () =>
      validateAutomationSpec(spec, {
        fileName: "actor.json",
        repoRoot: root,
        actorPolicies: {},
      }),
    /no runtime actor policy exists/,
  );

  assert.throws(
    () =>
      validateAutomationSpec(
        automationSpec({ lease: { name: "wrong", maxLifetimeMs: 1_800_000 } }),
        {
          fileName: "actor.json",
          repoRoot: root,
          actorPolicies: {
            actor: {
              leaseName: "actor",
              observerAuthority: "plan-only",
              providerAuthority: "forbidden",
            },
          },
        },
      ),
    /lease wrong does not match runtime actor policy actor/,
  );
});
