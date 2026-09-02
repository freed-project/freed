# Runtime authority invariants

## Preserve the invariants

1. Keep exactly one active writer epoch. Advance it only with a signed immutable
   transition certificate and one compare-and-swap of the complete cloud
   authority tuple. Local file presence or an incremented number is not
   authority.
2. Acknowledge a mutation only after the operation, rows, tombstones, cursor,
   and outbox commit together.
3. Reuse the same operation ID after timeout or response loss.
4. Derive core-body, transaction, actor-chain, and signature digests in the
   contract's non-circular phases. Desktop and PWA must produce identical
   canonical bytes.
5. Use causal context for later intent and the registered algebra for
   concurrent intent. Do not use SQL order or wall time as the merge contract.
6. Enroll device-local actor keys through the library authority and verify every
   operation signature, sequence, previous-operation link, and chain digest.
   Rotate actor identity only for a new installation incarnation, clone
   recovery, or restore. Preserve it across ordinary app updates. Reject stale
   epochs, retired actors, gaps, forks, unknown schemas, and changed migration
   sources.
7. Preserve forked suffixes as immutable quarantine evidence. Recovery emits
   new signed repair operations with source references. Never rewrite or replay
   the compromised envelopes.
8. Buffer a remote transaction until count, contiguous member indexes,
   signatures, individual digests, and aggregate digest all verify. Never
   materialize or acknowledge a partial transaction.
9. Read migration data from an immutable complete source, never UI state.
10. Return bounded DTOs with one source revision. Never cross a full corpus into
   React, Zustand, or a Web Worker that remains resident.
11. Keep Automerge authoritative until both Desktop and PWA can use the
   replacement replication epoch.
12. Fence every retired epoch through epoch-bound operation and manifest
    authentication. Treat old-client uploads and late writes as explicit orphan
    recovery input, never active authority.
13. Authenticate manifests and preserve branch-qualified actor tips. Never
    sequence-max incompatible forks for sync, acknowledgment, or compaction.
14. Roll back only from a receipt at the same frontier. Otherwise roll forward.
15. Make external blobs durable before an authoritative database reference,
    replicate and verify them before applying a referencing transaction, and
    snapshot the database plus its pinned reachable blob set at one frontier.
16. Keep provider traffic off during development. The first slice capable of
    turning a memory-rejected provider attempt into real provider contact is
    provider-observable. The owner approved the exact effect of existing
    scheduled Facebook and Instagram pulls succeeding after memory relief in
    `codex-task:019f4ce3-2ee3-76b2-bc0c-eb7f4958a7de`, with the statement "You
    are fully authorized to continue this optimization in ways which will
    increase provider pull frequency by fixing cases where we were previously
    unable to pull." The provider can therefore observe successful contact where memory
    rejection previously produced none. The lowest-profile alternative is to
    preserve the memory rejection and leave that data unsynced. This decision
    does not expire while the existing schedule, retry policy, requests,
    navigation, cookies, headers, and extraction behavior remain unchanged.
    Cite that exact decision and write and validate its healthy artifact before
    publishing the first active slice. Do not ask the owner to approve the same
    behavior again. Dormant storage work remains provider-free. Cadence,
    request, navigation, cookie, header, or extractor changes require their own
    decision.
17. Keep cloud replication and provider-action outboxes separate. A remote
    library operation never directly triggers provider activity.
18. Advance materializer work by local ingest sequence, not HLC.
19. Commit materialized state through the canonical persistent Merkle Patricia
    trie. Update only touched leaves and ancestor paths in ordinary writes and
    migration batches. Never rehash the complete corpus per transaction.
