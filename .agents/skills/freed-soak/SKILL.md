---
name: freed-soak
description: Run and judge an installed-build soak of Freed Desktop from terminal evidence. Use for release observation, overnight stability windows, or post-change verification. Require the canonical release-verifier lease, the exclusive collector session lock, event-derived build identity, immutable time bounds, source-health checks, comparable process generations, and explicit inconclusive results when identity or coverage is insufficient.
disable-model-invocation: true
---

# Soak

Observe one installed build under one declared scenario. Follow [docs/SOAK-AND-TRIGGERS.md](../../../docs/SOAK-AND-TRIGGERS.md) when it is more specific.

## Start an attributable session

1. Record the canonical task ID, behavior under test, metric IDs, required
   scenario, target duration, minimum coverage, and allowed authority. Require
   the task to already be in `soaking`. An authorized lifecycle actor must
   complete `installed` to `soaking` before this workflow starts.
2. Require the trusted host launcher to have acquired the canonical
   `release-verifier` lease. Use only its short-lived
   `FREED_AUTOMATION_LEASE_TOKEN` for verdict mutations. Never request or
   receive the persistent actor credential. The verifier cannot transition
   `installed` to `soaking`. The control-plane lease is the verdict writer
   boundary. The collector separately acquires the exclusive
   `<pointer>.collector-lock`, rejects a live owner, recovers a stale owner, and
   releases only its own token. Do not bypass that lock or let two behavioral
   verification cycles share one active pointer.
3. Verify the installed app's version, channel, git SHA, and app session from runtime-health event identity. Record the collector session, page load ID, renderer generation, relevant PIDs with process start times, host OS, RAM tier, provider cohort, and document-size bucket.
4. Launch with `open -g /Applications/Freed.app` only when needed. Never steal focus for routine observation.
5. Start the collector with an immutable comparison context:

   ```bash
   node scripts/soak-collect.mjs --detach \
     --scenario <scenario> \
     --provider-cohort <provider-auth-pause-and-cloud-state> \
     --document-size-bucket <bucket> \
     --artifact-digest <installed-artifact-sha256>
   ```

   Omit `--artifact-digest` only when no installed artifact digest exists. The
   three workload flags are required together for measured lifecycle outcomes.
   They and the detected host context are written once at collector start and
   cannot be relabeled later. Record immutable start bounds and keep raw
   evidence append-only. The schema 3 collector declares its collector-event
   capability with event schema 2 and creates an empty current event file at
   session start. Its event stream must contain balanced collector session
   start and stop records in addition to any sample failure and recovery pairs.
   An older soak or collector remains analytical `inconclusive`. Never add the
   declaration after the fact or relabel that older session as schema 3.

6. Write the scenario and connection state from local evidence. Do not infer provider or cloud state from an unopened UI.

## Run the window

1. Preserve one global behavioral product change until its installed-build soak outcome completes. A different task or exclusivity key does not create another slot.
2. Use `scripts/dev-sync-trigger.mjs` only under its existing gate. Any new cadence, navigation, request, cookie, header, retry, or WebView behavior requires a separate `freed-provider-risk-review` approval first.
3. Check source health periodically: app and collector liveness, sample growth,
   parse failures, `collector-events.jsonl` session and sample-outage records,
   offset gaps, pair-preserving rotation, and app-alive coverage. A recovered
   collector exception does not make the window healthy by itself. The
   source-health verdict still owns that decision.
4. Record relaunch, sleep, wake, network transitions, renderer replacement, and process-generation changes. Do not calculate one memory slope across those boundaries.
5. Treat app death as evidence. Relaunch only when the scenario allows it, and begin a new attributable session segment.
6. Do not tune watchdogs, alter the product, or repair the measured build mid-window.

## Judge and close

1. End the session with an immutable timestamp before moving any latest-session pointer.
2. Stop only the lock-owned collector and wait for its lock to clear. Freeze
   metrics and both collector-event files before hashing them. Confirm the
   final collector session has a durable stop record. Do not stop another
   task's collector.
3. Run `node scripts/soak-assert.mjs` against the exact session directory and bounds.
4. Judge metrics through the versioned registry. Verify event predicates, denominators, minimum exposures, and source coverage before accepting pass or fail.
5. Return a raw analysis of `inconclusive` for mixed builds, missing identity,
   broken sources, insufficient duration, insufficient exposure, or a scenario
   that did not occur. Preserve the raw verdict even when it cannot become a
   lifecycle outcome.
6. A verdict covers only events at or before its end time. It may never suppress a later alarm.
7. Stop the wake lock owned by this session. Do not stop another task's processes.
8. Record build identity, bounds, coverage, process segments, trigger history, assertion table, and raw evidence pointers in the verification task.
9. If the source coverage is healthy, create the build-bounded canary context
   with `scripts/canary-context.mjs`. It rebuilds the soak verdict from the raw
   session and copies the stored workload and host context. Then run
   `scripts/canary-summarize.mjs --collector-metrics
<soak-dir>/metrics.tsv`. Preserve and commit the canary JSON record, its
   runtime-health JSONL sidecar, collector-metrics TSV sidecar, and
   collector-events JSONL sidecar as one portable bundle. Never reconstruct an
   earlier window from whichever build happens to be installed later.
10. Treat `soak-assert.mjs` output as raw evidence, not a lifecycle decision.
    Build the exact task-bound contract with
    `scripts/build-outcome-verdict.mjs`, including the hashed baseline
    raw soak verdict and one registered metric ID. The converter rebuilds both
    verdicts from stored collector artifacts and derives the values, unit,
    direction, and tolerance from the metric registry. Then call
    `scripts/record-outcome.mjs` with the generated verdict and the matching
    evidence window. Never supply effect values by hand. The task's installed
    version, full commit SHA, channel, optional artifact digest, and soak start
    must match the
    verdict window. A lifecycle `inconclusive` is recordable only when the raw
    window is nonempty, attributable to that installed build, and carries a
    complete composite fingerprint with capability-declared, present, closed,
    and well-formed collector-event evidence. If missing or mixed identity, an
    empty window, a legacy collector, an open collector outage, or broken
    capture prevents that contract, leave the task in `soaking`, preserve the
    analytical verdict, repair collection, and retry. Do not fabricate task
    attribution to release the behavior slot.
