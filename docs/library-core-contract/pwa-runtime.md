## 12. PWA and iPhone behavior

The PWA SQLite worker serializes database access and owns one OPFS database
generation. Interface tabs communicate through bounded messages. Worker loss,
suspension, tab replacement, and process eviction reopen the accepted database
generation and replay only durable local intents. Checkpoint activation sends
closed, monotonic record progress at bounded intervals. Verified progress renews
a 30-second worker stall budget for queued commands; every request retains a
ten-minute total cap. Progress never acknowledges an accepted checkpoint.

The single-connection SAH pool must report no other reserved writer before the
first database read. Its exclusive access handles and origin ownership remain
held during recovery, allowing SQLite to replay a hot rollback journal after
worker termination. Integrity checks run after SQLite recovery. No recovery
path deletes a journal, ignores integrity errors, or selects partial staging.

The supported iPhone floor must prove:

- creation and reopening on the supported iOS and Safari versions
- suspension and termination recovery
- checkpoint staging and atomic activation
- intent durability and result reconciliation
- quota refusal without accepted-state loss
- content streaming, partial caching, complete pinning, and eviction
- offline playback of a verified pinned rendition
- factory reset fencing across open tabs

If OPFS or the required SQLite persistence primitive is unavailable, the PWA
reports an unsupported storage capability. It does not fall back to Library
rows in IndexedDB.

The explicitly selected anonymous demo is not a persistent Library. Each demo
document owns an isolated in-memory SQLite database seeded from the curated
checkpoint. Its worker never opens the OPFS database or content vault and does
not acquire the persistent Library's origin-wide lock. This is not an OPFS
failure fallback: ordinary app workers retain persistent storage and exclusion
even when a caller supplies a demo-like query on the app hostname. Schema,
checkpoint parsing, bounded queries, and worker message validation are unchanged.

The demo may simulate care edits by regenerating its fixed, at-most-1,000-entry
fixture and activating a validated replacement checkpoint in that same memory
database. The session retains only care overrides and the original timeline
seed, not a resident Library copy. This path has no durable writer, follower
intent, OPFS write, schema change, or synchronization side effect. Checkpoint
digests continue to fence query cursors. Replacement failure ends further care
edits until document reload; reload discards all overrides.
