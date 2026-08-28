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

CREATE TABLE IF NOT EXISTS library_local_cloud_writer_admission (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  local_writer_id TEXT NOT NULL CHECK (length(local_writer_id) = 64),
  active_writer_id TEXT NOT NULL CHECK (length(active_writer_id) = 64),
  authority_epoch_id TEXT NOT NULL CHECK (length(authority_epoch_id) = 64),
  control_revision TEXT NOT NULL CHECK (
    length(control_revision) BETWEEN 1 AND 512
  ),
  verified_at INTEGER NOT NULL CHECK (verified_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_materialization_generation (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  generation_id TEXT NOT NULL CHECK (length(generation_id) = 64 AND generation_id NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TABLE IF NOT EXISTS library_storage_transition_plan (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  candidate_json TEXT NOT NULL CHECK (length(CAST(candidate_json AS BLOB)) BETWEEN 1 AND 65536),
  candidate_digest TEXT NOT NULL CHECK (length(candidate_digest) = 64 AND candidate_digest NOT GLOB '*[^0-9a-f]*'),
  installation_witness TEXT CHECK (installation_witness IS NULL OR (length(installation_witness) = 64 AND installation_witness NOT GLOB '*[^0-9a-f]*')),
  accepted_at INTEGER CHECK (accepted_at IS NULL OR accepted_at >= 0),
  state TEXT NOT NULL CHECK (state IN ('candidate', 'authority_installed', 'actor_installed')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK ((installation_witness IS NULL) = (accepted_at IS NULL))
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

CREATE TABLE IF NOT EXISTS library_follower_checkpoint_receipt (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  authority_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  writer_actor_id TEXT NOT NULL REFERENCES library_actors(actor_id),
  checkpoint_generation INTEGER NOT NULL CHECK (checkpoint_generation >= 0),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  checkpoint_digest TEXT NOT NULL CHECK (length(checkpoint_digest) = 64 AND checkpoint_digest NOT GLOB '*[^0-9a-f]*'),
  manifest_object_key TEXT NOT NULL CHECK (length(CAST(manifest_object_key AS BLOB)) BETWEEN 1 AND 1024),
  manifest_transport_object_id TEXT NOT NULL CHECK (length(CAST(manifest_transport_object_id AS BLOB)) BETWEEN 1 AND 1024),
  manifest_content_digest TEXT NOT NULL CHECK (length(manifest_content_digest) = 64 AND manifest_content_digest NOT GLOB '*[^0-9a-f]*'),
  control_revision TEXT NOT NULL CHECK (length(CAST(control_revision AS BLOB)) BETWEEN 1 AND 1024),
  installed_at INTEGER NOT NULL CHECK (installed_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_follower_actor_request (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  authority_epoch_id TEXT NOT NULL CHECK (length(CAST(authority_epoch_id AS BLOB)) BETWEEN 1 AND 255),
  actor_id TEXT NOT NULL CHECK (length(actor_id) = 64 AND actor_id NOT GLOB '*[^0-9a-f]*'),
  actor_public_key TEXT NOT NULL CHECK (length(actor_public_key) = 64 AND actor_public_key NOT GLOB '*[^0-9a-f]*'),
  enrollment_request_digest TEXT NOT NULL CHECK (length(enrollment_request_digest) = 64 AND enrollment_request_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_enrollment_request TEXT NOT NULL CHECK (length(CAST(canonical_enrollment_request AS BLOB)) BETWEEN 1 AND 65536),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  enrollment_certificate_digest TEXT CHECK (enrollment_certificate_digest IS NULL OR (length(enrollment_certificate_digest) = 64 AND enrollment_certificate_digest NOT GLOB '*[^0-9a-f]*')),
  canonical_enrollment_certificate TEXT CHECK (canonical_enrollment_certificate IS NULL OR length(CAST(canonical_enrollment_certificate AS BLOB)) BETWEEN 1 AND 65536),
  actor_chain_genesis TEXT CHECK (actor_chain_genesis IS NULL OR (length(actor_chain_genesis) = 64 AND actor_chain_genesis NOT GLOB '*[^0-9a-f]*')),
  enrolled_at INTEGER CHECK (enrolled_at IS NULL OR enrolled_at >= created_at),
  CHECK (
    (enrollment_certificate_digest IS NULL AND canonical_enrollment_certificate IS NULL AND actor_chain_genesis IS NULL AND enrolled_at IS NULL)
    OR
    (enrollment_certificate_digest IS NOT NULL AND canonical_enrollment_certificate IS NOT NULL AND actor_chain_genesis IS NOT NULL AND enrolled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_blobs (
  content_digest TEXT PRIMARY KEY CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 0 AND 9007199254740991),
  storage_layout TEXT NOT NULL DEFAULT 'inline_chunks' CHECK (storage_layout IN ('inline_chunks', 'authenticated_ranges')),
  chunk_bytes INTEGER NOT NULL CHECK (chunk_bytes IN (0, 65536)),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 0 AND 9007199254740991),
  range_count INTEGER NOT NULL DEFAULT 0 CHECK (range_count BETWEEN 0 AND 9007199254740991),
  range_granularity INTEGER CHECK (range_granularity IS NULL OR range_granularity BETWEEN 1 AND 9007199254740991),
  range_index_root_digest TEXT CHECK (range_index_root_digest IS NULL OR (length(range_index_root_digest) = 64 AND range_index_root_digest NOT GLOB '*[^0-9a-f]*')),
  rendition_id TEXT CHECK (rendition_id IS NULL OR length(CAST(rendition_id AS BLOB)) BETWEEN 1 AND 255),
  encoding TEXT CHECK (encoding IS NULL OR length(CAST(encoding AS BLOB)) BETWEEN 1 AND 255),
  cloud_availability_commitment TEXT CHECK (cloud_availability_commitment IS NULL OR (length(cloud_availability_commitment) = 64 AND cloud_availability_commitment NOT GLOB '*[^0-9a-f]*')),
  media_type TEXT NOT NULL CHECK (length(CAST(media_type AS BLOB)) BETWEEN 1 AND 255),
  CHECK (
    (storage_layout = 'inline_chunks' AND chunk_bytes = 65536 AND range_count = 0 AND range_granularity IS NULL AND range_index_root_digest IS NULL AND rendition_id IS NULL AND cloud_availability_commitment IS NULL)
    OR
    (storage_layout = 'authenticated_ranges' AND chunk_bytes = 0 AND chunk_count = 0 AND range_count >= 1 AND range_granularity IS NOT NULL AND range_index_root_digest IS NOT NULL AND rendition_id IS NOT NULL AND cloud_availability_commitment IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS library_blob_chunks (
  content_digest TEXT NOT NULL REFERENCES library_blobs(content_digest) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_digest TEXT NOT NULL CHECK (length(chunk_digest) = 64 AND chunk_digest NOT GLOB '*[^0-9a-f]*'),
  bytes BLOB NOT NULL CHECK (length(bytes) BETWEEN 0 AND 65536),
  PRIMARY KEY (content_digest, chunk_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_content_ranges (
  content_digest TEXT NOT NULL REFERENCES library_blobs(content_digest) ON DELETE CASCADE,
  range_index INTEGER NOT NULL CHECK (range_index BETWEEN 0 AND 9007199254740991),
  byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 1),
  range_digest TEXT NOT NULL CHECK (length(range_digest) = 64 AND range_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (content_digest, range_index),
  UNIQUE (content_digest, byte_offset),
  CHECK (byte_offset <= 9007199254740991 - byte_length)
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
  priority REAL CHECK (priority IS NULL OR (priority >= 0 AND priority <= 100)),
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
CREATE INDEX IF NOT EXISTS library_feed_items_browse_rank_all
  ON library_feed_items(
    archived,
    CAST(round(COALESCE(priority, 0)) AS INTEGER) DESC,
    published_at DESC,
    global_id
  );
CREATE INDEX IF NOT EXISTS library_feed_items_saved
  ON library_feed_items(saved, archived, saved_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_saved_date_saved
  ON library_feed_items(
    saved,
    archived,
    hidden,
    COALESCE(saved_at, captured_at) DESC,
    global_id
  );
CREATE INDEX IF NOT EXISTS library_feed_items_saved_date_published
  ON library_feed_items(
    saved,
    archived,
    hidden,
    CASE published_at WHEN 0 THEN captured_at ELSE published_at END DESC,
    global_id
  );
CREATE INDEX IF NOT EXISTS library_feed_items_saved_recommended
  ON library_feed_items(
    saved,
    archived,
    hidden,
    CAST(round(COALESCE(priority, 0)) AS INTEGER) DESC,
    published_at DESC,
    global_id
  );
CREATE INDEX IF NOT EXISTS library_feed_items_saved_shortest_read
  ON library_feed_items(
    saved,
    archived,
    hidden,
    CASE WHEN preserved_reading_time >= 0 THEN 1 ELSE 0 END DESC,
    CASE WHEN preserved_reading_time >= 0 THEN preserved_reading_time ELSE 0 END,
    global_id
  );
CREATE INDEX IF NOT EXISTS library_feed_items_author
  ON library_feed_items(author_id, published_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_provider_author
  ON library_feed_items(platform, author_id, hidden, published_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_platform
  ON library_feed_items(platform, published_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_platform_captured
  ON library_feed_items(platform, captured_at DESC, global_id);
CREATE INDEX IF NOT EXISTS library_feed_items_rss_feed
  ON library_feed_items(rss_feed_url, hidden, published_at DESC, global_id)
  WHERE rss_feed_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS library_feed_items_content_fetch
  ON library_feed_items(published_at DESC, global_id)
  WHERE link_url IS NOT NULL
    AND link_url <> ''
    AND (preserved_text IS NULL OR preserved_text = '')
    AND preserved_text_blob_digest IS NULL;

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

CREATE TABLE IF NOT EXISTS library_facet_summary (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  archived_count INTEGER NOT NULL CHECK (archived_count >= 0),
  unread_count INTEGER NOT NULL CHECK (unread_count >= 0),
  archivable_count INTEGER NOT NULL CHECK (archivable_count >= 0),
  sample_item_count INTEGER NOT NULL CHECK (sample_item_count >= 0),
  sample_feed_count INTEGER NOT NULL CHECK (sample_feed_count >= 0),
  sample_person_count INTEGER NOT NULL CHECK (sample_person_count >= 0),
  sample_account_count INTEGER NOT NULL CHECK (sample_account_count >= 0),
  rss_feed_count INTEGER NOT NULL DEFAULT 0 CHECK (rss_feed_count >= 0),
  enabled_rss_feed_count INTEGER NOT NULL DEFAULT 0 CHECK (enabled_rss_feed_count >= 0),
  friend_person_count INTEGER NOT NULL DEFAULT 0 CHECK (friend_person_count >= 0),
  social_account_count INTEGER NOT NULL DEFAULT 0 CHECK (social_account_count >= 0),
  saved_count INTEGER NOT NULL CHECK (saved_count >= 0),
  saved_archived_count INTEGER NOT NULL CHECK (saved_archived_count >= 0)
) STRICT;

INSERT OR IGNORE INTO library_facet_summary
  (singleton_id, total_count, archived_count, unread_count, archivable_count,
   sample_item_count, sample_feed_count, sample_person_count,
   sample_account_count, saved_count, saved_archived_count)
VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

CREATE TABLE IF NOT EXISTS library_platform_counts (
  platform TEXT PRIMARY KEY,
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  unread_count INTEGER NOT NULL CHECK (unread_count >= 0),
  archivable_count INTEGER NOT NULL CHECK (archivable_count >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_saved_platform_counts (
  platform TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL CHECK (item_count >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_tag_counts (
  tag TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL CHECK (item_count >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_author_activity (
  platform TEXT NOT NULL,
  author_id TEXT NOT NULL,
  visible_count INTEGER NOT NULL CHECK (visible_count >= 0),
  latest_published_at INTEGER NOT NULL CHECK (latest_published_at >= 0),
  PRIMARY KEY (platform, author_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS library_feed_item_facet_insert
AFTER INSERT ON library_feed_items
BEGIN
  UPDATE library_facet_summary SET
    total_count = total_count + 1,
    archived_count = archived_count + (NEW.archived = 1),
    unread_count = unread_count + (NEW.read_at IS NULL),
    archivable_count = archivable_count + (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0),
    sample_item_count = sample_item_count + (NEW.sample_batch_id IS NOT NULL),
    saved_count = saved_count + (NEW.saved = 1),
    saved_archived_count = saved_archived_count + (NEW.saved = 1 AND NEW.archived = 1)
  WHERE singleton_id = 1;
  INSERT INTO library_platform_counts
    (platform, total_count, unread_count, archivable_count)
  VALUES (
    NEW.platform,
    1,
    (NEW.read_at IS NULL),
    (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0)
  )
  ON CONFLICT(platform) DO UPDATE SET
    total_count = total_count + 1,
    unread_count = unread_count + (NEW.read_at IS NULL),
    archivable_count = archivable_count + (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0);
  INSERT INTO library_saved_platform_counts (platform, item_count)
    SELECT NEW.platform, 1 WHERE NEW.saved = 1
    ON CONFLICT(platform) DO UPDATE SET item_count = item_count + 1;
  INSERT INTO library_author_activity
    (platform, author_id, visible_count, latest_published_at)
    SELECT NEW.platform, NEW.author_id, 1, NEW.published_at
    WHERE NEW.hidden = 0
    ON CONFLICT(platform, author_id) DO UPDATE SET
      visible_count = visible_count + 1,
      latest_published_at = max(latest_published_at, NEW.published_at);
END;

CREATE TRIGGER IF NOT EXISTS library_feed_item_facet_delete
AFTER DELETE ON library_feed_items
BEGIN
  UPDATE library_facet_summary SET
    total_count = total_count - 1,
    archived_count = archived_count - (OLD.archived = 1),
    unread_count = unread_count - (OLD.read_at IS NULL),
    archivable_count = archivable_count - (OLD.hidden = 0 AND OLD.archived = 0 AND OLD.read_at IS NOT NULL AND OLD.saved = 0),
    sample_item_count = sample_item_count - (OLD.sample_batch_id IS NOT NULL),
    saved_count = saved_count - (OLD.saved = 1),
    saved_archived_count = saved_archived_count - (OLD.saved = 1 AND OLD.archived = 1)
  WHERE singleton_id = 1;
  UPDATE library_platform_counts SET
    total_count = total_count - 1,
    unread_count = unread_count - (OLD.read_at IS NULL),
    archivable_count = archivable_count - (OLD.hidden = 0 AND OLD.archived = 0 AND OLD.read_at IS NOT NULL AND OLD.saved = 0)
  WHERE platform = OLD.platform;
  DELETE FROM library_platform_counts WHERE total_count = 0;
  UPDATE library_saved_platform_counts SET item_count = item_count - 1
    WHERE OLD.saved = 1 AND platform = OLD.platform;
  DELETE FROM library_saved_platform_counts WHERE item_count = 0;
  UPDATE library_author_activity SET
    visible_count = visible_count - 1,
    latest_published_at = COALESCE((
      SELECT max(item.published_at)
      FROM library_feed_items AS item
      WHERE item.platform = OLD.platform
        AND item.author_id = OLD.author_id
        AND item.hidden = 0
    ), 0)
  WHERE OLD.hidden = 0
    AND platform = OLD.platform
    AND author_id = OLD.author_id;
  DELETE FROM library_author_activity WHERE visible_count = 0;
END;

CREATE TRIGGER IF NOT EXISTS library_feed_item_facet_update
AFTER UPDATE OF archived, hidden, read_at, saved, platform, author_id, published_at, sample_batch_id ON library_feed_items
BEGIN
  UPDATE library_facet_summary SET
    archived_count = archived_count + (NEW.archived = 1) - (OLD.archived = 1),
    unread_count = unread_count + (NEW.read_at IS NULL) - (OLD.read_at IS NULL),
    archivable_count = archivable_count + (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0) - (OLD.hidden = 0 AND OLD.archived = 0 AND OLD.read_at IS NOT NULL AND OLD.saved = 0),
    sample_item_count = sample_item_count + (NEW.sample_batch_id IS NOT NULL) - (OLD.sample_batch_id IS NOT NULL),
    saved_count = saved_count + (NEW.saved = 1) - (OLD.saved = 1),
    saved_archived_count = saved_archived_count + (NEW.saved = 1 AND NEW.archived = 1) - (OLD.saved = 1 AND OLD.archived = 1)
  WHERE singleton_id = 1;
  UPDATE library_platform_counts SET
    total_count = total_count - 1,
    unread_count = unread_count - (OLD.read_at IS NULL),
    archivable_count = archivable_count - (OLD.hidden = 0 AND OLD.archived = 0 AND OLD.read_at IS NOT NULL AND OLD.saved = 0)
  WHERE platform = OLD.platform;
  INSERT INTO library_platform_counts
    (platform, total_count, unread_count, archivable_count)
  VALUES (
    NEW.platform,
    1,
    (NEW.read_at IS NULL),
    (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0)
  )
  ON CONFLICT(platform) DO UPDATE SET
    total_count = total_count + 1,
    unread_count = unread_count + (NEW.read_at IS NULL),
    archivable_count = archivable_count + (NEW.hidden = 0 AND NEW.archived = 0 AND NEW.read_at IS NOT NULL AND NEW.saved = 0);
  DELETE FROM library_platform_counts WHERE total_count = 0;
  UPDATE library_saved_platform_counts SET item_count = item_count - 1
    WHERE OLD.saved = 1 AND platform = OLD.platform;
  INSERT INTO library_saved_platform_counts (platform, item_count)
    SELECT NEW.platform, 1 WHERE NEW.saved = 1
    ON CONFLICT(platform) DO UPDATE SET item_count = item_count + 1;
  DELETE FROM library_saved_platform_counts WHERE item_count = 0;
  UPDATE library_author_activity SET
    visible_count = visible_count - 1,
    latest_published_at = COALESCE((
      SELECT max(item.published_at)
      FROM library_feed_items AS item
      WHERE item.platform = OLD.platform
        AND item.author_id = OLD.author_id
        AND item.hidden = 0
    ), 0)
  WHERE OLD.hidden = 0
    AND platform = OLD.platform
    AND author_id = OLD.author_id;
  DELETE FROM library_author_activity WHERE visible_count = 0;
  INSERT INTO library_author_activity
    (platform, author_id, visible_count, latest_published_at)
    SELECT NEW.platform, NEW.author_id, 1, NEW.published_at
    WHERE NEW.hidden = 0
    ON CONFLICT(platform, author_id) DO UPDATE SET
      visible_count = visible_count + 1,
      latest_published_at = max(latest_published_at, NEW.published_at);
END;

CREATE TRIGGER IF NOT EXISTS library_feed_item_tag_facet_insert
AFTER INSERT ON library_feed_item_tags
BEGIN
  INSERT INTO library_tag_counts (tag, item_count) VALUES (NEW.tag, 1)
    ON CONFLICT(tag) DO UPDATE SET item_count = item_count + 1;
END;

CREATE TRIGGER IF NOT EXISTS library_feed_item_tag_facet_delete
AFTER DELETE ON library_feed_item_tags
BEGIN
  UPDATE library_tag_counts SET item_count = item_count - 1 WHERE tag = OLD.tag;
  DELETE FROM library_tag_counts WHERE item_count = 0;
END;

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

CREATE INDEX IF NOT EXISTS library_rss_feeds_enabled_latest
  ON library_rss_feeds(enabled, last_fetched DESC, url);

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

CREATE INDEX IF NOT EXISTS library_persons_picker
  ON library_persons(
    relationship_status DESC,
    name COLLATE NOCASE,
    id COLLATE BINARY
  );

CREATE TABLE IF NOT EXISTS library_person_tags (
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (person_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_person_reach_outs (
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  reach_out_id TEXT NOT NULL CHECK (length(CAST(reach_out_id AS BLOB)) BETWEEN 1 AND 255),
  logged_at INTEGER NOT NULL CHECK (logged_at >= 0),
  channel TEXT,
  notes TEXT,
  PRIMARY KEY (person_id, reach_out_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_person_reach_outs_recent
  ON library_person_reach_outs(person_id, logged_at DESC, reach_out_id);

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
CREATE INDEX IF NOT EXISTS library_accounts_contact_provider_person
  ON library_accounts(provider, kind, person_id, id);
CREATE INDEX IF NOT EXISTS library_accounts_contact_provider_imported
  ON library_accounts(
    provider,
    kind,
    COALESCE(imported_at, last_seen_at, created_at) DESC,
    id
  );
CREATE INDEX IF NOT EXISTS library_accounts_picker_unlinked
  ON library_accounts(
    kind,
    person_id,
    COALESCE(display_name, handle, external_id) COLLATE NOCASE,
    COALESCE(handle, external_id) COLLATE NOCASE,
    provider COLLATE BINARY,
    external_id COLLATE BINARY,
    id COLLATE BINARY
  );

CREATE VIRTUAL TABLE IF NOT EXISTS library_account_picker_fts USING fts5(
  display_name,
  handle,
  provider,
  external_id,
  content = 'library_accounts',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS library_account_picker_fts_insert
AFTER INSERT ON library_accounts
BEGIN
  INSERT INTO library_account_picker_fts
    (rowid, display_name, handle, provider, external_id)
  VALUES (
    NEW.rowid,
    COALESCE(NEW.display_name, NEW.handle, NEW.external_id),
    COALESCE(NEW.handle, NEW.external_id),
    NEW.provider,
    NEW.external_id
  );
END;

CREATE TRIGGER IF NOT EXISTS library_account_picker_fts_delete
AFTER DELETE ON library_accounts
BEGIN
  INSERT INTO library_account_picker_fts
    (library_account_picker_fts, rowid, display_name, handle, provider, external_id)
  VALUES (
    'delete',
    OLD.rowid,
    COALESCE(OLD.display_name, OLD.handle, OLD.external_id),
    COALESCE(OLD.handle, OLD.external_id),
    OLD.provider,
    OLD.external_id
  );
END;

CREATE TRIGGER IF NOT EXISTS library_account_picker_fts_update
AFTER UPDATE OF display_name, handle, provider, external_id ON library_accounts
BEGIN
  INSERT INTO library_account_picker_fts
    (library_account_picker_fts, rowid, display_name, handle, provider, external_id)
  VALUES (
    'delete',
    OLD.rowid,
    COALESCE(OLD.display_name, OLD.handle, OLD.external_id),
    COALESCE(OLD.handle, OLD.external_id),
    OLD.provider,
    OLD.external_id
  );
  INSERT INTO library_account_picker_fts
    (rowid, display_name, handle, provider, external_id)
  VALUES (
    NEW.rowid,
    COALESCE(NEW.display_name, NEW.handle, NEW.external_id),
    COALESCE(NEW.handle, NEW.external_id),
    NEW.provider,
    NEW.external_id
  );
END;

CREATE TABLE IF NOT EXISTS library_person_contact_match_keys (
  match_value TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  match_rank INTEGER NOT NULL CHECK (match_rank BETWEEN 0 AND 3),
  source_id TEXT NOT NULL,
  PRIMARY KEY (match_value, match_rank, person_id, source_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_person_contact_match_keys_person
  ON library_person_contact_match_keys(person_id, match_value, match_rank);

CREATE TABLE IF NOT EXISTS library_account_contact_match_keys (
  match_value TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES library_accounts(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  match_rank INTEGER NOT NULL CHECK (match_rank BETWEEN 0 AND 1),
  PRIMARY KEY (match_value, match_rank, account_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS library_person_contact_match_insert
AFTER INSERT ON library_persons
BEGIN
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  VALUES (lower(trim(NEW.name)), NEW.id, 'high', 1, 'person:' || NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS library_person_contact_match_update
AFTER UPDATE OF name ON library_persons
BEGIN
  DELETE FROM library_person_contact_match_keys WHERE source_id = 'person:' || NEW.id;
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  VALUES (lower(trim(NEW.name)), NEW.id, 'high', 1, 'person:' || NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS library_account_contact_match_insert
AFTER INSERT ON library_accounts
BEGIN
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(NEW.email)), NEW.person_id, 'high', 0, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.email IS NOT NULL AND trim(NEW.email) <> '';
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(NEW.display_name)), NEW.person_id, 'high', 2, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.kind = 'social'
    AND NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '';
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(replace(replace(replace(NEW.handle, '.', ' '), '_', ' '), '-', ' '))),
         NEW.person_id, 'medium', 3, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.kind = 'social'
    AND NEW.handle IS NOT NULL AND trim(NEW.handle) <> '';
  INSERT OR IGNORE INTO library_account_contact_match_keys
    (match_value, account_id, confidence, match_rank)
  SELECT lower(trim(NEW.display_name)), NEW.id, 'high', 0
  WHERE NEW.person_id IS NULL AND NEW.kind = 'social'
    AND NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '';
  INSERT OR IGNORE INTO library_account_contact_match_keys
    (match_value, account_id, confidence, match_rank)
  SELECT lower(trim(replace(replace(replace(NEW.handle, '.', ' '), '_', ' '), '-', ' '))),
         NEW.id, 'medium', 1
  WHERE NEW.person_id IS NULL AND NEW.kind = 'social'
    AND NEW.handle IS NOT NULL AND trim(NEW.handle) <> '';
END;

CREATE TRIGGER IF NOT EXISTS library_account_contact_match_update
AFTER UPDATE OF person_id, kind, email, display_name, handle ON library_accounts
BEGIN
  DELETE FROM library_person_contact_match_keys WHERE source_id = 'account:' || NEW.id;
  DELETE FROM library_account_contact_match_keys WHERE account_id = NEW.id;
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(NEW.email)), NEW.person_id, 'high', 0, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.email IS NOT NULL AND trim(NEW.email) <> '';
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(NEW.display_name)), NEW.person_id, 'high', 2, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.kind = 'social'
    AND NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '';
  INSERT OR IGNORE INTO library_person_contact_match_keys
    (match_value, person_id, confidence, match_rank, source_id)
  SELECT lower(trim(replace(replace(replace(NEW.handle, '.', ' '), '_', ' '), '-', ' '))),
         NEW.person_id, 'medium', 3, 'account:' || NEW.id
  WHERE NEW.person_id IS NOT NULL AND NEW.kind = 'social'
    AND NEW.handle IS NOT NULL AND trim(NEW.handle) <> '';
  INSERT OR IGNORE INTO library_account_contact_match_keys
    (match_value, account_id, confidence, match_rank)
  SELECT lower(trim(NEW.display_name)), NEW.id, 'high', 0
  WHERE NEW.person_id IS NULL AND NEW.kind = 'social'
    AND NEW.display_name IS NOT NULL AND trim(NEW.display_name) <> '';
  INSERT OR IGNORE INTO library_account_contact_match_keys
    (match_value, account_id, confidence, match_rank)
  SELECT lower(trim(replace(replace(replace(NEW.handle, '.', ' '), '_', ' '), '-', ' '))),
         NEW.id, 'medium', 1
  WHERE NEW.person_id IS NULL AND NEW.kind = 'social'
    AND NEW.handle IS NOT NULL AND trim(NEW.handle) <> '';
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_sample_insert
AFTER INSERT ON library_rss_feeds
WHEN NEW.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_feed_count = sample_feed_count + 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_count_insert
AFTER INSERT ON library_rss_feeds
BEGIN
  UPDATE library_facet_summary SET
    rss_feed_count = rss_feed_count + 1,
    enabled_rss_feed_count = enabled_rss_feed_count + (NEW.enabled = 1)
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_count_delete
AFTER DELETE ON library_rss_feeds
BEGIN
  UPDATE library_facet_summary SET
    rss_feed_count = rss_feed_count - 1,
    enabled_rss_feed_count = enabled_rss_feed_count - (OLD.enabled = 1)
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_count_update
AFTER UPDATE OF enabled ON library_rss_feeds
WHEN NEW.enabled <> OLD.enabled
BEGIN
  UPDATE library_facet_summary SET
    enabled_rss_feed_count = enabled_rss_feed_count + (NEW.enabled = 1) - (OLD.enabled = 1)
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_sample_delete
AFTER DELETE ON library_rss_feeds
WHEN OLD.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_feed_count = sample_feed_count - 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_rss_feed_sample_update
AFTER UPDATE OF sample_batch_id ON library_rss_feeds
WHEN (NEW.sample_batch_id IS NOT NULL) <> (OLD.sample_batch_id IS NOT NULL)
BEGIN
  UPDATE library_facet_summary SET
    sample_feed_count = sample_feed_count + (NEW.sample_batch_id IS NOT NULL) - (OLD.sample_batch_id IS NOT NULL)
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_sample_insert
AFTER INSERT ON library_persons
WHEN NEW.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_person_count = sample_person_count + 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_friend_count_insert
AFTER INSERT ON library_persons
WHEN NEW.relationship_status = 'friend'
BEGIN
  UPDATE library_facet_summary SET friend_person_count = friend_person_count + 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_friend_count_delete
AFTER DELETE ON library_persons
WHEN OLD.relationship_status = 'friend'
BEGIN
  UPDATE library_facet_summary SET friend_person_count = friend_person_count - 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_friend_count_update
AFTER UPDATE OF relationship_status ON library_persons
WHEN (NEW.relationship_status = 'friend') <> (OLD.relationship_status = 'friend')
BEGIN
  UPDATE library_facet_summary SET
    friend_person_count = friend_person_count + (NEW.relationship_status = 'friend') - (OLD.relationship_status = 'friend')
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_sample_delete
AFTER DELETE ON library_persons
WHEN OLD.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_person_count = sample_person_count - 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_person_sample_update
AFTER UPDATE OF sample_batch_id ON library_persons
WHEN (NEW.sample_batch_id IS NOT NULL) <> (OLD.sample_batch_id IS NOT NULL)
BEGIN
  UPDATE library_facet_summary SET
    sample_person_count = sample_person_count + (NEW.sample_batch_id IS NOT NULL) - (OLD.sample_batch_id IS NOT NULL)
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_sample_insert
AFTER INSERT ON library_accounts
WHEN NEW.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_account_count = sample_account_count + 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_social_count_insert
AFTER INSERT ON library_accounts
WHEN NEW.kind = 'social'
BEGIN
  UPDATE library_facet_summary SET social_account_count = social_account_count + 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_social_count_delete
AFTER DELETE ON library_accounts
WHEN OLD.kind = 'social'
BEGIN
  UPDATE library_facet_summary SET social_account_count = social_account_count - 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_social_count_update
AFTER UPDATE OF kind ON library_accounts
WHEN (NEW.kind = 'social') <> (OLD.kind = 'social')
BEGIN
  UPDATE library_facet_summary SET
    social_account_count = social_account_count + (NEW.kind = 'social') - (OLD.kind = 'social')
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_sample_delete
AFTER DELETE ON library_accounts
WHEN OLD.sample_batch_id IS NOT NULL
BEGIN
  UPDATE library_facet_summary SET sample_account_count = sample_account_count - 1
  WHERE singleton_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS library_account_sample_update
AFTER UPDATE OF sample_batch_id ON library_accounts
WHEN (NEW.sample_batch_id IS NOT NULL) <> (OLD.sample_batch_id IS NOT NULL)
BEGIN
  UPDATE library_facet_summary SET
    sample_account_count = sample_account_count + (NEW.sample_batch_id IS NOT NULL) - (OLD.sample_batch_id IS NOT NULL)
  WHERE singleton_id = 1;
END;

CREATE TABLE IF NOT EXISTS library_person_feed_items (
  person_id TEXT NOT NULL REFERENCES library_persons(id) ON DELETE CASCADE,
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  global_id TEXT NOT NULL REFERENCES library_feed_items(global_id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, published_at DESC, global_id)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS library_person_feed_items_identity
  ON library_person_feed_items(person_id, global_id);

CREATE TRIGGER IF NOT EXISTS library_person_feed_item_insert
AFTER INSERT ON library_feed_items
BEGIN
  INSERT OR IGNORE INTO library_person_feed_items (person_id, published_at, global_id)
    SELECT account.person_id, NEW.published_at, NEW.global_id
    FROM library_accounts AS account
    WHERE account.person_id IS NOT NULL
      AND account.provider = NEW.platform
      AND account.external_id = NEW.author_id;
END;

CREATE TRIGGER IF NOT EXISTS library_person_feed_item_update
AFTER UPDATE OF platform, author_id, published_at ON library_feed_items
BEGIN
  DELETE FROM library_person_feed_items WHERE global_id = OLD.global_id;
  INSERT OR IGNORE INTO library_person_feed_items (person_id, published_at, global_id)
    SELECT account.person_id, NEW.published_at, NEW.global_id
    FROM library_accounts AS account
    WHERE account.person_id IS NOT NULL
      AND account.provider = NEW.platform
      AND account.external_id = NEW.author_id;
END;

CREATE TRIGGER IF NOT EXISTS library_person_feed_account_insert
AFTER INSERT ON library_accounts
WHEN NEW.person_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO library_person_feed_items (person_id, published_at, global_id)
    SELECT NEW.person_id, item.published_at, item.global_id
    FROM library_feed_items AS item
    WHERE item.platform = NEW.provider AND item.author_id = NEW.external_id;
END;

CREATE TRIGGER IF NOT EXISTS library_person_feed_account_update
AFTER UPDATE OF person_id, provider, external_id ON library_accounts
BEGIN
  DELETE FROM library_person_feed_items
    WHERE person_id = OLD.person_id
      AND global_id IN (
        SELECT item.global_id FROM library_feed_items AS item
        WHERE item.platform = OLD.provider AND item.author_id = OLD.external_id
      );
  INSERT OR IGNORE INTO library_person_feed_items (person_id, published_at, global_id)
    SELECT NEW.person_id, item.published_at, item.global_id
    FROM library_feed_items AS item
    WHERE NEW.person_id IS NOT NULL
      AND item.platform = NEW.provider
      AND item.author_id = NEW.external_id;
END;

CREATE TRIGGER IF NOT EXISTS library_person_feed_account_delete
AFTER DELETE ON library_accounts
WHEN OLD.person_id IS NOT NULL
BEGIN
  DELETE FROM library_person_feed_items
    WHERE person_id = OLD.person_id
      AND global_id IN (
        SELECT item.global_id FROM library_feed_items AS item
        WHERE item.platform = OLD.provider AND item.author_id = OLD.external_id
      );
END;

CREATE TABLE IF NOT EXISTS library_device_person_graph_layout (
  person_id TEXT PRIMARY KEY REFERENCES library_persons(id) ON DELETE CASCADE,
  graph_x REAL NOT NULL,
  graph_y REAL NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (graph_x = graph_x AND abs(graph_x) <= 1000000000),
  CHECK (graph_y = graph_y AND abs(graph_y) <= 1000000000)
) STRICT;

CREATE TABLE IF NOT EXISTS library_device_graph_layout_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT OR IGNORE INTO library_device_graph_layout_state (singleton_id, revision)
VALUES (1, 0);

CREATE TABLE IF NOT EXISTS library_device_contact_generations (
  generation_id TEXT PRIMARY KEY CHECK (length(CAST(generation_id AS BLOB)) BETWEEN 1 AND 255),
  state TEXT NOT NULL CHECK (state IN ('building', 'active')),
  expected_contact_count INTEGER NOT NULL CHECK (expected_contact_count >= 0),
  staged_contact_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_contact_count >= 0),
  matched_contact_count INTEGER NOT NULL DEFAULT 0 CHECK (matched_contact_count >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  activated_at INTEGER CHECK (activated_at IS NULL OR activated_at >= created_at),
  CHECK ((state = 'active') = (activated_at IS NOT NULL)),
  CHECK (
    state <> 'active'
    OR (
      expected_contact_count = staged_contact_count
      AND staged_contact_count = matched_contact_count
    )
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS library_device_contact_one_active_generation
  ON library_device_contact_generations(state)
  WHERE state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS library_device_contact_one_building_generation
  ON library_device_contact_generations(state)
  WHERE state = 'building';

CREATE TABLE IF NOT EXISTS library_device_contact_sync_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  active_generation_id TEXT REFERENCES library_device_contact_generations(generation_id),
  auth_status TEXT NOT NULL CHECK (auth_status IN ('connected', 'reconnect_required')),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_started_at INTEGER CHECK (sync_started_at IS NULL OR sync_started_at >= 0),
  sync_token TEXT CHECK (sync_token IS NULL OR length(CAST(sync_token AS BLOB)) <= 65536),
  last_synced_at INTEGER CHECK (last_synced_at IS NULL OR last_synced_at >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN ('missing_token', 'auth', 'network', 'unknown')),
  last_error_message TEXT CHECK (last_error_message IS NULL OR length(CAST(last_error_message AS BLOB)) <= 4096),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK ((sync_status = 'syncing') = (sync_started_at IS NOT NULL)),
  CHECK ((last_error_code IS NULL) = (last_error_message IS NULL))
) STRICT;

INSERT OR IGNORE INTO library_device_contact_sync_state (
  singleton_id,
  revision,
  active_generation_id,
  auth_status,
  sync_status,
  sync_started_at,
  sync_token,
  last_synced_at,
  last_error_code,
  last_error_message,
  updated_at
) VALUES (1, 0, NULL, 'connected', 'idle', NULL, NULL, NULL, NULL, NULL, 0);

CREATE TABLE IF NOT EXISTS library_device_contacts (
  generation_id TEXT NOT NULL REFERENCES library_device_contact_generations(generation_id) ON DELETE CASCADE,
  resource_name TEXT NOT NULL CHECK (length(CAST(resource_name AS BLOB)) BETWEEN 1 AND 1024),
  etag TEXT CHECK (etag IS NULL OR length(CAST(etag AS BLOB)) <= 2048),
  display_name TEXT CHECK (display_name IS NULL OR length(CAST(display_name AS BLOB)) <= 2048),
  given_name TEXT CHECK (given_name IS NULL OR length(CAST(given_name AS BLOB)) <= 2048),
  family_name TEXT CHECK (family_name IS NULL OR length(CAST(family_name AS BLOB)) <= 2048),
  middle_name TEXT CHECK (middle_name IS NULL OR length(CAST(middle_name AS BLOB)) <= 2048),
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (generation_id, resource_name)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_device_contacts_review_order
  ON library_device_contacts(generation_id, display_name, resource_name)
  WHERE deleted = 0;

CREATE TABLE IF NOT EXISTS library_device_contact_delta_receipts (
  generation_id TEXT NOT NULL REFERENCES library_device_contact_generations(generation_id) ON DELETE CASCADE,
  batch_ordinal INTEGER NOT NULL CHECK (batch_ordinal >= 0),
  batch_digest TEXT NOT NULL CHECK (length(batch_digest) = 64 AND batch_digest NOT GLOB '*[^0-9a-f]*'),
  applied_at INTEGER NOT NULL CHECK (applied_at >= 0),
  PRIMARY KEY (generation_id, batch_ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_emails (
  generation_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 15),
  value TEXT NOT NULL CHECK (length(CAST(value AS BLOB)) BETWEEN 1 AND 2048),
  type_value TEXT CHECK (type_value IS NULL OR length(CAST(type_value AS BLOB)) <= 255),
  PRIMARY KEY (generation_id, resource_name, ordinal),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_phones (
  generation_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 15),
  value TEXT NOT NULL CHECK (length(CAST(value AS BLOB)) BETWEEN 1 AND 2048),
  type_value TEXT CHECK (type_value IS NULL OR length(CAST(type_value AS BLOB)) <= 255),
  PRIMARY KEY (generation_id, resource_name, ordinal),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_photos (
  generation_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  url TEXT NOT NULL CHECK (length(CAST(url AS BLOB)) BETWEEN 1 AND 8192),
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  PRIMARY KEY (generation_id, resource_name, ordinal),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_organizations (
  generation_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  name TEXT CHECK (name IS NULL OR length(CAST(name AS BLOB)) <= 1024),
  title TEXT CHECK (title IS NULL OR length(CAST(title AS BLOB)) <= 1024),
  PRIMARY KEY (generation_id, resource_name, ordinal),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE,
  CHECK (name IS NOT NULL OR title IS NOT NULL)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_suggestions (
  generation_id TEXT NOT NULL REFERENCES library_device_contact_generations(generation_id) ON DELETE CASCADE,
  suggestion_id TEXT NOT NULL CHECK (length(CAST(suggestion_id AS BLOB)) BETWEEN 1 AND 8192),
  resource_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('merge_accounts', 'attach_accounts_to_person')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  person_id TEXT REFERENCES library_persons(id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK (length(CAST(label AS BLOB)) BETWEEN 1 AND 2048),
  reason TEXT CHECK (reason IS NULL OR length(CAST(reason AS BLOB)) <= 4096),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  dismissed_at INTEGER CHECK (dismissed_at IS NULL OR dismissed_at >= created_at),
  PRIMARY KEY (generation_id, suggestion_id),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_device_contact_suggestions_review_order
  ON library_device_contact_suggestions(generation_id, dismissed_at, confidence, created_at, suggestion_id);

CREATE TABLE IF NOT EXISTS library_device_contact_match_receipts (
  generation_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64 AND result_digest NOT GLOB '*[^0-9a-f]*'),
  matched_at INTEGER NOT NULL CHECK (matched_at >= 0),
  PRIMARY KEY (generation_id, resource_name),
  FOREIGN KEY (generation_id, resource_name)
    REFERENCES library_device_contacts(generation_id, resource_name) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_contact_suggestion_accounts (
  generation_id TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 63),
  account_id TEXT NOT NULL CHECK (length(CAST(account_id AS BLOB)) BETWEEN 1 AND 1024),
  PRIMARY KEY (generation_id, suggestion_id, ordinal),
  UNIQUE (generation_id, suggestion_id, account_id),
  FOREIGN KEY (generation_id, suggestion_id)
    REFERENCES library_device_contact_suggestions(generation_id, suggestion_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_content_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT OR IGNORE INTO library_device_content_state (singleton_id, revision)
VALUES (1, 0);

CREATE TABLE IF NOT EXISTS library_device_content_policies (
  content_digest TEXT PRIMARY KEY CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  policy TEXT NOT NULL CHECK (policy IN (
    'metadata_only',
    'stream_on_demand',
    'partial_cache',
    'complete_cache',
    'pinned_offline',
    'excluded'
  )),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_device_content_availability (
  content_digest TEXT PRIMARY KEY CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  hydration_state TEXT NOT NULL CHECK (hydration_state IN (
    'metadata_only',
    'streamable',
    'partially_cached',
    'fully_cached',
    'pinned_offline',
    'excluded',
    'unavailable',
    'corrupt'
  )),
  verified_bytes INTEGER NOT NULL CHECK (verified_bytes >= 0),
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('none', 'content_vault', 'opfs')),
  complete_digest_verified_at INTEGER CHECK (complete_digest_verified_at IS NULL OR complete_digest_verified_at >= 0),
  last_accessed_at INTEGER NOT NULL DEFAULT 0 CHECK (last_accessed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (hydration_state NOT IN ('fully_cached', 'pinned_offline') OR storage_kind != 'none'),
  CHECK ((hydration_state IN ('fully_cached', 'pinned_offline')) = (complete_digest_verified_at IS NOT NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS library_device_content_availability_lru
  ON library_device_content_availability(last_accessed_at, content_digest)
  WHERE verified_bytes > 0;

CREATE INDEX IF NOT EXISTS library_device_content_policies_hydration_queue
  ON library_device_content_policies(policy DESC, updated_at, content_digest)
  WHERE policy IN ('complete_cache', 'pinned_offline');

CREATE TABLE IF NOT EXISTS library_device_content_ranges (
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  range_index INTEGER NOT NULL CHECK (range_index BETWEEN 0 AND 9007199254740991),
  verified_byte_length INTEGER NOT NULL CHECK (verified_byte_length BETWEEN 1 AND 9007199254740991),
  verified_range_digest TEXT NOT NULL CHECK (length(verified_range_digest) = 64 AND verified_range_digest NOT GLOB '*[^0-9a-f]*'),
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('content_vault', 'opfs')),
  storage_key TEXT NOT NULL CHECK (length(CAST(storage_key AS BLOB)) BETWEEN 1 AND 1024),
  verified_at INTEGER NOT NULL CHECK (verified_at >= 0),
  PRIMARY KEY (content_digest, range_index)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS library_device_content_ranges_storage_key
  ON library_device_content_ranges(storage_kind, storage_key);

CREATE TABLE IF NOT EXISTS library_device_scope_actions (
  action_id TEXT PRIMARY KEY CHECK (length(CAST(action_id AS BLOB)) BETWEEN 1 AND 255),
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'archive',
    'read',
    'rss_feeds_heal_untitled_frozen',
    'rss_feeds_remove_keep_items',
    'rss_feeds_remove_with_items'
  )),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64 AND request_digest = lower(request_digest)),
  state TEXT NOT NULL CHECK (state IN ('staging', 'ready')),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS library_device_scope_action_members (
  action_id TEXT NOT NULL REFERENCES library_device_scope_actions(action_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  entity_id TEXT NOT NULL CHECK (length(CAST(entity_id AS BLOB)) BETWEEN 1 AND 4096),
  PRIMARY KEY (action_id, ordinal),
  UNIQUE (action_id, entity_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_device_account_graph_layout (
  account_id TEXT PRIMARY KEY REFERENCES library_accounts(id) ON DELETE CASCADE,
  graph_x REAL NOT NULL,
  graph_y REAL NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (graph_x = graph_x AND abs(graph_x) <= 1000000000),
  CHECK (graph_y = graph_y AND abs(graph_y) <= 1000000000)
) STRICT;

CREATE TABLE IF NOT EXISTS library_account_follow_roles (
  account_id TEXT NOT NULL REFERENCES library_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (account_id, role)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_preferences (
  path TEXT PRIMARY KEY CHECK (
    length(CAST(path AS BLOB)) BETWEEN 4 AND 4096
    AND substr(path, 1, 2) IN ('a:', 'o:', 'v:')
    AND substr(path, 3, 2) = '$.'
  ),
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'integer', 'real', 'text', 'null')),
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
  integer_value INTEGER,
  real_value REAL,
  text_value TEXT CHECK (text_value IS NULL OR length(CAST(text_value AS BLOB)) <= 8192),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (
    (value_type = 'boolean' AND boolean_value IS NOT NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL) OR
    (value_type = 'integer' AND boolean_value IS NULL AND integer_value IS NOT NULL AND real_value IS NULL AND text_value IS NULL) OR
    (value_type = 'real' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NOT NULL AND text_value IS NULL) OR
    (value_type = 'text' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NOT NULL) OR
    (value_type = 'null' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL)
  ),
  CHECK (substr(path, 1, 2) <> 'a:' OR (value_type = 'integer' AND integer_value >= 0)),
  CHECK (substr(path, 1, 2) <> 'o:' OR value_type = 'null')
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
  certificate_version INTEGER NOT NULL CHECK (certificate_version = 2),
  actor_class TEXT NOT NULL CHECK (actor_class IN ('editor', 'scraper', 'agent')),
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('library_wide', 'bounded')),
  scope_kind TEXT,
  scope_id TEXT,
  issuance_identity TEXT NOT NULL CHECK (length(issuance_identity) = 64 AND issuance_identity NOT GLOB '*[^0-9a-f]*'),
  retirement_identity TEXT NOT NULL CHECK (length(retirement_identity) = 64 AND retirement_identity NOT GLOB '*[^0-9a-f]*'),
  certificate_digest TEXT NOT NULL CHECK (length(certificate_digest) = 64 AND certificate_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_certificate TEXT NOT NULL CHECK (length(CAST(canonical_certificate AS BLOB)) BETWEEN 1 AND 65536),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  retired_at INTEGER,
  retirement_certificate_digest TEXT CHECK (retirement_certificate_digest IS NULL OR (length(retirement_certificate_digest) = 64 AND retirement_certificate_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (scope_mode = 'library_wide' AND scope_kind IS NULL AND scope_id IS NULL)
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

CREATE TABLE IF NOT EXISTS library_follower_result_cursors (
  actor_id TEXT PRIMARY KEY REFERENCES library_actors(actor_id) ON DELETE CASCADE,
  next_result_sequence INTEGER NOT NULL CHECK (next_result_sequence >= 1),
  previous_result_digest TEXT CHECK (previous_result_digest IS NULL OR (length(previous_result_digest) = 64 AND previous_result_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (next_result_sequence = 1 AND previous_result_digest IS NULL)
    OR (next_result_sequence > 1 AND previous_result_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_follower_result_outbox (
  transaction_id TEXT PRIMARY KEY CHECK (length(CAST(transaction_id AS BLOB)) BETWEEN 1 AND 255),
  transaction_digest TEXT NOT NULL CHECK (length(transaction_digest) = 64 AND transaction_digest NOT GLOB '*[^0-9a-f]*'),
  actor_id TEXT NOT NULL REFERENCES library_actors(actor_id),
  authority_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  intent_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  result_sequence INTEGER NOT NULL CHECK (result_sequence >= 1),
  previous_result_digest TEXT CHECK (previous_result_digest IS NULL OR (length(previous_result_digest) = 64 AND previous_result_digest NOT GLOB '*[^0-9a-f]*')),
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64 AND result_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'already_applied')),
  rejection_reason TEXT CHECK (rejection_reason IN ('actor_retired', 'capability_denied', 'epoch_stale', 'precondition_failed', 'target_missing', 'target_tombstoned')),
  original_result_digest TEXT REFERENCES library_follower_result_outbox(result_digest),
  authoritative_source_revision INTEGER NOT NULL CHECK (authoritative_source_revision >= 0),
  canonical_result BLOB NOT NULL CHECK (length(canonical_result) BETWEEN 1 AND 131072),
  enqueued_at INTEGER NOT NULL CHECK (enqueued_at >= 0),
  acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= enqueued_at),
  UNIQUE (actor_id, result_sequence),
  UNIQUE (result_digest),
  CHECK (
    (result_sequence = 1 AND previous_result_digest IS NULL)
    OR (result_sequence > 1 AND previous_result_digest IS NOT NULL)
  ),
  CHECK (
    (status = 'accepted' AND rejection_reason IS NULL AND original_result_digest IS NULL)
    OR (status = 'rejected' AND rejection_reason IS NOT NULL AND original_result_digest IS NULL)
    OR (status = 'already_applied' AND rejection_reason IS NULL AND original_result_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_follower_result_outbox_pending
  ON library_follower_result_outbox(actor_id, result_sequence)
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
  intent_epoch INTEGER NOT NULL CHECK (intent_epoch >= 1),
  intent_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000),
  first_counter INTEGER NOT NULL CHECK (first_counter >= 1),
  last_counter INTEGER NOT NULL CHECK (last_counter = first_counter + member_count - 1),
  previous_operation_id TEXT,
  previous_chain_digest TEXT NOT NULL CHECK (length(previous_chain_digest) = 64 AND previous_chain_digest NOT GLOB '*[^0-9a-f]*'),
  ending_operation_id TEXT NOT NULL,
  ending_chain_digest TEXT NOT NULL CHECK (length(ending_chain_digest) = 64 AND ending_chain_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_member_bytes INTEGER NOT NULL CHECK (canonical_member_bytes BETWEEN 1 AND 4194304),
  canonical_transaction BLOB NOT NULL CHECK (length(canonical_transaction) BETWEEN 1 AND 131072),
  state TEXT NOT NULL CHECK (state IN ('pending', 'published', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  published_at INTEGER,
  resolved_at INTEGER,
  CHECK (
    (first_counter = 1 AND previous_operation_id IS NULL)
    OR (first_counter > 1 AND previous_operation_id IS NOT NULL)
  ),
  CHECK (published_at IS NULL OR published_at >= created_at),
  CHECK (resolved_at IS NULL OR resolved_at >= created_at),
  UNIQUE (transaction_id, actor_id)
) STRICT;

CREATE INDEX IF NOT EXISTS library_intent_transactions_pending
  ON library_intent_transactions(actor_id, first_counter)
  WHERE state IN ('pending', 'published');

CREATE TABLE IF NOT EXISTS library_intent_members (
  transaction_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  member_index INTEGER NOT NULL CHECK (member_index >= 0),
  operation_id TEXT NOT NULL UNIQUE,
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  canonical_member BLOB NOT NULL CHECK (length(canonical_member) BETWEEN 1 AND 131072),
  member_digest TEXT NOT NULL CHECK (length(member_digest) = 64 AND member_digest NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (transaction_id, member_index),
  UNIQUE (actor_id, actor_counter),
  FOREIGN KEY (transaction_id, actor_id)
    REFERENCES library_intent_transactions(transaction_id, actor_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS library_intent_members_actor_page
  ON library_intent_members(actor_id, actor_counter, operation_id, transaction_id);

CREATE TABLE IF NOT EXISTS library_intent_transport_heads (
  actor_id TEXT PRIMARY KEY REFERENCES library_intent_actors(actor_id) ON DELETE CASCADE,
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  storage_epoch_id TEXT NOT NULL CHECK (length(CAST(storage_epoch_id AS BLOB)) BETWEEN 1 AND 255),
  next_actor_counter INTEGER NOT NULL CHECK (next_actor_counter >= 1),
  latest_segment_digest TEXT CHECK (latest_segment_digest IS NULL OR (length(latest_segment_digest) = 64 AND latest_segment_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (next_actor_counter = 1 AND latest_segment_digest IS NULL)
    OR (next_actor_counter > 1 AND latest_segment_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_intent_transport_segments (
  actor_id TEXT NOT NULL REFERENCES library_intent_transport_heads(actor_id) ON DELETE CASCADE,
  first_actor_counter INTEGER NOT NULL CHECK (first_actor_counter >= 1),
  last_actor_counter INTEGER NOT NULL CHECK (last_actor_counter >= first_actor_counter),
  previous_segment_digest TEXT CHECK (previous_segment_digest IS NULL OR (length(previous_segment_digest) = 64 AND previous_segment_digest NOT GLOB '*[^0-9a-f]*')),
  semantic_segment_digest TEXT NOT NULL CHECK (length(semantic_segment_digest) = 64 AND semantic_segment_digest NOT GLOB '*[^0-9a-f]*'),
  stored_segment_digest TEXT NOT NULL CHECK (length(stored_segment_digest) = 64 AND stored_segment_digest NOT GLOB '*[^0-9a-f]*'),
  object_key TEXT NOT NULL CHECK (length(CAST(object_key AS BLOB)) BETWEEN 1 AND 1024),
  transport_object_id TEXT NOT NULL CHECK (length(CAST(transport_object_id AS BLOB)) BETWEEN 1 AND 1024),
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  published_transaction_count INTEGER NOT NULL CHECK (published_transaction_count >= 0),
  PRIMARY KEY (actor_id, first_actor_counter),
  UNIQUE (stored_segment_digest),
  CHECK (
    (first_actor_counter = 1 AND previous_segment_digest IS NULL)
    OR (first_actor_counter > 1 AND previous_segment_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_primary_intent_stage_transactions (
  transaction_id TEXT PRIMARY KEY CHECK (length(CAST(transaction_id AS BLOB)) BETWEEN 1 AND 255),
  transaction_digest TEXT NOT NULL CHECK (length(transaction_digest) = 64 AND transaction_digest NOT GLOB '*[^0-9a-f]*'),
  actor_id TEXT NOT NULL CHECK (length(CAST(actor_id AS BLOB)) BETWEEN 1 AND 255),
  intent_epoch INTEGER NOT NULL CHECK (intent_epoch >= 1),
  intent_epoch_id TEXT NOT NULL CHECK (length(CAST(intent_epoch_id AS BLOB)) BETWEEN 1 AND 255),
  member_count INTEGER NOT NULL CHECK (member_count BETWEEN 1 AND 1000),
  first_counter INTEGER NOT NULL CHECK (first_counter >= 1),
  last_counter INTEGER NOT NULL CHECK (last_counter = first_counter + member_count - 1),
  received_count INTEGER NOT NULL CHECK (received_count BETWEEN 0 AND member_count),
  canonical_member_bytes INTEGER NOT NULL CHECK (canonical_member_bytes BETWEEN 0 AND 4194304),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (transaction_id, actor_id)
) STRICT;

CREATE INDEX IF NOT EXISTS library_primary_intent_stage_complete
  ON library_primary_intent_stage_transactions(updated_at, transaction_id)
  WHERE received_count = member_count;

CREATE TABLE IF NOT EXISTS library_primary_intent_stage_members (
  transaction_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  member_index INTEGER NOT NULL CHECK (member_index BETWEEN 0 AND 999),
  actor_counter INTEGER NOT NULL CHECK (actor_counter >= 1),
  operation_id TEXT NOT NULL CHECK (length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 255),
  canonical_member BLOB NOT NULL CHECK (length(canonical_member) BETWEEN 1 AND 131072),
  PRIMARY KEY (transaction_id, member_index),
  UNIQUE (actor_id, actor_counter),
  FOREIGN KEY (transaction_id, actor_id)
    REFERENCES library_primary_intent_stage_transactions(transaction_id, actor_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_intent_results (
  transaction_id TEXT PRIMARY KEY REFERENCES library_intent_transactions(transaction_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES library_intent_actors(actor_id),
  authority_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  intent_epoch_id TEXT NOT NULL REFERENCES library_authority_epochs(epoch_id),
  result_sequence INTEGER NOT NULL CHECK (result_sequence >= 1),
  previous_result_digest TEXT CHECK (previous_result_digest IS NULL OR (length(previous_result_digest) = 64 AND previous_result_digest NOT GLOB '*[^0-9a-f]*')),
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64 AND result_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'already_applied')),
  authoritative_source_revision INTEGER NOT NULL CHECK (authoritative_source_revision >= 0),
  canonical_result BLOB NOT NULL CHECK (length(canonical_result) BETWEEN 1 AND 131072),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  UNIQUE (actor_id, result_sequence),
  UNIQUE (result_digest),
  CHECK (
    (result_sequence = 1 AND previous_result_digest IS NULL)
    OR (result_sequence > 1 AND previous_result_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_intent_result_cursors (
  actor_id TEXT PRIMARY KEY REFERENCES library_intent_actors(actor_id) ON DELETE CASCADE,
  next_result_sequence INTEGER NOT NULL CHECK (next_result_sequence >= 1),
  previous_result_digest TEXT CHECK (previous_result_digest IS NULL OR (length(previous_result_digest) = 64 AND previous_result_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (next_result_sequence = 1 AND previous_result_digest IS NULL)
    OR (next_result_sequence > 1 AND previous_result_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_result_transport_heads (
  actor_id TEXT PRIMARY KEY REFERENCES library_intent_actors(actor_id) ON DELETE CASCADE,
  library_id TEXT NOT NULL CHECK (length(CAST(library_id AS BLOB)) BETWEEN 1 AND 255),
  storage_epoch_id TEXT NOT NULL CHECK (length(CAST(storage_epoch_id AS BLOB)) BETWEEN 1 AND 255),
  next_result_sequence INTEGER NOT NULL CHECK (next_result_sequence >= 1),
  latest_segment_digest TEXT CHECK (latest_segment_digest IS NULL OR (length(latest_segment_digest) = 64 AND latest_segment_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK (
    (next_result_sequence = 1 AND latest_segment_digest IS NULL)
    OR (next_result_sequence > 1 AND latest_segment_digest IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_result_transport_segments (
  actor_id TEXT NOT NULL REFERENCES library_result_transport_heads(actor_id) ON DELETE CASCADE,
  first_result_sequence INTEGER NOT NULL CHECK (first_result_sequence >= 1),
  last_result_sequence INTEGER NOT NULL CHECK (last_result_sequence >= first_result_sequence),
  previous_segment_digest TEXT CHECK (previous_segment_digest IS NULL OR (length(previous_segment_digest) = 64 AND previous_segment_digest NOT GLOB '*[^0-9a-f]*')),
  semantic_segment_digest TEXT NOT NULL CHECK (length(semantic_segment_digest) = 64 AND semantic_segment_digest NOT GLOB '*[^0-9a-f]*'),
  stored_segment_digest TEXT NOT NULL CHECK (length(stored_segment_digest) = 64 AND stored_segment_digest NOT GLOB '*[^0-9a-f]*'),
  object_key TEXT NOT NULL CHECK (length(CAST(object_key AS BLOB)) BETWEEN 1 AND 1024),
  transport_object_id TEXT NOT NULL CHECK (length(CAST(transport_object_id AS BLOB)) BETWEEN 1 AND 1024),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  result_count INTEGER NOT NULL CHECK (result_count BETWEEN 1 AND 128),
  accepted_transaction_count INTEGER NOT NULL CHECK (accepted_transaction_count BETWEEN 0 AND result_count),
  rejected_transaction_count INTEGER NOT NULL CHECK (rejected_transaction_count BETWEEN 0 AND result_count),
  PRIMARY KEY (actor_id, first_result_sequence),
  UNIQUE (stored_segment_digest),
  CHECK (accepted_transaction_count + rejected_transaction_count <= result_count),
  CHECK (
    (first_result_sequence = 1 AND previous_segment_digest IS NULL)
    OR (first_result_sequence > 1 AND previous_segment_digest IS NOT NULL)
  )
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
SELECT '32_person_reach_out', json_array(person_id, reach_out_id),
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
  json_object(
    'blobContentDigest', content_digest,
    'byteLength', byte_length,
    'chunkBytes', chunk_bytes,
    'chunkCount', chunk_count,
    'cloudAvailabilityCommitment', cloud_availability_commitment,
    'encoding', encoding,
    'mediaType', media_type,
    'rangeCount', range_count,
    'rangeGranularity', range_granularity,
    'rangeIndexRootDigest', range_index_root_digest,
    'renditionId', rendition_id,
    'storageLayout', storage_layout
  ), NULL
FROM library_blobs
UNION ALL
SELECT 'b1_content_chunk', json_array(content_digest, chunk_index),
  json_object('blobContentDigest', content_digest, 'byteLength', length(bytes), 'bytesBase64', NULL, 'chunkContentDigest', chunk_digest, 'chunkIndex', chunk_index), bytes
FROM library_blob_chunks
UNION ALL
SELECT 'b2_content_range', json_array(content_digest, range_index),
  json_object('blobContentDigest', content_digest, 'byteLength', byte_length, 'byteOffset', byte_offset, 'rangeContentDigest', range_digest, 'rangeIndex', range_index), NULL
FROM library_content_ranges;
