PRAGMA foreign_keys = ON;
PRAGMA application_id = 1179796804;

CREATE TABLE IF NOT EXISTS library_storage_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  contract_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  protocol_version INTEGER NOT NULL,
  schema_sha256 TEXT NOT NULL CHECK (length(schema_sha256) = 64)
) STRICT;

CREATE TABLE IF NOT EXISTS library_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  library_id TEXT NOT NULL CHECK (length(library_id) BETWEEN 1 AND 255),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  authority_epoch TEXT NOT NULL CHECK (length(authority_epoch) BETWEEN 1 AND 255),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_authority_epochs (
  epoch_id TEXT PRIMARY KEY CHECK (length(CAST(epoch_id AS BLOB)) BETWEEN 1 AND 255),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  epoch_number INTEGER NOT NULL CHECK (epoch_number >= 1),
  authority_key_id TEXT NOT NULL CHECK (length(authority_key_id) = 64 AND authority_key_id NOT GLOB '*[^0-9a-f]*'),
  authority_public_key TEXT NOT NULL CHECK (length(authority_public_key) = 64 AND authority_public_key NOT GLOB '*[^0-9a-f]*'),
  transition_certificate_digest TEXT NOT NULL CHECK (length(transition_certificate_digest) = 64 AND transition_certificate_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_transition_certificate TEXT NOT NULL CHECK (length(CAST(canonical_transition_certificate AS BLOB)) BETWEEN 1 AND 65536),
  accepted_manifest_generation INTEGER NOT NULL CHECK (accepted_manifest_generation >= 0),
  checkpoint_frontier_digest TEXT NOT NULL CHECK (length(checkpoint_frontier_digest) = 64 AND checkpoint_frontier_digest NOT GLOB '*[^0-9a-f]*'),
  materialized_state_digest TEXT NOT NULL CHECK (length(materialized_state_digest) = 64 AND materialized_state_digest NOT GLOB '*[^0-9a-f]*'),
  accepted_at INTEGER NOT NULL CHECK (accepted_at >= 0),
  UNIQUE (library_id, epoch_number)
) STRICT;

CREATE TABLE IF NOT EXISTS library_authority_frontier (
  epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
  actor_id TEXT NOT NULL CHECK (length(CAST(actor_id AS BLOB)) BETWEEN 1 AND 255),
  accepted_counter INTEGER NOT NULL CHECK (accepted_counter >= 1),
  accepted_operation_id TEXT NOT NULL CHECK (length(CAST(accepted_operation_id AS BLOB)) BETWEEN 1 AND 255),
  accepted_chain_digest TEXT NOT NULL CHECK (length(accepted_chain_digest) = 64 AND accepted_chain_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (epoch_id, ordinal),
  UNIQUE (epoch_id, actor_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_active_authority (
  active_key TEXT PRIMARY KEY CHECK (active_key = 'active'),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  writer_id TEXT NOT NULL CHECK (length(CAST(writer_id AS BLOB)) BETWEEN 1 AND 255),
  accepted_manifest_generation INTEGER NOT NULL CHECK (accepted_manifest_generation >= 0),
  activated_at INTEGER NOT NULL CHECK (activated_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_writer_admission (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  local_writer_id TEXT NOT NULL CHECK (length(CAST(local_writer_id AS BLOB)) BETWEEN 1 AND 255),
  active_writer_id TEXT NOT NULL CHECK (length(CAST(active_writer_id AS BLOB)) BETWEEN 1 AND 255),
  observed_manifest_generation INTEGER NOT NULL CHECK (observed_manifest_generation >= 0),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_blobs (
  content_digest TEXT PRIMARY KEY CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  chunk_bytes INTEGER NOT NULL CHECK (chunk_bytes = 65536),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  media_type TEXT NOT NULL CHECK (length(CAST(media_type AS BLOB)) BETWEEN 1 AND 255)
) STRICT;

CREATE TABLE IF NOT EXISTS library_blob_chunks (
  content_digest TEXT NOT NULL REFERENCES library_blobs(content_digest) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_digest TEXT NOT NULL CHECK (length(chunk_digest) = 64 AND chunk_digest NOT GLOB '*[^0-9a-f]*'),
  bytes BLOB NOT NULL CHECK (length(bytes) BETWEEN 0 AND 65536),
  PRIMARY KEY (content_digest, chunk_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_items (
  global_id TEXT PRIMARY KEY CHECK (length(CAST(global_id AS BLOB)) BETWEEN 1 AND 2048),
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  captured_at INTEGER NOT NULL CHECK (captured_at >= 0),
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  author_id TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  author_avatar_url TEXT,
  content_text TEXT CHECK (content_text IS NULL OR length(CAST(content_text AS BLOB)) <= 65536),
  content_text_blob_digest TEXT REFERENCES library_blobs(content_digest),
  link_url TEXT,
  link_title TEXT,
  link_description TEXT,
  engagement_likes INTEGER,
  engagement_reposts INTEGER,
  engagement_comments INTEGER,
  engagement_views INTEGER,
  location_name TEXT,
  location_lat REAL,
  location_lng REAL,
  location_url TEXT,
  location_source TEXT,
  time_range_starts_at INTEGER,
  time_range_ends_at INTEGER,
  time_range_kind TEXT,
  rss_feed_url TEXT,
  rss_feed_title TEXT,
  rss_site_url TEXT,
  fb_group_id TEXT,
  fb_group_name TEXT,
  fb_group_url TEXT,
  preserved_text TEXT CHECK (preserved_text IS NULL OR length(CAST(preserved_text AS BLOB)) <= 65536),
  preserved_text_blob_digest TEXT REFERENCES library_blobs(content_digest),
  preserved_author TEXT,
  preserved_published_at INTEGER,
  preserved_word_count INTEGER,
  preserved_reading_time INTEGER,
  preserved_at INTEGER,
  hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
  read_at INTEGER,
  saved INTEGER NOT NULL CHECK (saved IN (0, 1)),
  saved_at INTEGER,
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  archived_at INTEGER,
  liked INTEGER CHECK (liked IS NULL OR liked IN (0, 1)),
  liked_at INTEGER,
  liked_synced_at INTEGER,
  seen_synced_at INTEGER,
  priority REAL,
  priority_computed_at INTEGER,
  source_url TEXT,
  sample_batch_id TEXT,
  sample_generated_at INTEGER,
  sample_generator_version INTEGER,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (content_text IS NULL OR content_text_blob_digest IS NULL),
  CHECK (preserved_text IS NULL OR preserved_text_blob_digest IS NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS library_feed_items_browse
  ON library_feed_items(archived, hidden, published_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_saved
  ON library_feed_items(saved, archived, saved_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_author
  ON library_feed_items(author_id, published_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_platform
  ON library_feed_items(platform, published_at DESC, global_id);

CREATE TABLE IF NOT EXISTS library_feed_item_media (
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  source_url TEXT NOT NULL,
  media_type TEXT NOT NULL,
  blob_content_digest TEXT REFERENCES library_blobs(content_digest),
  PRIMARY KEY (global_id, ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_item_topics (
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  PRIMARY KEY (global_id, topic)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_item_tags (
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (global_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_item_highlights (
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text_value TEXT CHECK (text_value IS NULL OR length(CAST(text_value AS BLOB)) <= 65536),
  text_blob_digest TEXT REFERENCES library_blobs(content_digest),
  note TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (global_id, ordinal),
  CHECK ((text_value IS NULL) <> (text_blob_digest IS NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_item_signals (
  global_id TEXT PRIMARY KEY REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  method TEXT NOT NULL,
  inferred_at INTEGER NOT NULL CHECK (inferred_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_feed_item_signal_scores (
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  signal TEXT NOT NULL,
  score REAL,
  tagged INTEGER NOT NULL CHECK (tagged IN (0, 1)),
  PRIMARY KEY (global_id, signal)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_feed_item_events (
  global_id TEXT PRIMARY KEY REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  method TEXT NOT NULL,
  detected_at INTEGER NOT NULL CHECK (detected_at >= 0),
  confidence REAL NOT NULL,
  title TEXT,
  starts_at INTEGER,
  ends_at INTEGER,
  timezone TEXT,
  location_name TEXT,
  location_url TEXT,
  evidence TEXT CHECK (evidence IS NULL OR length(CAST(evidence AS BLOB)) <= 65536),
  evidence_blob_digest TEXT REFERENCES library_blobs(content_digest),
  CHECK (evidence IS NULL OR evidence_blob_digest IS NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS library_rss_feeds (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  site_url TEXT,
  last_fetched INTEGER,
  image_url TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  poll_interval INTEGER,
  track_unread INTEGER NOT NULL CHECK (track_unread IN (0, 1)),
  folder TEXT,
  sample_batch_id TEXT,
  sample_generated_at INTEGER,
  sample_generator_version INTEGER,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  relationship_status TEXT NOT NULL,
  care_level INTEGER NOT NULL CHECK (care_level BETWEEN 1 AND 5),
  reach_out_interval_days INTEGER,
  notes TEXT,
  sample_batch_id TEXT,
  sample_generated_at INTEGER,
  sample_generator_version INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_person_tags (
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (person_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_person_reach_outs (
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  logged_at INTEGER NOT NULL CHECK (logged_at >= 0),
  channel TEXT,
  notes TEXT,
  PRIMARY KEY (person_id, ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_accounts (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES library_persons(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  handle TEXT,
  display_name TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  imported_at INTEGER,
  first_seen_at INTEGER NOT NULL CHECK (first_seen_at >= 0),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  discovered_from TEXT NOT NULL,
  follow_roster_active INTEGER CHECK (follow_roster_active IS NULL OR follow_roster_active IN (0, 1)),
  follow_roster_synced_at INTEGER,
  sample_batch_id TEXT,
  sample_generated_at INTEGER,
  sample_generator_version INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS library_accounts_person ON library_accounts(person_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS library_accounts_provider_external
  ON library_accounts(provider, external_id);

CREATE TABLE IF NOT EXISTS library_account_follow_roles (
  account_id TEXT NOT NULL REFERENCES library_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (account_id, role)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_preferences (
  path TEXT PRIMARY KEY,
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'integer', 'real', 'text', 'null')),
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
  integer_value INTEGER,
  real_value REAL,
  text_value TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (
    (value_type = 'boolean' AND boolean_value IS NOT NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL) OR
    (value_type = 'integer' AND boolean_value IS NULL AND integer_value IS NOT NULL AND real_value IS NULL AND text_value IS NULL) OR
    (value_type = 'real' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NOT NULL AND text_value IS NULL) OR
    (value_type = 'text' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NOT NULL) OR
    (value_type = 'null' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_relationships (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  metadata_text TEXT CHECK (metadata_text IS NULL OR length(CAST(metadata_text AS BLOB)) <= 65536),
  metadata_blob_digest TEXT REFERENCES library_blobs(content_digest),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (subject_type, subject_id, relation_type, object_type, object_id),
  CHECK (metadata_text IS NULL OR metadata_blob_digest IS NULL)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_field_clocks (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (entity_type, entity_id, field_path)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_tombstones (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  operation_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL CHECK (deleted_at >= 0),
  PRIMARY KEY (entity_type, entity_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_actors (
  actor_id TEXT PRIMARY KEY,
  authority_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  actor_kind TEXT NOT NULL,
  public_key TEXT NOT NULL CHECK (length(public_key) = 64 AND public_key NOT GLOB '*[^0-9a-f]*'),
  enrollment_operation_id TEXT NOT NULL CHECK (length(CAST(enrollment_operation_id AS BLOB)) BETWEEN 1 AND 255),
  enrollment_certificate_digest TEXT NOT NULL CHECK (length(enrollment_certificate_digest) = 64 AND enrollment_certificate_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_enrollment_certificate TEXT NOT NULL CHECK (length(CAST(canonical_enrollment_certificate AS BLOB)) BETWEEN 1 AND 65536),
  chain_genesis_digest TEXT NOT NULL CHECK (length(chain_genesis_digest) = 64 AND chain_genesis_digest NOT GLOB '*[^0-9a-f]*'),
  accepted_counter INTEGER NOT NULL CHECK (accepted_counter >= 0),
  accepted_operation_id TEXT,
  accepted_chain_digest TEXT NOT NULL CHECK (length(accepted_chain_digest) = 64 AND accepted_chain_digest NOT GLOB '*[^0-9a-f]*'),
  retired_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (
    (accepted_counter = 0 AND accepted_operation_id IS NULL AND accepted_chain_digest = chain_genesis_digest)
    OR (accepted_counter > 0 AND accepted_operation_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_actor_capabilities (
  capability_id TEXT PRIMARY KEY CHECK (length(CAST(capability_id AS BLOB)) BETWEEN 1 AND 255),
  actor_id TEXT NOT NULL REFERENCES library_actors(actor_id) ON DELETE CASCADE,
  certificate_version INTEGER NOT NULL CHECK (certificate_version >= 1),
  actor_class TEXT NOT NULL CHECK (length(CAST(actor_class AS BLOB)) BETWEEN 1 AND 64),
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('legacy_editor', 'library_wide', 'bounded')),
  scope_kind TEXT,
  scope_id TEXT,
  issuance_identity TEXT CHECK (issuance_identity IS NULL OR length(CAST(issuance_identity AS BLOB)) BETWEEN 1 AND 255),
  retirement_identity TEXT CHECK (retirement_identity IS NULL OR length(CAST(retirement_identity AS BLOB)) BETWEEN 1 AND 255),
  certificate_digest TEXT NOT NULL CHECK (length(certificate_digest) = 64 AND certificate_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_certificate TEXT NOT NULL CHECK (length(CAST(canonical_certificate AS BLOB)) BETWEEN 1 AND 65536),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  retired_at INTEGER,
  retirement_certificate_digest TEXT CHECK (retirement_certificate_digest IS NULL OR (length(retirement_certificate_digest) = 64 AND retirement_certificate_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (scope_mode IN ('legacy_editor', 'library_wide') AND scope_kind IS NULL AND scope_id IS NULL)
    OR (scope_mode = 'bounded' AND scope_kind IS NOT NULL AND scope_id IS NOT NULL)
  ),
  CHECK (
    (retired_at IS NULL AND retirement_certificate_digest IS NULL)
    OR (retired_at IS NOT NULL AND retirement_certificate_digest IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS library_actor_capabilities_active
  ON library_actor_capabilities(actor_id)
  WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS library_actor_capability_mutations (
  capability_id TEXT NOT NULL REFERENCES library_actor_capabilities(capability_id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (capability_id, mutation_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_receipts (
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  result_text TEXT CHECK (result_text IS NULL OR length(CAST(result_text AS BLOB)) <= 65536),
  result_blob_digest TEXT REFERENCES library_blobs(content_digest),
  accepted_at INTEGER NOT NULL CHECK (accepted_at >= 0),
  PRIMARY KEY (actor_id, operation_id),
  CHECK (result_text IS NULL OR result_blob_digest IS NULL)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_change_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT OR IGNORE INTO library_change_state (singleton_id, revision) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS library_transactions (
  transaction_id TEXT PRIMARY KEY CHECK (length(CAST(transaction_id AS BLOB)) BETWEEN 1 AND 255),
  transaction_digest TEXT NOT NULL CHECK (length(transaction_digest) = 64 AND transaction_digest NOT GLOB '*[^0-9a-f]*'),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  authority_epoch TEXT NOT NULL CHECK (length(CAST(authority_epoch AS BLOB)) BETWEEN 1 AND 255),
  actor_id TEXT NOT NULL REFERENCES library_actors(actor_id),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000),
  first_counter INTEGER NOT NULL CHECK (first_counter >= 1),
  last_counter INTEGER NOT NULL CHECK (last_counter = first_counter + member_count - 1),
  previous_operation_id TEXT,
  previous_chain_digest TEXT NOT NULL CHECK (length(previous_chain_digest) = 64 AND previous_chain_digest NOT GLOB '*[^0-9a-f]*'),
  committed_operation_id TEXT NOT NULL,
  committed_chain_digest TEXT NOT NULL CHECK (length(committed_chain_digest) = 64 AND committed_chain_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_member_bytes INTEGER NOT NULL CHECK (canonical_member_bytes BETWEEN 1 AND 4194304),
  previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
  committed_revision INTEGER NOT NULL CHECK (committed_revision = previous_revision + 1),
  committed_at INTEGER NOT NULL CHECK (committed_at >= 0),
  CHECK (
    (first_counter = 1 AND previous_operation_id IS NULL)
    OR (first_counter > 1 AND previous_operation_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_operations (
  operation_id TEXT PRIMARY KEY CHECK (length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 255),
  transaction_id TEXT NOT NULL REFERENCES library_transactions(transaction_id) ON DELETE CASCADE,
  member_index INTEGER NOT NULL CHECK (member_index >= 0),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000 AND member_index < member_count),
  actor_id TEXT NOT NULL REFERENCES library_actors(actor_id),
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  previous_actor_operation_id TEXT,
  previous_actor_chain_digest TEXT NOT NULL CHECK (length(previous_actor_chain_digest) = 64 AND previous_actor_chain_digest NOT GLOB '*[^0-9a-f]*'),
  actor_chain_digest TEXT NOT NULL CHECK (length(actor_chain_digest) = 64 AND actor_chain_digest NOT GLOB '*[^0-9a-f]*'),
  member_digest TEXT NOT NULL CHECK (length(member_digest) = 64 AND member_digest NOT GLOB '*[^0-9a-f]*'),
  envelope_digest TEXT NOT NULL CHECK (length(envelope_digest) = 64 AND envelope_digest NOT GLOB '*[^0-9a-f]*'),
  mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  canonical_envelope BLOB NOT NULL CHECK (length(canonical_envelope) BETWEEN 1 AND 131072),
  committed_at INTEGER NOT NULL CHECK (committed_at >= 0),
  UNIQUE (transaction_id, member_index),
  UNIQUE (actor_id, actor_counter),
  CHECK (
    (actor_counter = 1 AND previous_actor_operation_id IS NULL)
    OR (actor_counter > 1 AND previous_actor_operation_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS library_operations_actor_order
  ON library_operations(actor_id, actor_counter);

CREATE TABLE IF NOT EXISTS library_operation_causal_tips (
  operation_id TEXT NOT NULL REFERENCES library_operations(operation_id) ON DELETE CASCADE,
  tip_index INTEGER NOT NULL CHECK (tip_index >= 0),
  actor_id TEXT NOT NULL,
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  tip_operation_id TEXT NOT NULL,
  chain_digest TEXT NOT NULL CHECK (length(chain_digest) = 64 AND chain_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (operation_id, tip_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_replication_outbox (
  operation_id TEXT PRIMARY KEY REFERENCES library_operations(operation_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  enqueued_at INTEGER NOT NULL CHECK (enqueued_at >= 0),
  acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= enqueued_at),
  UNIQUE (actor_id, actor_counter)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_replication_outbox_pending
  ON library_replication_outbox(actor_id, actor_counter)
  WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS library_invalidations (
  revision INTEGER NOT NULL CHECK (revision >= 1),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  topic TEXT NOT NULL CHECK (length(CAST(topic AS BLOB)) BETWEEN 1 AND 128),
  entity_id TEXT CHECK (entity_id IS NULL OR length(CAST(entity_id AS BLOB)) BETWEEN 1 AND 2048),
  reset_required INTEGER NOT NULL CHECK (reset_required IN (0, 1)),
  PRIMARY KEY (revision, ordinal)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_invalidations_topic
  ON library_invalidations(topic, revision);

CREATE TABLE IF NOT EXISTS library_intent_actors (
  actor_id TEXT PRIMARY KEY REFERENCES library_actors(actor_id) ON DELETE CASCADE,
  next_counter INTEGER NOT NULL CHECK (next_counter >= 1),
  previous_operation_id TEXT,
  previous_chain_digest TEXT NOT NULL CHECK (length(previous_chain_digest) = 64 AND previous_chain_digest NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    (next_counter = 1 AND previous_operation_id IS NULL)
    OR (next_counter > 1 AND previous_operation_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_intent_transactions (
  transaction_id TEXT PRIMARY KEY CHECK (length(CAST(transaction_id AS BLOB)) BETWEEN 1 AND 255),
  transaction_digest TEXT NOT NULL CHECK (length(transaction_digest) = 64 AND transaction_digest NOT GLOB '*[^0-9a-f]*'),
  actor_id TEXT NOT NULL REFERENCES library_intent_actors(actor_id),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000),
  first_counter INTEGER NOT NULL CHECK (first_counter >= 1),
  last_counter INTEGER NOT NULL CHECK (last_counter = first_counter + member_count - 1),
  previous_operation_id TEXT,
  previous_chain_digest TEXT NOT NULL CHECK (length(previous_chain_digest) = 64 AND previous_chain_digest NOT GLOB '*[^0-9a-f]*'),
  ending_operation_id TEXT NOT NULL,
  ending_chain_digest TEXT NOT NULL CHECK (length(ending_chain_digest) = 64 AND ending_chain_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_member_bytes INTEGER NOT NULL CHECK (canonical_member_bytes BETWEEN 1 AND 4194304),
  canonical_header BLOB NOT NULL CHECK (length(canonical_header) BETWEEN 1 AND 131072),
  signature BLOB NOT NULL CHECK (length(signature) BETWEEN 1 AND 512),
  state TEXT NOT NULL CHECK (state IN ('pending', 'published', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  published_at INTEGER,
  resolved_at INTEGER,
  CHECK (
    (first_counter = 1 AND previous_operation_id IS NULL)
    OR (first_counter > 1 AND previous_operation_id IS NOT NULL)
  ),
  CHECK (published_at IS NULL OR published_at >= created_at),
  CHECK (resolved_at IS NULL OR resolved_at >= created_at)
) STRICT;

CREATE INDEX IF NOT EXISTS library_intent_transactions_pending
  ON library_intent_transactions(actor_id, first_counter)
  WHERE state IN ('pending', 'published');

CREATE TABLE IF NOT EXISTS library_intent_members (
  transaction_id TEXT NOT NULL REFERENCES library_intent_transactions(transaction_id) ON DELETE CASCADE,
  member_index INTEGER NOT NULL CHECK (member_index >= 0),
  operation_id TEXT NOT NULL UNIQUE,
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  canonical_member BLOB NOT NULL CHECK (length(canonical_member) BETWEEN 1 AND 131072),
  member_digest TEXT NOT NULL CHECK (length(member_digest) = 64 AND member_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (transaction_id, member_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_intent_results (
  transaction_id TEXT PRIMARY KEY REFERENCES library_intent_transactions(transaction_id) ON DELETE CASCADE,
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64 AND result_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'already_applied')),
  canonical_result BLOB NOT NULL CHECK (length(canonical_result) BETWEEN 1 AND 131072),
  received_at INTEGER NOT NULL CHECK (received_at >= 0)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_optimistic_fields (
  transaction_id TEXT NOT NULL REFERENCES library_intent_transactions(transaction_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'integer', 'real', 'text', 'null')),
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
  integer_value INTEGER,
  real_value REAL,
  text_value TEXT CHECK (text_value IS NULL OR length(CAST(text_value AS BLOB)) <= 65536),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (transaction_id, entity_type, entity_id, field_path)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_checkpoint_stages (
  stage_id TEXT PRIMARY KEY CHECK (length(CAST(stage_id AS BLOB)) BETWEEN 1 AND 255),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  authority_epoch TEXT NOT NULL CHECK (length(CAST(authority_epoch AS BLOB)) BETWEEN 1 AND 255),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  expected_record_count INTEGER NOT NULL CHECK (expected_record_count >= 1),
  expected_checkpoint_digest TEXT NOT NULL CHECK (length(expected_checkpoint_digest) = 64 AND expected_checkpoint_digest NOT GLOB '*[^0-9a-f]*'),
  staged_record_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_record_count >= 0),
  staged_canonical_bytes INTEGER NOT NULL DEFAULT 0 CHECK (staged_canonical_bytes >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_checkpoint_stage_records (
  stage_id TEXT NOT NULL REFERENCES library_checkpoint_stages(stage_id) ON DELETE CASCADE,
  registry_key TEXT NOT NULL CHECK (length(CAST(registry_key AS BLOB)) BETWEEN 1 AND 64 AND registry_key NOT LIKE '%shell%'),
  primary_key_canonical BLOB NOT NULL CHECK (length(primary_key_canonical) BETWEEN 1 AND 4096),
  record_canonical BLOB NOT NULL CHECK (length(record_canonical) BETWEEN 1 AND 131072),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (stage_id, registry_key, primary_key_canonical)
) STRICT, WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS library_checkpoint_export AS
SELECT
  '00_checkpoint_header' AS registry_key,
  json_quote('checkpoint') AS primary_key_json,
  json_object(
    'authorityEpoch', authority_epoch,
    'checkpointId', library_id || ':' || authority_epoch || ':' || source_revision,
    'createdAtMs', updated_at,
    'libraryId', library_id,
    'schemaVersion', schema_version,
    'sourceRevision', source_revision
  ) AS payload_json,
  NULL AS chunk_bytes
FROM library_meta
UNION ALL
SELECT
  '01_authority_epoch',
  json_quote(epoch_id),
  json_object(
    'acceptedAt', accepted_at,
    'acceptedManifestGeneration', accepted_manifest_generation,
    'authorityKeyId', authority_key_id,
    'authorityPublicKey', authority_public_key,
    'canonicalTransitionCertificate', canonical_transition_certificate,
    'checkpointFrontierDigest', checkpoint_frontier_digest,
    'epochNumber', epoch_number,
    'libraryId', library_id,
    'materializedStateDigest', materialized_state_digest,
    'transitionCertificateDigest', transition_certificate_digest
  ), NULL
FROM library_authority_epochs
UNION ALL
SELECT
  '02_authority_frontier',
  json_array(epoch_id, ordinal),
  json_object(
    'acceptedChainDigest', accepted_chain_digest,
    'acceptedCounter', accepted_counter,
    'acceptedOperationId', accepted_operation_id,
    'actorId', actor_id
  ), NULL
FROM library_authority_frontier
UNION ALL
SELECT
  '03_active_authority',
  json_quote(active_key),
  json_object(
    'activeKey', active_key,
    'acceptedManifestGeneration', accepted_manifest_generation,
    'activatedAt', activated_at,
    'epochId', epoch_id,
    'libraryId', library_id,
    'writerId', writer_id
  ), NULL
FROM library_active_authority
UNION ALL
SELECT
  '10_feed_item',
  json_quote(global_id),
  json_object(
    'archived', json(CASE archived WHEN 1 THEN 'true' ELSE 'false' END),
    'archivedAt', archived_at,
    'authorAvatarUrl', author_avatar_url,
    'authorDisplayName', author_display_name,
    'authorHandle', author_handle,
    'authorId', author_id,
    'capturedAt', captured_at,
    'contentText', content_text,
    'contentTextBlobDigest', content_text_blob_digest,
    'contentType', content_type,
    'engagementComments', engagement_comments,
    'engagementLikes', engagement_likes,
    'engagementReposts', engagement_reposts,
    'engagementViews', engagement_views,
    'fbGroupId', fb_group_id,
    'fbGroupName', fb_group_name,
    'fbGroupUrl', fb_group_url,
    'hidden', json(CASE hidden WHEN 1 THEN 'true' ELSE 'false' END),
    'liked', CASE WHEN liked IS NULL THEN NULL ELSE json(CASE liked WHEN 1 THEN 'true' ELSE 'false' END) END,
    'likedAt', liked_at,
    'likedSyncedAt', liked_synced_at,
    'linkDescription', link_description,
    'linkTitle', link_title,
    'linkUrl', link_url,
    'locationLat', location_lat,
    'locationLng', location_lng,
    'locationName', location_name,
    'locationSource', location_source,
    'locationUrl', location_url,
    'platform', platform,
    'preservedAt', preserved_at,
    'preservedAuthor', preserved_author,
    'preservedPublishedAt', preserved_published_at,
    'preservedReadingTime', preserved_reading_time,
    'preservedText', preserved_text,
    'preservedTextBlobDigest', preserved_text_blob_digest,
    'preservedWordCount', preserved_word_count,
    'priority', priority,
    'priorityComputedAt', priority_computed_at,
    'publishedAt', published_at,
    'readAt', read_at,
    'rssFeedTitle', rss_feed_title,
    'rssFeedUrl', rss_feed_url,
    'rssSiteUrl', rss_site_url,
    'sampleBatchId', sample_batch_id,
    'sampleGeneratedAt', sample_generated_at,
    'sampleGeneratorVersion', sample_generator_version,
    'saved', json(CASE saved WHEN 1 THEN 'true' ELSE 'false' END),
    'savedAt', saved_at,
    'seenSyncedAt', seen_synced_at,
    'sourceUrl', source_url,
    'timeRangeEndsAt', time_range_ends_at,
    'timeRangeKind', time_range_kind,
    'timeRangeStartsAt', time_range_starts_at,
    'updatedAt', updated_at
  ),
  NULL
FROM library_feed_items
UNION ALL
SELECT '11_feed_item_media', json_array(global_id, ordinal),
  json_object('blobContentDigest', blob_content_digest, 'mediaType', media_type, 'sourceUrl', source_url), NULL
FROM library_feed_item_media
UNION ALL
SELECT '12_feed_item_topic', json_array(global_id, topic), json_object('topic', topic), NULL
FROM library_feed_item_topics
UNION ALL
SELECT '13_feed_item_tag', json_array(global_id, tag), json_object('tag', tag), NULL
FROM library_feed_item_tags
UNION ALL
SELECT '14_feed_item_highlight', json_array(global_id, ordinal),
  json_object('createdAt', created_at, 'note', note, 'text', text_value, 'textBlobDigest', text_blob_digest), NULL
FROM library_feed_item_highlights
UNION ALL
SELECT '15_feed_item_signal', json_quote(global_id),
  json_object('inferredAt', inferred_at, 'method', method, 'version', version), NULL
FROM library_feed_item_signals
UNION ALL
SELECT '16_feed_item_signal_score', json_array(global_id, signal),
  json_object('score', score, 'signal', signal, 'tagged', json(CASE tagged WHEN 1 THEN 'true' ELSE 'false' END)), NULL
FROM library_feed_item_signal_scores
UNION ALL
SELECT '17_feed_item_event', json_quote(global_id),
  json_object(
    'confidence', confidence,
    'detectedAt', detected_at,
    'endsAt', ends_at,
    'evidence', evidence,
    'evidenceBlobDigest', evidence_blob_digest,
    'locationName', location_name,
    'locationUrl', location_url,
    'method', method,
    'startsAt', starts_at,
    'timezone', timezone,
    'title', title,
    'version', version
  ), NULL
FROM library_feed_item_events
UNION ALL
SELECT '20_rss_feed', json_quote(url),
  json_object(
    'enabled', json(CASE enabled WHEN 1 THEN 'true' ELSE 'false' END),
    'folder', folder,
    'imageUrl', image_url,
    'lastFetched', last_fetched,
    'pollInterval', poll_interval,
    'sampleBatchId', sample_batch_id,
    'sampleGeneratedAt', sample_generated_at,
    'sampleGeneratorVersion', sample_generator_version,
    'siteUrl', site_url,
    'title', title,
    'trackUnread', json(CASE track_unread WHEN 1 THEN 'true' ELSE 'false' END),
    'updatedAt', updated_at
  ), NULL
FROM library_rss_feeds
UNION ALL
SELECT '30_person', json_quote(id),
  json_object(
    'avatarUrl', avatar_url,
    'bio', bio,
    'careLevel', care_level,
    'createdAt', created_at,
    'name', name,
    'notes', notes,
    'reachOutIntervalDays', reach_out_interval_days,
    'relationshipStatus', relationship_status,
    'sampleBatchId', sample_batch_id,
    'sampleGeneratedAt', sample_generated_at,
    'sampleGeneratorVersion', sample_generator_version,
    'updatedAt', updated_at
  ), NULL
FROM library_persons
UNION ALL
SELECT '31_person_tag', json_array(person_id, tag), json_object('tag', tag), NULL
FROM library_person_tags
UNION ALL
SELECT '32_person_reach_out', json_array(person_id, ordinal),
  json_object('channel', channel, 'loggedAt', logged_at, 'notes', notes), NULL
FROM library_person_reach_outs
UNION ALL
SELECT '40_account', json_quote(id),
  json_object(
    'address', address,
    'avatarUrl', avatar_url,
    'createdAt', created_at,
    'discoveredFrom', discovered_from,
    'displayName', display_name,
    'email', email,
    'externalId', external_id,
    'firstSeenAt', first_seen_at,
    'followRosterActive', CASE WHEN follow_roster_active IS NULL THEN NULL ELSE json(CASE follow_roster_active WHEN 1 THEN 'true' ELSE 'false' END) END,
    'followRosterSyncedAt', follow_roster_synced_at,
    'handle', handle,
    'importedAt', imported_at,
    'kind', kind,
    'lastSeenAt', last_seen_at,
    'personId', person_id,
    'phone', phone,
    'profileUrl', profile_url,
    'provider', provider,
    'sampleBatchId', sample_batch_id,
    'sampleGeneratedAt', sample_generated_at,
    'sampleGeneratorVersion', sample_generator_version,
    'updatedAt', updated_at
  ), NULL
FROM library_accounts
UNION ALL
SELECT '41_account_follow_role', json_array(account_id, role), json_object('role', role), NULL
FROM library_account_follow_roles
UNION ALL
SELECT '50_preference', json_quote(path),
  json_object(
    'booleanValue', CASE WHEN boolean_value IS NULL THEN NULL ELSE json(CASE boolean_value WHEN 1 THEN 'true' ELSE 'false' END) END,
    'integerValue', integer_value,
    'realValue', real_value,
    'textValue', text_value,
    'updatedAt', updated_at,
    'valueType', value_type
  ), NULL
FROM library_preferences
UNION ALL
SELECT '60_relationship', json_array(subject_type, subject_id, relation_type, object_type, object_id),
  json_object('createdAt', created_at, 'metadataBlobDigest', metadata_blob_digest, 'metadataText', metadata_text, 'updatedAt', updated_at), NULL
FROM library_relationships
UNION ALL
SELECT '70_field_clock', json_array(entity_type, entity_id, field_path),
  json_object('actorId', actor_id, 'counter', counter, 'operationId', operation_id, 'updatedAt', updated_at), NULL
FROM library_field_clocks
UNION ALL
SELECT '80_tombstone', json_array(entity_type, entity_id),
  json_object('actorId', actor_id, 'counter', counter, 'deletedAt', deleted_at, 'operationId', operation_id), NULL
FROM library_tombstones
UNION ALL
SELECT '90_actor_state', json_quote(actor_id),
  json_object(
    'acceptedChainDigest', accepted_chain_digest,
    'acceptedCounter', accepted_counter,
    'acceptedOperationId', accepted_operation_id,
    'actorKind', actor_kind,
    'authorityEpochId', authority_epoch_id,
    'canonicalEnrollmentCertificate', canonical_enrollment_certificate,
    'chainGenesisDigest', chain_genesis_digest,
    'createdAt', created_at,
    'enrollmentCertificateDigest', enrollment_certificate_digest,
    'enrollmentOperationId', enrollment_operation_id,
    'publicKey', public_key,
    'retiredAt', retired_at,
    'updatedAt', updated_at
  ), NULL
FROM library_actors
UNION ALL
SELECT '91_actor_capability', json_quote(capability_id),
  json_object(
    'actorClass', actor_class,
    'actorId', actor_id,
    'canonicalCertificate', canonical_certificate,
    'certificateDigest', certificate_digest,
    'certificateVersion', certificate_version,
    'issuanceIdentity', issuance_identity,
    'issuedAt', issued_at,
    'retiredAt', retired_at,
    'retirementCertificateDigest', retirement_certificate_digest,
    'retirementIdentity', retirement_identity,
    'scopeId', scope_id,
    'scopeKind', scope_kind,
    'scopeMode', scope_mode
  ), NULL
FROM library_actor_capabilities
UNION ALL
SELECT '92_actor_capability_mutation', json_array(capability_id, mutation_id),
  json_object('mutationId', mutation_id), NULL
FROM library_actor_capability_mutations
UNION ALL
SELECT 'a0_receipt', json_array(actor_id, operation_id),
  json_object('acceptedAt', accepted_at, 'digest', digest, 'resultBlobDigest', result_blob_digest, 'resultText', result_text, 'status', status), NULL
FROM library_receipts
UNION ALL
SELECT 'b0_blob_descriptor', json_quote(content_digest),
  json_object('blobContentDigest', content_digest, 'byteLength', byte_length, 'chunkBytes', chunk_bytes, 'chunkCount', chunk_count, 'mediaType', media_type), NULL
FROM library_blobs
UNION ALL
SELECT 'b1_content_chunk', json_array(content_digest, chunk_index),
  json_object('blobContentDigest', content_digest, 'byteLength', length(bytes), 'bytesBase64', NULL, 'chunkContentDigest', chunk_digest, 'chunkIndex', chunk_index), bytes
FROM library_blob_chunks;
