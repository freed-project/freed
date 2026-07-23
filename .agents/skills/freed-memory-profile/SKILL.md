---
name: freed-memory-profile
description: Measure Freed memory demand with matched builds, workloads, document fixtures, and process generations. Use for idle growth, provider WebKit retention, Automerge worker churn, document transport amplification, bulk import, cloud merge, or suspected native and renderer memory regressions. Do not use a slope that crosses restarts, sleep, renderer replacement, or mixed activity states.
disable-model-invocation: true
---

# Memory Profile

Measure comparable generations, not a dramatic line drawn through unrelated processes.

## Define the experiment

1. Record task ID, app version, channel, git SHA, host OS, RAM tier, fixture digest, document bytes, Automerge heads, workload, warmup, sample interval, and target duration.
2. Record native boot ID, app session ID, page load ID, renderer generation, worker generation, and PIDs with process start times.
3. Choose one declared activity state, such as idle, semantic backlog, worker mutation burst, cloud merge, provider cleanup, or batch import.
4. Use the representative document fixture for the target size and history bucket. Do not compare a fresh tiny document with a production-sized history.
5. Define the metric-registry budget and minimum coverage before collecting samples.

## Collect and segment

1. Capture app resident memory, each WebKit process, worker lifecycle events, JS heap when available, native allocations when available, document bytes, queue depth, and operation state.
2. Segment at launch, relaunch, renderer replacement, worker replacement, sleep, wake, network transition, route change, and workload change.
3. Keep disk footprint separate from resident memory.
4. Preserve raw samples and source-health information. Missing heap fields remain missing; do not replace them with zero.
5. Use live provider activity only when it is the approved scenario. Otherwise use offline fixtures. A new provider behavior requires `freed-provider-risk-review`.

## Judge

1. Compare matched build and scenario cohorts. Require enough samples and duration for the registered metric.
2. Use robust summaries such as median, percentile, and median absolute deviation where the registry specifies them.
3. Report peak, settled baseline, growth within one generation, return-to-baseline delay, worker INIT rate, and binary-copy amplification separately.
   For worker lifecycle outcomes, pair `worker-init-rate` with the automatic
   `app-memory-pressure-p95` guardrail. It is the nearest-rank p95 of
   `appMemoryPressureBytes` from dense native samples inside one credited
   app-alive, page-load, and renderer generation. It permits at most 128 MiB of
   growth. Treat it as app-level net pressure, not worker-owned bytes.
4. Return `inconclusive` for mixed states, process identity gaps, insufficient duration, source failure, or noncomparable cohorts.
5. Do not tune watchdog thresholds in response to a memory result.

## Output

Provide the scenario manifest, build and process identities, immutable bounds, coverage, raw sample location, comparison cohort, registered budget, verdict, and largest observed contributors. State what the experiment measured and what it did not measure.

Use kind `memory-profile` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/memory-profile/<task-id>/` and must reference the
raw sample bundle by immutable pointer and digest.
