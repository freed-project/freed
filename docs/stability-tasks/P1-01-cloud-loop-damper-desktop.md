# P1-01: Break the desktop cloud upload loop

runner-safe: false | provider-visible: false | soak-gated: YES (land alone, one soak cycle)
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
- Soak (idle overnight, GDrive connected): uploads/hour with headsUnchanged=true drops from the P0-03 baseline (hundreds) to ~single digits; idle WebKit footprint slope flattens vs baseline soak.
