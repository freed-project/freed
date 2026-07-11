# P1-01: Break the desktop cloud upload loop

runner-safe: false | provider-visible: true (changes Google Drive contact frequency from Desktop sync) | soak-gated: YES (one global behavior slot until its installed-build outcome completes)
Findings: F01, F06 (sev-5). Prereq: P0-03 counters live with a pathological baseline recorded.

## Defect

Desktop cloud sync is a self-sustaining loop: after every safe upload the caller merges the uploaded binary back (`packages/desktop/src/lib/sync.ts` ~1486-1489); MERGE_DOC unconditionally emits STATE_UPDATE; the subscriber at `sync.ts` ~1302-1304 schedules an upload on EVERY state event with no filtering on `event.mutation`. Upload→merge→state-update→upload, forever, independent of user activity.

## Change

1. In the `sync.ts` ~1302 subscriber, skip `scheduleCloudUpload` when `event.mutation` is `MERGE_DOC`/`REPLACE_DOC` (the mutation tag already arrives on desktop per `automerge.ts` ~301-309).
2. Belt-and-suspenders: record `A.getHeads()` (via the P0-03 heads accessor) at last successful upload; skip scheduling when heads are unchanged. Note: a genuine merge that changed local state produces new heads and must still upload — cover this case in tests explicitly.

## Blast radius

Desktop cloud scheduling only. Worst failure: a missed upload, bounded by the next genuine local mutation.

## Verify

- Unit tests: MERGE_DOC event does not schedule; local mutation does; merge-that-changes-heads does.
- Installed-build soak with GDrive connected: after the separately approved `cloud_sync_coverage` emitter lands, unchanged-head upload rates use only verified cloud-eligible time and fall below the registered target. Until then, raw counts are descriptive and the cloud-rate outcome remains `inconclusive`.

## Implementation notes (2026-07-08 build)

- Subscriber filter is heads-qualified, not unconditional: MERGE_DOC/REPLACE_DOC events schedule only when heads moved past the last successful upload — this is how "a genuine merge must still upload" and "the merge-back echo must not" coexist.
- Post-upload heads are recorded AFTER the safe-upload merge-back settles, so the recorded heads are exactly the state the cloud holds and the echo event compares equal.
- Execution-time re-check inside performCloudUpload (cause=subscriber only) closes the debounce race where the echo event arms the timer before the post-upload record lands. Manual "Sync now" and authoritative replaces always upload.
- Invalidation: deleteCloudFile and an empty initial download clear the recorded heads so a reconnect can never be suppressed into leaving the cloud empty.
- New runtime-health counter `cloud_upload_skipped` (reason: merge_heads_unchanged | execution_heads_unchanged): a healthy damper shows skips replacing unchanged-heads attempts; zero attempts AND zero skips would mean sync is broken, not damped.
- Frozen pre-damper raw observation (`soaks/2026-07-08-0202`): 98 of 102 attempts had unchanged heads and the cloud_loop alarm fired 7 times. Its wall-time rate is not a valid cloud-eligible baseline. Re-verification must use the approved bounded coverage emitter, exact build identity, and a healthy evidence window.
