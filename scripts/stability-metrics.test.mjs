import assert from "node:assert/strict";
import test from "node:test";

import {
  canaryRegressionTolerances,
  invariantAlarmMeetsMetricContract,
  MAX_COMPARABLE_WINDOW_DURATION_RATIO,
  metricContractForAssertion,
  metricSignalsForBucket,
  MIN_COMPARABLE_WINDOW_DURATION_RATIO,
  STABILITY_METRIC_REGISTRY_VERSION,
  STABILITY_METRICS,
  windowDurationsAreComparable,
} from "./lib/stability-metrics.mjs";

test("the stability metric registry has unique ids and a version", () => {
  assert.equal(STABILITY_METRIC_REGISTRY_VERSION, 4);
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
    assertions: ["uploads_unchanged_heads"],
    alarms: ["cloud_loop"],
    canaryMetrics: ["uploadsUnchangedPerHour", "uploadsPerHour"],
  });
  assert.deepEqual(canaryRegressionTolerances().uploadsUnchangedPerHour, {
    kind: "ratio",
    allowance: 1.5,
    direction: "lower",
  });
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
