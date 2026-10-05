## 4. SQLite database contract

One database represents one Library identity and one accepted writer epoch.
Opening verifies the exact application ID, schema version, contract version,
catalog objects, index definitions, foreign keys, journal mode, durability
settings, and active authority record before granting write access.

The final logical model contains normalized tables for:

- Library identity and active authority
- actors, capabilities, actor tips, and retirements
- transactions, operation members, receipts, and replication outbox entries
- feed items and registered feed-item child values
- RSS feeds and registered feed metadata
- people, accounts, reach-out events, and relationships
- synchronized preferences by registered typed node
- field clocks, entity generations, tombstones, and aliases
- follower intent transactions, sparse optimistic effects, publications, and
  canonical result receipts
- content descriptors, renditions, chunks, authenticated ranges, and canonical
  reachability
- device-local hydration policy, transfer progress, caches, and invalidations

FTS and RTree tables are derived SQLite structures. They are rebuilt from
canonical rows and never become independent authority.

JSON is allowed only for a closed canonical protocol object whose schema is
registered and bounded. Generic state JSON, arbitrary patches, monolithic
entities, and shell-shaped JSON are forbidden.

Physical schema 2 adds installation-local handoff, recovery archive and replacement
linkage tables. Logical checkpoint schema 1 remains unchanged. Native migration
commits the exact new catalog hash and schema version together with the first
handoff or recovery lifecycle record. Those records provide the migration readback;
opening the database alone does not rotate authority. A schema 1 predecessor must
refuse the upgraded database without modifying it. Browser recovery tables use
the matching versioned, durable local migration. These local tables never enter
logical checkpoints.
