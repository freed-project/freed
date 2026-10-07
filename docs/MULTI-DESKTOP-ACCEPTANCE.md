# Multi-Desktop dev acceptance

This is the installed test plan for cooperative Primary handoff. A passing build
alone does not establish installed acceptance or readiness to move the owner's
Library. Headless promotion remains separate.

The editable-consumer scenarios below do not establish a read-only viewer.
If the intended destination is one Primary and one strict viewer, also complete
the [strict viewer gate](#strict-viewer-gate). The current editable-consumer
role and shared UI demo mode do not supply that enforcement.

## Select the acceptance build

Ordinary dev and production builds deliberately disable Primary transfer and
consumer recovery until installed convergence acceptance is complete. Their
join and same-epoch edit paths can be tested, but they cannot complete the
transfer steps below. An unavailable transfer control is expected in those builds.

Dev releases can include the separately named
`Freed-Transfer-Acceptance_<version>_aarch64.app.tar.gz`. Its release job verifies
Apple signing, notarization and the acceptance bundle identifier before
publication. Select this artifact explicitly; `Freed_Preview` and ordinary
Freed Desktop downloads retain the transfer hold. The acceptance app has no
updater endpoint and is excluded from the ordinary updater asset selection.
A successful workflow proves packaging, not installed transfer acceptance.

Deploy the matching PWA from the same clean source with
`./scripts/vercel-deploy-preview.sh pwa-transfer-acceptance`. This explicit
preview mode stages committed files only, stamps the exact source identity,
builds with the transfer-acceptance mode, and checks that the existing Vercel
preview environment contains its Google web client and matching server
credentials. It uses the existing approved Vercel preview OAuth relay through
`app.freed.wtf`; it does not register a new Google callback or deploy production.
Credential presence does not prove a successful OAuth exchange. Verify sign-in
on the resulting dedicated preview origin and use a separate browser profile.
Do not substitute the production PWA for a matching test candidate. Acceptance
previews retain normal onboarding and Library selection, with automatic sample
population disabled. A fresh profile must not create a sample Library on its own;
after joining, restarting must reopen that Library without reseeding it.

For isolated workflow acceptance, build both clients from the same reviewed,
clean source. Verify `git status --short` is empty, then set the existing build
metadata in the shell used for both commands. Local builds do not infer these
values from Git:

```sh
export FREED_BUILD_KIND=preview
export FREED_BUILD_CHANNEL=dev
export FREED_BUILD_COMMIT_SHA="$(git rev-parse HEAD)"
export FREED_BUILD_COMMIT_REF="$(git branch --show-current)"
```

From `packages/desktop`, run
`npm run tauri:build:transfer-acceptance -- --bundles app` on macOS. The named
configuration enables the frontend acceptance mode and native transfer feature,
uses application identifier `wtf.freed.desktop.preview.transfer-acceptance`,
disables updater endpoints and omits updater artifacts. The native feature also
requires the isolated preview data root. This local app is not a signed dev
release or evidence that the ordinary release has enabled transfer.

From `packages/pwa`, run `npm run build:transfer-acceptance`. Serve the resulting
build through the task's approved preview service on a dedicated test origin and
browser profile. Do not deploy this build to the production PWA origin. Record
both source identities and the acceptance commands with the artifact digests.
A frontend acceptance mode alone cannot enable the native lifecycle.

Use separate macOS user accounts or separate Macs even for the isolated app:
preview builds share a preview keyring service within one user. Create and join
a synthetic test Library first. Do not copy an existing installation's private
keys, database or provider sessions into these test identities. Transferring the
owner's actual Library remains a later, separately evidenced operation. After
isolated acceptance, a reviewed release must explicitly address the ordinary
build's hold before claiming the signed release supports transfer.

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

On the persistent PWA backend, audits stream one ordered SQLite statement and
spill sort data to OPFS temporary files with a bounded cache. The statement closes
on completion or failure, and prior connection settings are restored. An audit
refuses to change temporary-storage settings if temporary tables or triggers
already exist. Insufficient temporary-file capacity returns no receipt. Memory-only
demo and test backends retain bounded paging because their temporary files can
still reside in memory.

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

## Strict viewer gate

This gate specifies additional acceptance requirements. It does not assert
that a persistent native viewer mode is implemented or released. Record the
exact candidate that supplies it before attempting these scenarios. An
editable-consumer badge, hidden controls or a disabled mark-read preference
cannot satisfy the gate.

A strict viewer permits inbound synchronization, browsing and installation-local
cache writes. It must not sign or enqueue new Library edits, publish pending
edit intents, reapply archived edits, capture provider content or publish as
Primary. Automatic read and seen assignments count as edits. Synchronized
preferences are Library edits; installation-local presentation state is separate.

### Establish the restriction

1. Use synthetic data and independent installation identities. Record native and
   frontend source, Library, epoch, actor and writer identities before the change.
2. Establish what happens to unresolved or in-flight edits before confirming
   viewer mode. Preserve their original bytes and honest outcome. The transition
   must either refuse until settlement or provide an explicit, durable recovery
   disposition. It must never discard edits or later upload them silently.
3. Exercise an edit upload already in progress, including a lost response.
   Viewer readiness requires that upload to finish or its ambiguous result to
   resolve through the existing protocol. Cancelling a local promise is not proof
   that the remote request was cancelled.
4. Record a durable native policy receipt and the completed transport drain.
   From that checkpoint onward, no local Library edit may be signed, queued or
   uploaded. A renderer setting cannot grant edit admission.
5. For a transferred source, retain its existing source fence until successor
   verification and viewer policy are durably committed. Resume from a crash
   before and after this boundary. There must be no intermediate editable
   consumer state, including during reenrollment and response-loss recovery.

### Exercise native and interface boundaries

With the viewer online and then offline, attempt read, saved, archived and liked
assignments, notes and highlights, subscriptions, Friends and synchronized
preferences. Include keyboard shortcuts, command palette actions, bulk actions
and recovery editors. Repeat through direct native command fixtures with stale
renderer state. Each fresh edit must be refused before signing or persistence;
no actor counter, intent, optimistic effect or recovery replacement may appear.
Reading an existing durable retry receipt is not a fresh edit.

Scroll through unread items, open and close their readers, navigate between
items, wait for delayed read-mark batches, and suspend and resume the app.
Verify that automatic read/seen paths create no edit. A provider-admission
counter alone cannot prove this: read-state intents can exist without a provider
command being admitted.

Make representative changes on the Primary and sync them into the viewer.
Verify bounded browsing, local cached content and canonical convergence still
work. Local cache activity must not become a synchronized Library mutation.
Keep provider-admission evidence separate and attributed to this viewer interval.

### Restart, checkpoint and predecessor proof

Fully quit and reopen the viewer before reconnecting it. Replace its checkpoint
through the supported same-Library sync flow and exercise explicit successor
adoption in an isolated transfer scenario. Native viewer policy must survive
both operations without entering logical checkpoint records or restricting
another installation.

On an isolated copy of a synthetic fixture, attempt to reopen the restricted
installation with the predecessor binary. It must refuse before modifying the
database or creating an edit. Do not use the owner's Library for this test and
do not treat a source-level version check as installed predecessor proof.

Preserve policy and transport receipts, bounded edit-ledger evidence, native
refusals, build identities and observation intervals. Missing coverage is
inconclusive. A passing editable-consumer suite or zero provider admissions
does not replace these results.

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
