# Multi-Desktop dev acceptance

This is the installed test plan for cooperative Primary handoff. A passing build
alone does not establish installed acceptance or readiness to move the owner's
Library. Headless promotion remains separate.

## Record the candidate

Record the dev release tag, source commit, artifact digest and installed version
on each device. Use the matching PWA preview, including its source commit and
origin. A production PWA from a different source is a mixed-version test, not the
matching-candidate baseline. Preserve the existing Library and its supported
backup before starting.

Use two Macs or two separate macOS user accounts for the Desktop installations.
Two copies of the application under one user can share application data and do
not prove independent installations. Use a separate browser profile for the PWA.
Keep provider capture on the existing Primary until the explicit transfer test.

## Join and settle

1. On Desktop A, verify the Primary role, connect Google Drive and use **Sync now**.
   Save **Copy exact Primary receipt** from Settings > Cloud Sync.
2. On a fresh Desktop B, join that existing Library as a consumer. Do not create
   a competing Library. Connect the PWA to the same Library and Drive account.
3. Sync A, B and the PWA until enrollment completes and B reports **Editable
   consumer**. Verify representative feed items, saved items, subscriptions,
   Friends and preferences. Confirm capture remains on A.
4. Make one edit on each consumer and sync through A. Check that all three views
   agree and the consumer queued/published counts settle. Record the checkpoint,
   remote revision and actor identity shown in Settings.

## Compare canonical replicas

After sync settles, open **Library convergence receipt** in each client's Cloud
Sync settings. Choose **Audit this Library**, then **Copy audit receipt**. Keep
all three receipts with the test timestamps. Compare `libraryId`, `authorityEpoch`,
`writerId`, `sourceRevision`, `causalFrontierDigest`, `recordCount` and `itemCount`
inside `audit.snapshot`, plus `audit.checkpointDigest`.

The audit hashes a consistent snapshot of canonical checkpoint records. Pending
optimistic edits, local recovery archives, caches and provider sessions are not
part of that digest. Settle consumer intents before comparing receipts. A later
canonical edit requires new receipts from all clients.

Browser audits start only when the database queue is idle. New Library activity
interrupts an audit at a bounded page boundary so edits and sync can proceed.
Retry after activity settles. Cancellation or deadline failure produces no receipt
and does not establish agreement. Do not disable sync to make divergent receipts
appear comparable. Audits have a 30-second budget. Large Libraries may reach that
limit even while idle; a timeout leaves convergence unverified and must not be
replaced with a matching-count claim.

The copied `interfaceBuild` identifies the loaded interface. Record the installed
native build separately. These receipts do not prove zero consumer capture, Mac
OPFS durability or successful host transition.

## Offline edits and restart

1. Disconnect B and the PWA from the network. Change read, saved, archived and
   liked state on distinct items. Also change a note, a subscription name, a
   Friend field and a synchronized preference.
2. Fully quit and reopen B. Close and reopen the PWA browser profile. Verify the
   edits remain visible and queued before restoring connectivity.
3. Reconnect, sync through A, and verify every edit on all three clients. Repeat
   sync and restart once more. There must be no duplicated event or replacement.
4. Exercise a conflicting assignment from another client. The eventual state
   must converge; local optimistic state is not proof of Primary acceptance.

## Cooperative transfer from A to B

Finish B's pending edits before preparing it. Leave a separate PWA edit offline
to exercise recovery after the epoch changes.

1. On B, open Settings > Cloud Sync > **Primary transfer** and choose **Prepare
   this device as the new Primary**. Copy its readiness receipt and target actor ID.
2. On A, paste both values, confirm the target, and choose **Pause and prepare
   transfer**. Check that capture stops. Before authorization, cancellation may
   resume A only through the signed cancellation path.
3. On A, choose **Publish final checkpoint and authorize move**. Copy the signed
   authorization to B. Once authorized, A must remain fenced, including after a
   restart. Do not try to restore authority by changing local files.
4. On B, choose **Verify and accept authorization**, then **Download final
   checkpoint and stage this Primary**, then **Publish and activate this Primary**.
   A staged target must not capture before publication and verified activation.
5. On A, choose **Verify successor and continue as consumer**. Sync enrollment
   with B and confirm A becomes an editable consumer.
6. Restart both applications. B alone must capture. Make new edits on A and the
   PWA and verify convergence through B.

If a step reports an error or loses its response, reopen the transfer panel and
resume the saved step. Do not start another transfer or delete receipts. An
expired Google Drive token can be reconnected within the transfer panel while
its fence remains in place.

## Recover the old offline edit

Reconnect the PWA after B has activated. Use **Prepare recovery** and the offered
reconnection flow. Confirm the previous signed edit remains in the archive and
was not automatically resent. Review its accepted, rejected or unresolved result.
An unresolved result does not establish that the edit failed.

For an eligible edit, explicitly apply it again through its recovery editor.
Compare archived and current values, visit every member and confirm the new
assignment. A retry after an ambiguous response must reuse the same replacement.
Verify its acceptance through B. Confirm accepted original edits cannot be
reapplied through this recovery action.

After the first transfer settles, repeat the transfer back to A. Verify older
archives remain browsable on both consumers and that no old signed envelope was
rewritten into a new epoch.

## Native background admission evidence

Keep the existing soak collector running for each installed consumer. After
closing provider windows and settling active work, wait for the first native
sample before beginning the measured actions. End the actions before the final
native sample. Preserve native consumer-role and installed-build evidence for
that same interval. A transfer or process restart starts a new interval.

`soak-assert.mjs` now includes
`eventSummaries.nativeProviderAdmissions`. It requires healthy source coverage,
attributable runtime identity, one continuous app-alive segment, and at least
three covered native samples. Each sample brackets its counter and window
observation with timestamps. `windowStart` follows the first observation by one
millisecond; `windowEnd` precedes the last observation. Log append time never
extends these bounds. Acceptance actions must fit entirely inside them. A
positive count can include work at the observation edges; zero applies to the
inner interval.

An available result with `admittedCount: 0` proves no new admission through the
instrumented native provider-command gate during that interval. Every sample
must have stable schema-1 counters from the same gate instance, no active
operations, and no provider windows. Missing or malformed fields, saturation,
counter regression, changed instance identity, duplicate timestamps, or weak
coverage produce `inconclusive`, never an inferred zero. These cumulative
counters can detect completed operations between samples even when an individual
renderer log event is absent.

The gate covers RSS, background article hydration, and native social operations.
Explicit reader article loading and Save URL previews use the foreground URL
path and are outside this count. A count measures admitted commands, not network
requests. The summary does not establish consumer role, installed build identity
on its own, or complete multi-device acceptance. Keep those proofs alongside it.

## Evidence required for acceptance

Record exact build identity and test timestamps. Preserve transfer receipts,
recovery IDs, original and replacement transaction identities, failure messages
and the final Primary checkpoint receipt. Keep full identifiers in private test
evidence; public screenshots use their final eight characters.

Final acceptance also requires measured canonical revision, digest and actor
frontier agreement across the two independent Desktop databases and PWA, plus a
zero consumer background-capture ledger. Matching item counts alone is insufficient.
Crash-boundary, quota and physical Mac OPFS results must be recorded separately;
Linux native tests and mocked browser workflows do not establish those results.

Schema 2 databases must not be downgraded with a predecessor binary. After a
signed transfer, use a compatible build and the saved recovery protocol. A
successful test is the evidence for planning the always-on MacBook Pro move;
this document does not assert that move has occurred.
