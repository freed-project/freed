---
name: freed-sync-replay
description: Reproduce Freed sync and provider-lifecycle failures with deterministic offline fixtures and fault injection. Use for Automerge worker, cloud merge, relay, scheduler, capture journal, timeout, retry, crash, wake, duplicate delivery, or corruption scenarios that should be tested without live provider traffic. Stop before any real provider navigation, request, cookie access, or cadence change.
disable-model-invocation: true
---

# Sync Replay

Turn a failure into a repeatable offline scenario. Use recorded, sanitized inputs and local mocks. Do not contact a social provider.

## Define the replay

1. Record the task ID, code SHA, fixture schema and digest, initial Automerge heads, document-size bucket, runtime configuration, random seed, and expected invariants.
2. Sanitize provider data. Remove credentials, cookies, headers, message content, and unrelated personal fields.
3. Define fault events with logical sequence numbers, not wall-clock luck. Include the exact transition where each fault occurs.
4. Select the smallest boundary that reproduces the failure: pure package test, real Worker harness, Tauri mock, relay fixture, cloud adapter fixture, or native social-runtime harness.

## Useful scenarios

- A scheduler timeout whose underlying operation later settles
- Renderer death after a capture batch is journaled but before frontend acknowledgement
- Duplicate or out-of-order batch replay
- Cloud self-write and no-op merge
- Relay reconnect, self echo, and generation replacement
- Offline, wake, and network-readiness transitions
- Transient worker initialization failure versus confirmed corrupt binary
- Concurrent trigger coalescing and per-provider single flight

## Invariants

Assert durable behavior, including:

- No acknowledged or journaled item is lost
- Replay is idempotent under stable item IDs
- Scheduler ownership remains held until settlement or acknowledged cancellation
- A timed-out operation cannot overlap a second provider operation
- Transient initialization failure does not clear the local document
- One seed and fixture produce one ordered event trace
- Every observed transition carries task, operation, build, and generation identity

## Close out

Run the focused replay repeatedly with the same seed and compare traces. Record fixture digest, seed, command, result, runtime, and first divergent event. If offline fixtures cannot reproduce the issue, return `inconclusive` and hand passive collection to `freed-evidence-capture`. If live provider behavior is proposed, stop and use `freed-provider-risk-review`.

## Output

Use kind `sync-replay` in the version 1 [stability artifact
schema](../../../automation/artifact-schemas/stability-artifact-v1.schema.json).
Validate and atomically store it with `node scripts/stability-artifact.mjs write
--input <manifest.json>`. The canonical result lives under
`~/.freed/automation/artifacts/sync-replay/<task-id>/`. The fixture digest,
seed, command, invariant results, and first divergent event are required even
when the result is `inconclusive`.
