---
name: freed-evidence-capture
description: Preserve attributable, read-only evidence from a live Freed failure or baseline before changing the system. Use for freezes, crashes, sync stalls, memory growth, provider lifecycle failures, data-loss suspicions, and any rare or stateful incident where logs, process state, build identity, or local data could disappear after restart or repair.
disable-model-invocation: true
---

# Evidence Capture

Preserve the bad state before disturbing it. This skill observes and packages evidence. It does not diagnose by mutation or implement a fix.

## Capture order

1. Record the task or incident ID, current wall time, timezone, host OS, RAM tier, and the user's last observed action.
2. Establish build identity from runtime or artifact evidence: app version, channel, git SHA, native boot ID, app session ID, page load ID, and renderer generation.
3. Record relevant process IDs with process start times. Include the native app, WebKit processes, workers, and child processes. A reused PID without its start time is not an identity.
4. Preserve current logs, crash reports, runtime-health offsets, queue state, pending operation IDs, last-success timestamps, local data sizes, network state, and process resource state that fit the incident.
5. Record exact start and end bounds for every sampled window. Segment evidence at relaunches, renderer replacement, sleep, wake, network transitions, and process-generation changes.
6. Check evidence-source health: missing rotations, offset gaps, parse failures, stalled collectors, clock discontinuities, and app-alive coverage.
7. Cite raw evidence by path plus line, byte offset, event ID, or timestamp. A summary without a resolvable pointer is a lead, not evidence.

## Safety rules

- Stay read-only. Do not restart the app, clear caches, modify local state, trigger a provider, open a provider page, or change code until live evidence is preserved.
- Do not use the application UI when terminal evidence is available. Avoid focus stealing.
- Redact tokens, cookies, authorization headers, message content, and unrelated personal data before attaching evidence to a task or PR.
- Separate disk footprint from resident memory. Do not infer one from the other.
- Do not infer causality. Record observations, timing, and correlations.
- If a live provider action is needed after passive capture, stop and use `freed-provider-risk-review` before changing observable behavior.

## Output

Produce a compact evidence manifest containing identity, immutable bounds, source-health status, process segments, captured artifacts, redactions, and unresolved gaps. Mark the capture `attributable` only when required identity and coverage are present. Otherwise mark it `inconclusive` and list exactly what is missing.

Use kind `evidence-capture` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/evidence-capture/<task-id>/`. Background actors
consume that immutable manifest, never an improvised prose summary.
