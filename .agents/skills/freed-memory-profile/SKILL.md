---
name: freed-memory-profile
description: Measure Freed memory demand with matched builds, workloads, document fixtures, and process generations. Use for idle growth, provider WebKit retention, Automerge worker churn, document transport amplification, bulk import, cloud merge, or suspected native and renderer memory regressions. Do not use a slope that crosses restarts, sleep, renderer replacement, or mixed activity states.
disable-model-invocation: true
---

# Memory Profile

Measure comparable generations, not a dramatic line drawn through unrelated processes.

## Define the experiment

1. Record task ID, app version, channel, git SHA, host OS, RAM tier, fixture
   digest, document bytes, workload, warmup, sample interval, and target
   duration. For the legacy engine record exact Automerge heads. For Library
   Core record the storage epoch, epoch ID, and frontier digest instead.
2. Record native boot ID, native PID and start time, app session ID, page load ID, renderer generation, worker generation, and every measured PID with its process start time. A PID without a start time is not a process identity.
3. Choose one declared activity state, such as idle, semantic backlog, worker mutation burst, cloud merge, provider cleanup, or batch import.
4. Use the representative document fixture for the target size and history bucket. Do not compare a fresh tiny document with a production-sized history.
5. Define the metric-registry budget and minimum coverage before collecting samples.
6. For Library Core work, also record storage engine, active epoch, schema version, source frontier digest, SQLite cache and mmap limits, query shape, result limit, and whether a legacy compatibility worker is resident.

## Collect and segment

1. Capture app resident memory, each WebKit process, worker lifecycle events, JS heap when available, native allocations when available, document bytes, queue depth, and operation state.
2. Segment at launch, relaunch, renderer replacement, worker replacement, sleep, wake, network transition, route change, and workload change.
3. Keep disk footprint separate from resident memory.
4. Preserve raw samples and source-health information. Missing heap fields remain missing; do not replace them with zero.
5. Use live provider activity only when it is the approved scenario. Otherwise use offline fixtures. A new provider behavior requires `freed-provider-risk-review`.
6. A baseline and later sample inside one slope or hydrated-delta segment are
   comparable only when the exact process identity survives. Age matching,
   label matching, or one plausible WebKit candidate is not enough. A
   cross-build comparison uses two separate internally coherent process
   cohorts matched by fixture, workload, boundaries, and measurement source.
   It never requires one PID to survive across builds.
7. Startup instrumentation must not delay initialization. Cross an explicit
   scheduler boundary before measurement work, or use a native background
   snapshot whose caller path is already bounded. Merely ignoring an async
   return value is insufficient because work before its first `await` still
   blocks the caller. Keep serialization, process enumeration, and other O(n)
   work out of the startup turn. Mark hydration boundaries explicitly and
   report a missing early baseline as inconclusive.

## Library Core budgets

Read the current budgets directly from
[LIBRARY-CORE-CONTRACT.md](../../../docs/LIBRARY-CORE-CONTRACT.md) unless the
task registers a stricter one.

The contract is the sole authority for host tiers, startup peak, settled
process-tree total, renderer and native components, temporary worker, SQLite
cache, provider extraction, idle slope, heavy-operation recovery, and query
budgets. Do not copy those numbers into this skill or a task prompt. Record the
exact contract revision with every result.

These are architecture admission budgets, not a reason to falsify a sample or
raise a watchdog. If a supported device cannot meet one, identify the measured
owner and change the architecture or register a reviewed budget revision.

## Judge

1. Compare matched build and scenario cohorts. Each cohort must be internally
   generation-coherent. Require enough samples and duration for the registered
   metric.
2. Use distribution summaries such as median, percentile, and median absolute deviation where the registry specifies them.
3. Report peak, settled baseline, growth within one generation, return-to-baseline delay, worker INIT rate, and binary-copy amplification separately.
   For worker lifecycle outcomes, pair `worker-init-rate` with the automatic
   `app-memory-pressure-p95` guardrail. It is the nearest-rank p95 of
   `appMemoryPressureBytes` from dense native samples inside one credited
   app-alive, page-load, and renderer generation. It permits at most 128 MiB of
   growth. Treat it as app-level net pressure, not worker-owned bytes.
4. Return `inconclusive` for mixed states, process identity gaps, insufficient duration, source failure, or noncomparable cohorts.
5. Do not tune watchdog thresholds in response to a memory result.
6. Separate shell baseline, hydrated library delta, query-window delta,
   compatibility-worker peak, provider-WebView peak, and return-to-baseline.
   Do not call their sum exact when lifetimes overlap.
7. A memory improvement is incomplete if it merely moves an unbounded corpus
   from one WebKit process to another.

## Output

Provide the scenario manifest, build and process identities, storage epoch and
frontier where applicable, immutable bounds, coverage, raw sample location,
comparison cohort, registered budget, verdict, and largest observed
contributors. State what the experiment measured and what it did not measure.

Use kind `memory-profile` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/memory-profile/<task-id>/` and must reference the
raw sample bundle by immutable pointer and digest.
