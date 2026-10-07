CREATE TABLE library_local_handoff (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  handoff_id TEXT NOT NULL CHECK (length(handoff_id) = 64 AND handoff_id NOT GLOB '*[^0-9a-f]*'),
  library_id TEXT NOT NULL CHECK (length(library_id) = 64 AND library_id NOT GLOB '*[^0-9a-f]*'),
  installation_role TEXT NOT NULL CHECK (installation_role IN ('source', 'target', 'consumer')),
  phase TEXT NOT NULL CHECK (phase IN ('preparing', 'sealed', 'authorized', 'cas_pending', 'committed', 'active', 'demoted', 'cancelled', 'recovery', 'following')),
  predecessor_epoch_id TEXT NOT NULL CHECK (length(predecessor_epoch_id) = 64 AND predecessor_epoch_id NOT GLOB '*[^0-9a-f]*'),
  successor_epoch_id TEXT CHECK (length(successor_epoch_id) = 64 AND successor_epoch_id NOT GLOB '*[^0-9a-f]*'),
  target_writer_id TEXT NOT NULL CHECK (length(target_writer_id) = 64 AND target_writer_id NOT GLOB '*[^0-9a-f]*'),
  target_authority_public_key TEXT NOT NULL CHECK (length(target_authority_public_key) = 64 AND target_authority_public_key NOT GLOB '*[^0-9a-f]*'),
  canonical_readiness BLOB NOT NULL CHECK (length(canonical_readiness) BETWEEN 1 AND 16384),
  canonical_authorization_body BLOB CHECK (length(canonical_authorization_body) BETWEEN 1 AND 16384),
  canonical_authorization BLOB CHECK (length(canonical_authorization) BETWEEN 1 AND 16384),
  canonical_activation BLOB CHECK (length(canonical_activation) BETWEEN 1 AND 32768),
  expected_control_revision TEXT CHECK (length(CAST(expected_control_revision AS BLOB)) BETWEEN 1 AND 1024),
  observed_control_revision TEXT CHECK (length(CAST(observed_control_revision AS BLOB)) BETWEEN 1 AND 1024),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (phase IN ('preparing', 'sealed', 'cancelled') OR (canonical_authorization_body IS NOT NULL AND expected_control_revision IS NOT NULL)),
  CHECK (phase NOT IN ('cas_pending', 'committed', 'active', 'demoted') OR (canonical_authorization IS NOT NULL AND successor_epoch_id IS NOT NULL)),
  CHECK (phase NOT IN ('committed', 'active', 'demoted') OR (canonical_activation IS NOT NULL AND observed_control_revision IS NOT NULL)),
  CHECK (installation_role != 'source' OR phase NOT IN ('cas_pending', 'active')),
  CHECK (installation_role != 'target' OR phase NOT IN ('sealed', 'authorized', 'demoted')),
  CHECK ((installation_role = 'consumer') = (phase IN ('recovery', 'following')))
) STRICT;

CREATE TABLE library_local_recovery_archives (
  recovery_id TEXT PRIMARY KEY CHECK (length(recovery_id) = 64),
  library_id TEXT NOT NULL,
  predecessor_epoch_id TEXT NOT NULL,
  successor_epoch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  schema_sha256 TEXT NOT NULL CHECK (length(schema_sha256) = 64),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  pending_intent_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_intent_count BETWEEN 0 AND 9007199254740991),
  published_intent_count INTEGER NOT NULL DEFAULT 0 CHECK (published_intent_count BETWEEN 0 AND 9007199254740991),
  archive_digest TEXT NOT NULL CHECK (length(archive_digest) = 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  reenrollment_committed_at INTEGER CHECK (reenrollment_committed_at >= created_at),
  reenrollment_receipt BLOB CHECK (length(reenrollment_receipt) BETWEEN 1 AND 131072),
  reenrollment_digest TEXT CHECK (length(reenrollment_digest) = 64 AND reenrollment_digest NOT GLOB '*[^0-9a-f]*'),
  reenrollment_installation_witness TEXT CHECK (length(reenrollment_installation_witness) = 64 AND reenrollment_installation_witness NOT GLOB '*[^0-9a-f]*'),
  CHECK (reenrollment_committed_at IS NULL OR reenrollment_receipt IS NOT NULL),
  CHECK ((reenrollment_receipt IS NULL) = (reenrollment_digest IS NULL)),
  CHECK ((reenrollment_receipt IS NULL) = (reenrollment_installation_witness IS NULL))
) STRICT;
CREATE TABLE library_local_recovery_rows (
  recovery_id TEXT NOT NULL REFERENCES library_local_recovery_archives(recovery_id),
  table_key TEXT NOT NULL CHECK (table_key IN (
    'library_follower_actor_request', 'library_intent_actors', 'library_intent_transactions',
    'library_intent_members', 'library_intent_results', 'library_intent_result_cursors',
    'library_intent_transport_heads', 'library_intent_transport_segments',
    'library_result_transport_heads', 'library_result_transport_segments',
    'library_optimistic_fields', 'library_local_change_state', 'library_local_invalidations')),
  row_ordinal INTEGER NOT NULL CHECK (row_ordinal >= 0),
  transaction_id TEXT CHECK (length(CAST(transaction_id AS BLOB)) BETWEEN 1 AND 255),
  columns_json TEXT NOT NULL CHECK (length(columns_json) BETWEEN 1 AND 16384),
  canonical_row BLOB NOT NULL CHECK (length(canonical_row) BETWEEN 1 AND 2097152),
  row_digest TEXT NOT NULL CHECK (length(row_digest) = 64),
  PRIMARY KEY (recovery_id, table_key, row_ordinal)
) STRICT, WITHOUT ROWID;

CREATE INDEX library_local_recovery_transaction_rows ON library_local_recovery_rows (recovery_id, table_key, transaction_id, row_ordinal);

CREATE TABLE library_local_recovery_reissues (
  recovery_id TEXT NOT NULL REFERENCES library_local_recovery_archives(recovery_id),
  original_transaction_id TEXT NOT NULL CHECK (length(CAST(original_transaction_id AS BLOB)) BETWEEN 1 AND 255),
  archive_digest TEXT NOT NULL CHECK (length(archive_digest) = 64 AND archive_digest NOT GLOB '*[^0-9a-f]*'),
  original_transaction_digest TEXT NOT NULL CHECK (length(original_transaction_digest) = 64 AND original_transaction_digest NOT GLOB '*[^0-9a-f]*'),
  replacement_transaction_id TEXT NOT NULL UNIQUE CHECK (length(CAST(replacement_transaction_id AS BLOB)) BETWEEN 1 AND 255),
  replacement_transaction_digest TEXT NOT NULL CHECK (length(replacement_transaction_digest) = 64 AND replacement_transaction_digest NOT GLOB '*[^0-9a-f]*'),
  replacement_epoch_id TEXT NOT NULL CHECK (length(replacement_epoch_id) = 64 AND replacement_epoch_id NOT GLOB '*[^0-9a-f]*'),
  replacement_actor_id TEXT NOT NULL CHECK (length(replacement_actor_id) = 64 AND replacement_actor_id NOT GLOB '*[^0-9a-f]*'),
  first_counter INTEGER NOT NULL CHECK (first_counter BETWEEN 1 AND 9007199254740991),
  last_counter INTEGER NOT NULL CHECK (last_counter BETWEEN first_counter AND 9007199254740991),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000 AND last_counter = first_counter + member_count - 1),
  reviewed_generation_id TEXT NOT NULL CHECK (length(reviewed_generation_id) = 64 AND reviewed_generation_id NOT GLOB '*[^0-9a-f]*'),
  reviewed_revision INTEGER NOT NULL CHECK (reviewed_revision BETWEEN 0 AND 9007199254740991),
  reviewed_local_sequence INTEGER NOT NULL CHECK (reviewed_local_sequence BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (recovery_id, original_transaction_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE library_local_handoff_cancellations (
  handoff_id TEXT PRIMARY KEY CHECK (length(handoff_id) = 64 AND handoff_id NOT GLOB '*[^0-9a-f]*'),
  library_id TEXT NOT NULL CHECK (length(library_id) = 64 AND library_id NOT GLOB '*[^0-9a-f]*'),
  predecessor_epoch_id TEXT NOT NULL CHECK (length(predecessor_epoch_id) = 64 AND predecessor_epoch_id NOT GLOB '*[^0-9a-f]*'),
  canonical_readiness BLOB NOT NULL CHECK (length(canonical_readiness) BETWEEN 1 AND 16384),
  cancelled_at INTEGER NOT NULL CHECK (cancelled_at BETWEEN 0 AND 9007199254740991),
  canonical_cancellation BLOB CHECK (length(canonical_cancellation) BETWEEN 1 AND 16384)
) STRICT, WITHOUT ROWID;

CREATE INDEX library_local_recovery_enrollment ON library_local_recovery_archives (library_id, successor_epoch_id, reenrollment_digest);

CREATE TABLE library_local_source_demotions (
  handoff_id TEXT PRIMARY KEY CHECK (length(handoff_id) = 64 AND handoff_id NOT GLOB '*[^0-9a-f]*'),
  library_id TEXT NOT NULL CHECK (length(library_id) = 64 AND library_id NOT GLOB '*[^0-9a-f]*'),
  predecessor_epoch_id TEXT NOT NULL CHECK (length(predecessor_epoch_id) = 64 AND predecessor_epoch_id NOT GLOB '*[^0-9a-f]*'),
  successor_epoch_id TEXT NOT NULL CHECK (length(successor_epoch_id) = 64 AND successor_epoch_id NOT GLOB '*[^0-9a-f]*'),
  canonical_authorization BLOB NOT NULL CHECK (length(canonical_authorization) BETWEEN 1 AND 16384),
  canonical_adoption BLOB NOT NULL CHECK (length(canonical_adoption) BETWEEN 1 AND 32768),
  completed_at INTEGER NOT NULL CHECK (completed_at BETWEEN 0 AND 9007199254740991)
) STRICT, WITHOUT ROWID;
