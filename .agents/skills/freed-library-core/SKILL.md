---
name: freed-library-core
description: Build or migrate Freed's bounded-memory Library Core across Desktop and PWA. Use for native SQLite storage, browser row storage, operation journals, causal merge rules, tombstones, bounded queries, Automerge migration, storage-epoch cutover, rollback, snapshots, imports, operation-segment sync, renderer corpus eviction, or any change that can alter durable library authority.
---

# Library Core

Treat storage authority as product behavior. Read
[LIBRARY-CORE-CONTRACT.md](../../../docs/LIBRARY-CORE-CONTRACT.md) before
designing or editing a Library Core slice.

## Declare the slice

Record:

- active engine, storage epoch, schema version, and replication protocol before
  and after the change;
- current global epoch-transition certificate, authority key ID, and exact
  compound cloud authority tuple, including manifest authentication,
  generation, recovery capability, spent-redemption, and migration-claim
  fields;
- immutable source revision and frontier;
- actor enrollment, signature, chain, and transaction-completeness rules;
- operation and field-algebra entries affected;
- bounded query or migration receipt affected;
- rollback input and exact rollback condition;
- memory and latency budgets;
- focused fault boundary;
- whether provider-observable behavior changes.

If any item is unknown, inspect the current implementation. Do not invent a
placeholder authority or a temporary second writer.

## Read the applicable contract

Read every reference whose trigger matches before designing or editing. A slice
may cross several modes, so use every matching reference.

- For legacy epoch bootstrap, creator and adopter control, IndexedDB legacy
  saves, ancestry, recovery, or bootstrap retries, read
  [bootstrap-and-legacy-control.md](references/bootstrap-and-legacy-control.md).
- For Gate A registries, authoritative SQLite, browser row storage, derived
  projections, shadow rebuilds, generation publication, or dormant readers,
  read
  [dormant-census-and-shadow-stores.md](references/dormant-census-and-shadow-stores.md).
- For canonical values, digests, signed transactions, actor enrollment, native
  verification, authoritative journaling, or replication outboxes, read
  [canonical-operations-and-enrollment.md](references/canonical-operations-and-enrollment.md).
- For active readers, writers, replication, materialization, provider effects,
  blobs, rollback, or any data-authority change, read
  [runtime-authority-invariants.md](references/runtime-authority-invariants.md).
- For Gate C through Gate H migration, candidate claims, operation grants,
  source fences, external-memory decoding, reader targets, backups, cleanup,
  recovery, cutover, or Automerge retirement, read
  [migration-cutover-and-recovery.md](references/migration-cutover-and-recovery.md).
- For sequencing, tests, performance admission, publication, release,
  activation, or handoff, read
  [delivery-validation-and-closeout.md](references/delivery-validation-and-closeout.md).

Do not load unrelated references merely because the skill is active. Do not
skip a matching reference to save context.

## Always-on authority boundaries

- Keep exactly one active writer epoch. A local file, schema, registry entry,
  synchronized value, incremented number, or compiled module does not create
  authority.
- Acknowledge a mutation only after its operation, rows, tombstones, cursor,
  and outbox commit atomically. Retries after timeout or response loss reuse
  the exact operation ID and read back the durable result.
- Fail closed on incomplete, conflicting, future, oversized, or unsupported
  state. Preserve evidence. Never repair ambiguity by selecting a plausible
  winner, deleting a fork, guessing an epoch, or creating a temporary writer.
- Keep all interfaces bounded. Do not move a full corpus into React, Zustand,
  or a resident Web Worker. Gate C migration must use bounded external-memory
  decoding and must not call `Automerge.load` or retain a source-sized change
  graph.
- Dormant means no production caller, command registration, startup database
  open, backfill, read route, writer route, authority receipt, network action,
  or activation-manifest transition. Code presence never advances a gate.
- Keep provider traffic off during development. Any slice that can turn a
  memory-rejected Facebook or Instagram attempt into real contact must read
  the exact approved behavior and limits in the runtime authority reference.
  A cadence, request, navigation, cookie, header, extractor, or provider set
  change requires its own decision before code.
- Keep cloud-replication and provider-action outboxes separate. A remote
  library operation never directly triggers provider activity.
- Roll back only from a receipt at the same frontier. Otherwise roll forward.
  Never activate a cutover without its exact rollback or recovery evidence.
- Any Gate C through Gate H dormant-to-active transition stops at an
  owner-reviewed pull request. Task or merge authority alone never activates a
  migration candidate, source fence, reader cutover, renderer eviction, writer,
  replication epoch, rollback, restore, authority rotation, soak activation,
  or legacy retirement. Obtain the separate release, installation, and
  activation authority required by the delivery reference.
- Do not append to
  `docs/library-core-activation-manifest.json` for dormant work. Only the
  product pull request that deliberately crosses a gate appends one immutable,
  closed transition entry.

## Execute the slice

1. Confirm the current authority facts and blockers from code, registries,
   receipts, and the activation manifest.
2. Read the matching references and implement the smallest complete slice.
   Keep unresolved authority typed as blocked.
3. Prove the changed contract with the smallest deterministic focused test.
   Use dormant fixtures and synthetic sources unless the applicable gate
   explicitly authorizes more.
4. Before publication, read the delivery reference and run changed-path feature
   validation. Confirm every changed export has a real caller, no unbounded
   transport was introduced, and rollback evidence matches the exact frontier.
5. Use `freed-build-feature` for worktree and publication mechanics. Use
   `freed-sync-replay` for fault injection and `freed-memory-profile` for
   memory admission when those proofs apply.
