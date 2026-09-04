# Delivery, validation, and closeout

## Build in the safe order

Use `freed-build-feature` for worktree and publication mechanics. Within the
Library Core program, prefer this sequence:

1. measurement and budgets;
2. exhaustive field, operation, query, deletion, and locality registries;
3. closed legacy-bootstrap and local-control schemas with pure validation and
   state classification;
4. a dormant atomic creator and adopter bootstrap transaction with readback,
   conflict preservation, and response-loss recovery;
5. dormant native or browser core;
6. one elected immutable resumable migration, bounded device-local source
   contributions, and full-field verification;
7. bounded reads at one revision;
8. exhaustive full-corpus consumer cutover, renderer eviction, and a
   short-lived compatibility engine;
9. dormant replacement replication on Desktop and PWA;
10. one coordinated writer and protocol epoch cutover;
11. installed soak and rollback window;
12. Automerge retirement.

Do not activate a later step because its code exists. Require the preceding
receipt and exact source frontier.

## Validate economically

During implementation, run the smallest deterministic proof for the contract
changed. At the publish checkpoint, run changed-path feature validation.

Blocking Library Core proofs are:

- closed legacy-bootstrap record, prepared-journal, receipt, and local-control
  shapes; exact identity codecs; 1 through 65 sorted unique Automerge heads;
  bounded complete namespace scans; canonical digest recomputation; exact
  source generation, revision, binary, and frontier fencing; bootstrap-frontier
  ancestry; creator versus TOFU read-only adopter classification; partial
  transaction rejection; multiple-record conflict; and response-loss readback
  without regeneration or renewed owner action;
- transaction crash atomicity on every writable Desktop and PWA adapter;
- duplicate operation and response-loss recovery;
- actor enrollment and signature rejection, restore rotation, retirement, fork
  detection, and deterministic repair convergence;
- incomplete and corrupted transaction-member rejection without partial apply;
- future-clock quarantine and certified repair convergence;
- concurrent delete, update, and explicit restore;
- elected migration claim races and response loss, interruption,
  cloud expiry and local non-expiry, operation-grant consumption,
  grant-bound live source attempts across process restart, source-revision
  drift, registration versus candidate-absent abandonment, state-correct
  absent cleanup, dead-claimant abandonment, recovery supersession, persistent
  registered-candidate cleanup sets larger than one page, external-memory
  decode, prepared migration and rollback proofs, valid rollback fences,
  65-fence and 2 MiB finalization boundaries, atomic sidecar publication,
  short fence activation, composite device-local source identity, pinned-root
  native traversal, lookup-plan Cache probes without `Cache.keys()`,
  reader-target identity equality, authoritative reader-content and permanent
  media-vault closure, adapter fixture parity, and bounded checkpoint
  bootstrap;
- global epoch races, same-epoch manifest races, compound authority-state
  compare-and-swap, remote genesis closure, prepared-transition recovery,
  stale-writer fencing, and legacy-namespace isolation;
- cutover, rollback, authority recovery, and concurrent-restore receipts;
- same-revision page and count behavior;
- two-device offline convergence through cloud manifest conflicts;
- authenticated manifest generation, exact branch acknowledgment, and safe
  compaction;
- schema and database-plus-blob snapshot atomicity, including blob crash
  boundaries;
- bidirectional Desktop and PWA encrypted backup and restore vectors, including
  a busy same-transition source that advances during backup construction;
- import idempotency;
- bounded query enforcement and full semantics beyond the legacy 2,500-item cap
  on every supported adapter.

Before the first production release of a new read engine, profile the cold
first result on the owner's largest available corpus. Exercise startup, the
default feed, each common filter transition, search, map, friends, saved, and
one single-row mutation. A bounded page API must return its first bounded page
without scanning or decoding the full corpus first. Audit always-mounted
aggregates, subscriptions, and mutation refreshes for hidden O(n) work and
record the bytes crossing the native-to-renderer boundary. While a row query is
pending, the UI must render that query's loading state. It must never infer an
empty result from stale or absent rows. Long stress matrices remain Tier 4, but
this cold-path admission is part of the feature slice because it proves the
architecture actually serves the product workload it was built for.

For a read cutover, typecheck is also a consumer inventory: removing the
full-corpus state field must expose every remaining reader. Preserve existing
search semantics with parity fixtures or deliberately version the query after
an explicit product decision. A native feed query alone is not a memory
cutover while navigation, settings, search, content fetch, provider-action
derivation, backup, export, or product/UI sync still scans the complete corpus.
The registered short-lived legacy migration and replication bridges may
continue through Gate D until Gate E replaces them; they do not excuse another
full-corpus product reader.

Use `freed-sync-replay` for fault injection and `freed-memory-profile` for
memory admission. Route large fuzz matrices, private-corpus migration,
100,000-item performance, browser permutations, and long slopes to dedicated
or nightly evidence. Do not add them to every PR or release.

## Close the slice

Before publication:

1. Confirm every changed export has a real caller.
2. Confirm no unbounded DTO or whole-document transport was introduced.
3. Record exact head, tree, schema, epoch, source frontier, focused tests,
   runtime, rollback plan, and exact rollback trigger. If this slice executed
   a transition, also record the same-frontier rollback or recovery receipt.
   Dormant code and measurement do not invent a receipt for a transition that
   never occurred.
4. Classify provider-visible paths by behavior. A path-only change with no
   observable provider effect uses the approved `diff_authorized` audit path.
5. Dormant code and measurement may be merge-safe. Any Gate C through Gate H
   dormant-to-active transition is owner-reviewed work. This includes claiming
   or executing a migration candidate, source admission fencing, SQL read
   cutover, legacy-worker or renderer-corpus eviction, an active writer,
   replication protocol, storage epoch, rollback, restore, authority-key
   rotation, recovery transition, installed-soak activation at Gate G, or
   legacy-engine retirement. Stop at an
   owner-reviewed PR and obtain separate release, install, and activation
   authority. Task or merge authority alone never activates one of these
   transitions.
6. Do not append to
   `docs/library-core-activation-manifest.json` for dormant implementation. The
   exact product PR that deliberately makes the next release cross a Gate C
   through Gate H boundary appends one closed transition entry with its stable
   activation ID, rollback trigger, and receipt expectations. Never delete,
   edit, reorder, or reuse an earlier entry. Release tooling derives the exact
   activation delta from this history. It never trusts a handwritten
   `no_activation_declared` assertion.
7. A first `complete_history` release with no previous published boundary must
   set `previousPresent: false`. When a previous boundary exists, a release may
   set `previousPresent: false` only after an exact Git tree lookup at that
   resolved commit proves the activation manifest path is absent. Missing
   objects, invalid refs, wrong object kinds, permission errors, and read
   failures block release validation. After any prior release artifact records
   activation evidence, require `previousPresent: true` and exact digest
   continuity.
