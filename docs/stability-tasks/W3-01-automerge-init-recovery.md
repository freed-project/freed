# W3-01: Preserve Automerge data during INIT recovery

runner-safe: false | provider-visible: false | soak-gated: YES

Finding: an Automerge worker crash, timeout, or post-load initialization error
could be treated like a corrupt local document. The main thread caught every
INIT failure, cleared IndexedDB, and retried from an empty document. A healthy
local library could therefore be lost because the worker failed for an
unrelated reason.

## Behavior

1. On Freed Desktop, track every pending INIT request and fail it after the
   existing 180 second worker request timeout.
2. On Freed Desktop, reset the failed worker generation, reject its pending
   requests, and ignore late messages from the old generation.
3. On Freed Desktop and the PWA, never clear local data in response to a worker
   crash, timeout, migration failure, compaction failure, or generic INIT
   acknowledgement error.
4. Retry one transient IndexedDB load failure before rejecting INIT.
5. When `A.load` itself proves the stored binary is corrupt, atomically preserve
   the exact bytes under the IndexedDB recovery key and delete the live key in
   one committed transaction before creating a fresh document.
6. Record `worker_init_recovery` with the confirmed reason, recovery action, and
   preserved byte count. Freed Desktop writes runtime health. The PWA writes its
   durable worker debug stream.

This slice does not change worker idle timing, cloud scheduling, provider
requests, WebView behavior, or Automerge document contents during a successful
load.

## Verification

- Freed Desktop lifecycle tests prove that INIT timeout and crash reject without
  issuing `CLEAR_LOCAL`.
- PWA tests prove that a generic INIT failure rejects without issuing
  `CLEAR_LOCAL`.
- Lifecycle tests prove that a generic INIT response error also rejects without
  clearing local data.
- Real worker tests prove that an invalid Automerge binary is copied and the
  live key is deleted by one transaction before a valid fresh document is
  created.
- Worker tests prove one transient IndexedDB load failure is retried without
  clearing or replacing data.
- Stale worker messages cannot mutate current renderer state or terminate the
  replacement generation.
- Focused worker lifecycle, integration, and memory contract tests pass.

## Installed-build acceptance

Land this before the measurement build used as the W5-01 baseline. It is the
only behavioral change assigned to that installed soak. PR 949 and the approved
native runtime identity envelope must be present before the soak begins.

Run at least six credited app-alive hours with a closed, healthy schema 3
verdict. Normal operation should record no `worker_init_recovery` and no
`worker_runtime_failed` event with phase `runtime_init_timeout`. If a corrupt
document is encountered, the recovery event must report a positive preserved
byte count and the recovery copy must remain in IndexedDB.

The resulting build and verdict may become the frozen W5-01 baseline because
they contain W3-01 but do not contain the 30 second worker quiet window.
