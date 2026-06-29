import test from "node:test";
import assert from "node:assert/strict";

import {
  formatDurationMs,
  getDeferredReason,
  getDeferredRetryDecision,
  getDeferredRetryMs,
  isPostCompletionRendererRebuildResult,
  parsePositiveDurationMs,
} from "./dev-sync-trigger.mjs";

test("detects deferred trigger reasons without conflating lock state and runtime state", () => {
  assert.equal(
    getDeferredReason({
      status: "error",
      detail: "background work is paused because runtime_deferred is active",
    }),
    "runtime_deferred",
  );
  assert.equal(
    getDeferredReason({
      status: "error",
      detail: "Mac is locked, waiting for unlock",
    }),
    "locked",
  );
  assert.equal(getDeferredReason({ status: "waiting", detail: "runtime_deferred" }), null);
});

test("uses provider-safe runtime deferral retry windows", () => {
  assert.equal(getDeferredRetryMs("facebook", "runtime_deferred"), 2 * 60 * 1000);
  assert.equal(getDeferredRetryMs("instagram", "runtime_deferred"), 10 * 60 * 1000);
  assert.equal(getDeferredRetryMs("linkedin", "runtime_deferred"), 30 * 60 * 1000);
  assert.equal(getDeferredRetryMs("instagram", "locked"), 10 * 60 * 1000);
  assert.equal(getDeferredRetryMs("instagram", "locked", { lockedRetryMs: 45_000 }), 45_000);
});

test("stops instead of queueing a second provider run after post-completion renderer rebuild", () => {
  const decision = getDeferredRetryDecision({
    provider: "instagram",
    parsed: {
      status: "error",
      detail: "background work is paused because runtime_deferred is active",
    },
    sawPostCompletionRendererRebuild: true,
    now: 1_000,
    deadline: 60 * 60 * 1000,
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.code, 3);
  assert.match(decision.detail, /already finished/);
});

test("allows locked retry when the Mac is locked and no provider run started", () => {
  const decision = getDeferredRetryDecision({
    provider: "linkedin",
    parsed: {
      status: "error",
      detail: "Mac is locked, waiting for unlock",
    },
    sawPostCompletionRendererRebuild: false,
    now: 1_000,
    deadline: 20 * 60 * 1000,
  });

  assert.deepEqual(decision, {
    action: "retry",
    reason: "locked",
    retryMs: 10 * 60 * 1000,
  });
});

test("stops when the locked retry would exceed the helper window", () => {
  const decision = getDeferredRetryDecision({
    provider: "facebook",
    parsed: {
      status: "error",
      detail: "Mac is locked, waiting for unlock",
    },
    sawPostCompletionRendererRebuild: false,
    now: 1_000,
    deadline: 5 * 60 * 1000,
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.code, 3);
  assert.match(decision.detail, /Mac is locked/);
  assert.match(decision.detail, /10 minutes/);
});

test("does not squeeze long provider backoffs into the default helper window", () => {
  const decision = getDeferredRetryDecision({
    provider: "linkedin",
    parsed: {
      status: "error",
      detail: "background work is paused because runtime_deferred is active",
    },
    sawPostCompletionRendererRebuild: false,
    now: 1_000,
    deadline: 10 * 60 * 1000,
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.code, 3);
  assert.match(decision.detail, /30 minutes/);
});

test("detects renderer rebuilds that happen after provider completion", () => {
  assert.equal(
    isPostCompletionRendererRebuildResult({
      status: "waiting",
      detail: "Renderer was rebuilt after the sync trigger finished. Retrying after recovery.",
    }),
    true,
  );
  assert.equal(
    isPostCompletionRendererRebuildResult({
      status: "waiting",
      detail: "Renderer was rebuilt before the sync trigger finished. Retrying after recovery.",
    }),
    false,
  );
});

test("formats retry durations with grouped user-facing numbers", () => {
  assert.equal(formatDurationMs(30_000), "30 seconds");
  assert.equal(formatDurationMs(10 * 60 * 1000), "10 minutes");
});

test("parses positive duration overrides and falls back on invalid values", () => {
  assert.equal(parsePositiveDurationMs("21600000", 60_000), 21_600_000);
  assert.equal(parsePositiveDurationMs("1000.8", 60_000), 1_001);
  assert.equal(parsePositiveDurationMs("0", 60_000), 60_000);
  assert.equal(parsePositiveDurationMs("nope", 60_000), 60_000);
  assert.equal(parsePositiveDurationMs("", 60_000), 60_000);
});
