import assert from "node:assert/strict";
import test from "node:test";

import {
  canaryRegressionTolerances,
  invariantAlarmMeetsMetricContract,
  isMainRendererRecoveryRecord,
  MAX_COMPARABLE_WINDOW_DURATION_RATIO,
  metricContractForAssertion,
  metricSignalsForBucket,
  MIN_COMPARABLE_WINDOW_DURATION_RATIO,
  STABILITY_METRIC_REGISTRY_VERSION,
  STABILITY_METRICS,
  summarizeRendererRecoverySequences,
  windowDurationsAreComparable,
} from "./lib/stability-metrics.mjs";

test("the stability metric registry has unique ids and a version", () => {
  assert.equal(STABILITY_METRIC_REGISTRY_VERSION, 7);
  assert.equal(
    new Set(STABILITY_METRICS.map((metric) => metric.id)).size,
    STABILITY_METRICS.length,
  );
  const assertionIds = STABILITY_METRICS.map(
    (metric) => metric.soakAssertionId,
  ).filter(Boolean);
  assert.equal(new Set(assertionIds).size, assertionIds.length);
  const canaryMetrics = STABILITY_METRICS.flatMap((metric) =>
    metric.canaryMetrics.map((item) => item.name),
  );
  assert.equal(new Set(canaryMetrics).size, canaryMetrics.length);
  for (const metric of STABILITY_METRICS) {
    if (metric.target?.kind === "max_rate") {
      assert.equal(typeof metric.target.unit, "string");
      assert.equal(typeof metric.target.denominator, "string");
    }
    for (const canaryMetric of metric.canaryMetrics) {
      if (
        canaryMetric.name.endsWith("PerHour") ||
        canaryMetric.name.endsWith("PerDay")
      ) {
        assert.equal(typeof canaryMetric.unit, "string");
        assert.equal(typeof canaryMetric.denominator, "string");
      }
    }
  }
});

test("main window destruction is a renderer recovery and other windows are not", () => {
  assert.equal(
    isMainRendererRecoveryRecord({ event: "window_destroyed", label: "main" }),
    true,
  );
  assert.equal(
    isMainRendererRecoveryRecord({
      event: "window_destroyed",
      label: "facebook-scraper",
    }),
    false,
  );
  assert.equal(
    isMainRendererRecoveryRecord({
      event: "renderer_recovery_restart_requested",
      label: "main",
    }),
    false,
  );
});

test("renderer recovery sequences count successful rebuilds and restart-only escalation", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartOnly = {
    event: "renderer_recovery_restart_requested",
    reason: "webkit hot resident pressure",
    tsMs: 30_000,
  };
  const summary = summarizeRendererRecoverySequences([
    mainRecovery,
    {
      event: "window_destroyed",
      label: "linkedin-scraper",
      requestedBy: "job complete",
      tsMs: 2_000,
    },
    restartOnly,
  ]);

  assert.equal(summary.count, 2);
  assert.deepEqual(
    summary.sequences.map((sequence) => sequence.primary),
    [mainRecovery, restartOnly],
  );
});

test("renderer recovery attempts alone are diagnostic and do not count", () => {
  assert.equal(
    summarizeRendererRecoverySequences([
      { event: "renderer_recovery_attempt", tsMs: 1_000 },
    ]).count,
    0,
  );
});

test("a matching restart escalation is paired with one prior main rebuild", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "webkit hot resident pressure",
    appSessionId: "renderer-before-rebuild",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "webkit hot resident pressure",
    appSessionId: "renderer-after-rebuild",
    tsMs: 8_400,
  };
  const summary = summarizeRendererRecoverySequences([
    mainRecovery,
    {
      event: "worker_spawn",
      appSessionId: "renderer-after-rebuild",
      tsMs: 4_000,
    },
    restartRequest,
  ]);

  assert.equal(summary.count, 1);
  assert.equal(summary.sequences[0].mainWindowDestroyed, mainRecovery);
  assert.equal(summary.sequences[0].restartRequest, restartRequest);
});

test("the renderer recovery escalation window includes exactly 15 seconds", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
  };

  assert.equal(
    summarizeRendererRecoverySequences([
      mainRecovery,
      { ...restartRequest, tsMs: 16_000 },
    ]).count,
    1,
  );
  assert.equal(
    summarizeRendererRecoverySequences([
      mainRecovery,
      { ...restartRequest, tsMs: 16_001 },
    ]).count,
    2,
  );
});

test("renderer recovery pairing is timestamp ordered and preserves duplicate input", () => {
  const duplicatedMainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const earlierRestartInInput = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 5_000,
  };
  const summary = summarizeRendererRecoverySequences([
    earlierRestartInInput,
    duplicatedMainRecovery,
    duplicatedMainRecovery,
  ]);

  assert.equal(summary.count, 2);
  assert.equal(summary.sequences[0].restartRequest, null);
  assert.equal(summary.sequences[1].restartRequest, earlierRestartInInput);
});

test("matching restart requests consume the nearest unmatched prior rebuild", () => {
  const firstMain = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const secondMain = { ...firstMain, tsMs: 3_000 };
  const firstRestart = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 5_000,
  };
  const secondRestart = { ...firstRestart, tsMs: 7_000 };
  const summary = summarizeRendererRecoverySequences([
    firstMain,
    secondMain,
    firstRestart,
    secondRestart,
  ]);

  assert.equal(summary.count, 2);
  assert.equal(summary.sequences[0].restartRequest, secondRestart);
  assert.equal(summary.sequences[1].restartRequest, firstRestart);
});

test("renderer recovery pairing fails closed across native generations", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    nativeBootId: "native-generation-a",
    nativePid: 101,
    tsMs: 1_000,
  };
  const sameGeneration = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    nativeBootId: "native-generation-a",
    nativePid: 101,
    tsMs: 2_000,
  };
  assert.equal(
    summarizeRendererRecoverySequences([mainRecovery, sameGeneration]).count,
    1,
  );

  for (const restartRequest of [
    { ...sameGeneration, nativeBootId: "native-generation-b" },
    { ...sameGeneration, nativePid: 202 },
    { ...sameGeneration, nativeBootId: undefined },
    { ...sameGeneration, nativePid: undefined },
  ]) {
    assert.equal(
      summarizeRendererRecoverySequences([mainRecovery, restartRequest]).count,
      2,
    );
  }
});

test("nearest recovery identity failure cannot reach back to an older match", () => {
  const olderMain = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    nativePid: 101,
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    nativePid: 101,
    tsMs: 3_000,
  };
  for (const nearerGeneration of [
    {},
    { nativePid: 202 },
    { nativeBootId: "native-generation-b" },
  ]) {
    const summary = summarizeRendererRecoverySequences([
      olderMain,
      {
        event: "window_destroyed",
        label: "main",
        requestedBy: "renderer heartbeat stale",
        tsMs: 2_000,
        ...nearerGeneration,
      },
      restartRequest,
    ]);

    assert.equal(summary.count, 3);
    assert.equal(summary.sequences[2].primary, restartRequest);
  }
});

test("an explicit native generation transition closes keyless legacy candidates", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 6_000,
  };
  const summary = summarizeRendererRecoverySequences([
    { event: "native_runtime_memory_sample", nativePid: 101, tsMs: 1_000 },
    mainRecovery,
    { event: "native_runtime_memory_sample", nativePid: 202, tsMs: 4_000 },
    restartRequest,
  ]);

  assert.equal(summary.count, 2);
  assert.equal(summary.sequences[0].primary, mainRecovery);
  assert.equal(summary.sequences[1].primary, restartRequest);
});

test("valid native generation evidence disables keyless legacy pairing", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  const summary = summarizeRendererRecoverySequences([
    mainRecovery,
    {
      event: "native_runtime_memory_sample",
      nativePid: 202,
      tsMs: 1_500,
    },
    restartRequest,
  ]);

  assert.equal(summary.count, 2);
  assert.equal(summary.sequences[0].primary, mainRecovery);
  assert.equal(summary.sequences[1].primary, restartRequest);
});

test("an untimed native generation record disables keyless legacy pairing", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  const untimedNewGeneration = {
    event: "native_runtime_memory_sample",
    nativePid: 202,
  };
  const evidence = [
    { event: "native_runtime_memory_sample", nativePid: 101, tsMs: 500 },
    mainRecovery,
    untimedNewGeneration,
    restartRequest,
  ];

  const summary = summarizeRendererRecoverySequences(evidence);
  assert.equal(summary.count, 2);
  assert.equal(summary.sequences[0].primary, mainRecovery);
  assert.equal(summary.sequences[1].primary, restartRequest);
});

test("an untimed generation boundary disables explicit endpoint pairing", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    nativePid: 101,
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    nativePid: 101,
    tsMs: 2_000,
  };

  assert.equal(
    summarizeRendererRecoverySequences([
      mainRecovery,
      { event: "native_runtime_memory_sample", nativePid: 202 },
      restartRequest,
    ]).count,
    2,
  );
});

test("malformed present native generation fields cannot use the legacy fallback", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  for (const malformedMain of [
    { ...mainRecovery, nativePid: "invalid" },
    { ...mainRecovery, nativeBootId: " " },
    { ...mainRecovery, nativeBootId: 101 },
  ]) {
    assert.equal(
      summarizeRendererRecoverySequences([malformedMain, restartRequest]).count,
      2,
    );
  }
});

test("an earlier malformed native generation disables later keyless pairing", () => {
  const summary = summarizeRendererRecoverySequences([
    {
      event: "native_runtime_memory_sample",
      nativePid: "invalid",
      tsMs: 500,
    },
    {
      event: "window_destroyed",
      label: "main",
      requestedBy: "renderer heartbeat stale",
      tsMs: 1_000,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: 2_000,
    },
  ]);

  assert.equal(summary.count, 2);
});

test("null native generation fields disable all recovery pairing", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const restartRequest = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  for (const malformedGenerationRecord of [
    {
      event: "native_runtime_memory_sample",
      nativePid: null,
      tsMs: 1_500,
    },
    {
      event: "native_runtime_memory_sample",
      nativeBootId: null,
    },
  ]) {
    assert.equal(
      summarizeRendererRecoverySequences([
        mainRecovery,
        malformedGenerationRecord,
        restartRequest,
      ]).count,
      2,
    );
  }
});

test("malformed, late, and mismatched restart requests remain separate recoveries", () => {
  const mainRecovery = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  for (const restartRequest of [
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: null,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: " ",
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: "2000",
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: 0,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: -1,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: Number.POSITIVE_INFINITY,
    },
    {
      event: "renderer_recovery_restart_requested",
      tsMs: 2_000,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale",
      tsMs: 16_001,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "webkit hot resident pressure",
      tsMs: 2_000,
    },
    {
      event: "renderer_recovery_restart_requested",
      reason: "renderer heartbeat stale ",
      tsMs: 2_000,
    },
  ]) {
    assert.equal(
      summarizeRendererRecoverySequences([mainRecovery, restartRequest]).count,
      2,
    );
  }
});

test("historical selected-window regressions count main rebuilds that the old assertion missed", () => {
  // These are the exact in-window recovery records from the named soak
  // artifacts. The July 8 artifact also contains an earlier mirrored record
  // outside its UTC verdict window, so that selected window correctly has one.
  const july7SelectedWindow = [
    {
      event: "window_destroyed",
      label: "main",
      reasonEnum: "watchdog_memory",
      requestedBy: "main renderer WebKit resident tail high",
      evidenceLine: 106,
      tsMs: 1_783_407_791_342,
    },
  ];
  const july8SelectedWindow = [
    {
      event: "window_destroyed",
      label: "main",
      reasonEnum: "watchdog_memory",
      requestedBy: "main renderer WebKit resident memory hot",
      evidenceLine: 2_397,
      tsMs: 1_783_476_518_999,
    },
  ];

  assert.equal(summarizeRendererRecoverySequences(july7SelectedWindow).count, 1);
  assert.equal(summarizeRendererRecoverySequences(july8SelectedWindow).count, 1);
});

test("shared comparison windows accept only the inclusive 0.8 through 1.25 ratio", () => {
  assert.equal(MIN_COMPARABLE_WINDOW_DURATION_RATIO, 0.8);
  assert.equal(MAX_COMPARABLE_WINDOW_DURATION_RATIO, 1.25);
  assert.equal(windowDurationsAreComparable(100, 80), true);
  assert.equal(windowDurationsAreComparable(100, 125), true);
  assert.equal(windowDurationsAreComparable(100, 79), false);
  assert.equal(windowDurationsAreComparable(100, 126), false);
  assert.equal(windowDurationsAreComparable(0, 100), false);
});

test("cloud soak, triage, and canary surfaces share one rate contract", () => {
  const contract = metricContractForAssertion("uploads_unchanged_heads");
  assert.deepEqual(contract.target, {
    kind: "max_rate",
    unit: "events/cloud-eligible-hour",
    denominator: "cloudEligibleHours",
    value: 5,
    exclusive: true,
    minHours: 1,
  });
  assert.deepEqual(metricSignalsForBucket("cloud-loop"), {
    assertions: ["uploads_unchanged_heads", "startup_repair_upload_budget"],
    alarms: ["cloud_loop"],
    canaryMetrics: [
      "uploadsUnchangedPerHour",
      "uploadsPerHour",
      "startupRepairUploadsPerHour",
    ],
  });
  assert.deepEqual(canaryRegressionTolerances().uploadsUnchangedPerHour, {
    kind: "ratio",
    allowance: 1.5,
    direction: "lower",
  });
});

test("request-surface metrics share explicit denominators and retry budgets", () => {
  assert.deepEqual(
    metricContractForAssertion("startup_repair_upload_budget").target,
    {
      kind: "max_group_count",
      groupBy: ["appSessionId", "provider"],
      value: 1,
    },
  );
  assert.deepEqual(
    metricContractForAssertion("social_outbox_retry_budget").target,
    {
      kind: "max_event_fields",
      fields: ["attempt", "maxAttempts"],
      value: 3,
    },
  );
  for (const metricName of [
    "socialOutboxAttemptsPerHour",
    "facebookGroupDiscoveryUpdatesPerHour",
    "rssPullAttemptsPerHour",
    "aiRequestAttemptsPerHour",
    "readerArticleFetchAttemptsPerHour",
  ]) {
    assert.equal(
      STABILITY_METRICS.flatMap((metric) => metric.canaryMetrics).find(
        (metric) => metric.name === metricName,
      ).denominator,
      "appAliveHours",
    );
  }
  assert.equal(
    STABILITY_METRICS.flatMap((metric) => metric.canaryMetrics).find(
      (metric) => metric.name === "startupRepairUploadsPerHour",
    ).denominator,
    "cloudEligibleHours",
  );
});

test("worker soak, triage, and canary surfaces share one rate contract", () => {
  const contract = metricContractForAssertion("worker_init_rate");
  assert.deepEqual(contract.target, {
    kind: "max_rate",
    unit: "events/app-alive-hour",
    denominator: "appAliveHours",
    value: 10,
    exclusive: true,
    minHours: 1,
  });
  assert.deepEqual(metricSignalsForBucket("worker-churn"), {
    assertions: ["worker_init_rate"],
    alarms: [],
    canaryMetrics: ["workerInitsPerHour"],
  });
  assert.deepEqual(canaryRegressionTolerances().workerInitsPerHour, {
    kind: "ratio",
    allowance: 1.5,
    direction: "lower",
  });
  assert.deepEqual(contract.outcomeGuardrailMetricIds, [
    "app-memory-pressure-p95",
  ]);
  assert.deepEqual(canaryRegressionTolerances().appMemoryPressureP95Bytes, {
    kind: "absolute",
    allowance: 128 * 1024 * 1024,
    direction: "lower",
  });
});

test("lost novel item outcomes guard against renderer recovery regression", () => {
  const contract = metricContractForAssertion("scrape_zero_persist");

  assert.deepEqual(contract.outcomeGuardrailMetricIds, [
    "renderer-recovery-count",
  ]);
});

test("provider-neutral lifecycle metrics route to their existing program buckets", () => {
  assert.deepEqual(metricSignalsForBucket("preflight-kill"), {
    assertions: ["preflight_kills"],
    alarms: ["preflight_kill"],
    canaryMetrics: [],
  });
  assert.deepEqual(metricSignalsForBucket("scrape-zero-persist"), {
    assertions: ["scrape_zero_persist"],
    alarms: ["scrape_zero_persist"],
    canaryMetrics: [],
  });
});

test("legacy invariant shortcuts cannot become actionable evidence", () => {
  assert.equal(
    invariantAlarmMeetsMetricContract({
      event: "invariant_alarm",
      name: "preflight_kill",
      detail: "window_destroyed reason=job_complete scraperSessionHeld=true",
    }),
    false,
  );
  assert.equal(
    invariantAlarmMeetsMetricContract({
      event: "invariant_alarm",
      name: "scrape_zero_persist",
      itemsNovel: 0,
      itemsPersisted: 0,
    }),
    false,
  );
  assert.equal(
    invariantAlarmMeetsMetricContract({
      event: "invariant_alarm",
      name: "scrape_zero_persist",
      itemsNovel: 5,
      itemsPersisted: 0,
    }),
    true,
  );
});
