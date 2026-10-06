CREATE TABLE library_local_annotation_migration (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  origin_version INTEGER NOT NULL CHECK (origin_version IN (1, 2)),
  origin_sha256 TEXT NOT NULL CHECK (length(origin_sha256) = 64 AND origin_sha256 NOT GLOB '*[^0-9a-f]*'),
  catalog_version INTEGER NOT NULL CHECK (catalog_version IN (4, 5)),
  catalog_sha256 TEXT NOT NULL CHECK (length(catalog_sha256) = 64 AND catalog_sha256 NOT GLOB '*[^0-9a-f]*'),
  phase TEXT NOT NULL CHECK (phase IN ('building', 'ready')),
  pinned_identity TEXT NOT NULL CHECK (length(CAST(pinned_identity AS BLOB)) BETWEEN 1 AND 8192),
  after_transaction_id TEXT CHECK (after_transaction_id IS NULL OR length(CAST(after_transaction_id AS BLOB)) BETWEEN 1 AND 255),
  after_member_index INTEGER CHECK (after_member_index IS NULL OR after_member_index BETWEEN 0 AND 999),
  scanned_members INTEGER NOT NULL CHECK (scanned_members BETWEEN 0 AND 9007199254740991),
  CHECK ((after_transaction_id IS NULL) = (after_member_index IS NULL)),
  CHECK (catalog_version = 5 OR origin_version = 1)
) STRICT;

CREATE TABLE library_local_annotation_unresolved (
  entity_id TEXT NOT NULL CHECK (length(CAST(entity_id AS BLOB)) BETWEEN 1 AND 2048),
  transaction_id TEXT NOT NULL,
  member_index INTEGER NOT NULL CHECK (member_index BETWEEN 0 AND 999),
  PRIMARY KEY (entity_id, transaction_id, member_index),
  FOREIGN KEY (transaction_id, member_index)
    REFERENCES library_intent_members(transaction_id, member_index) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX library_local_annotation_transaction
  ON library_local_annotation_unresolved(transaction_id, member_index);
