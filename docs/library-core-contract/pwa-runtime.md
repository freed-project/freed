## 12. PWA and iPhone behavior

The PWA SQLite worker serializes database access and owns one OPFS database
generation. Interface tabs communicate through bounded messages. Worker loss,
suspension, tab replacement, and process eviction reopen the accepted database
generation and replay only durable local intents.

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
