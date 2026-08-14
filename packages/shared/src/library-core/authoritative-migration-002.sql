-- Schema 2: authoritative Freed Desktop Library state.
--
-- Feed items stay row-addressable and queryable. The much smaller identity,
-- subscription, preference, and shell state is stored as one bounded JSON
-- document. Automerge is used only by the one-time importer that creates
-- these rows. Once `active` is 1, normal Desktop startup never opens it.

CREATE TABLE library_core_desktop_state (
  singletonId        INTEGER NOT NULL PRIMARY KEY CHECK (singletonId = 1),
  active             INTEGER NOT NULL CHECK (active IN (0, 1)),
  revision           INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  sourceGeneration   INTEGER NOT NULL CHECK (sourceGeneration BETWEEN 0 AND 9007199254740991),
  sourceRevision     INTEGER NOT NULL CHECK (sourceRevision BETWEEN 0 AND 9007199254740991),
  sourceDigest       TEXT    NOT NULL CHECK (
    length(sourceDigest) = 64 AND sourceDigest NOT GLOB '*[^0-9a-f]*'
  ),
  expectedItemCount  INTEGER NOT NULL CHECK (expectedItemCount BETWEEN 0 AND 1000000),
  importedItemCount  INTEGER NOT NULL CHECK (importedItemCount BETWEEN 0 AND 1000000),
  shellJson          TEXT    NOT NULL CHECK (
    length(CAST(shellJson AS BLOB)) BETWEEN 2 AND 16777216
    AND json_valid(shellJson)
    AND json_type(shellJson) = 'object'
  ),
  startedAtMs        INTEGER NOT NULL CHECK (startedAtMs BETWEEN 0 AND 9007199254740991),
  activatedAtMs      INTEGER CHECK (
    activatedAtMs IS NULL OR activatedAtMs BETWEEN startedAtMs AND 9007199254740991
  ),
  CHECK (
    (active = 0 AND activatedAtMs IS NULL)
    OR (active = 1 AND activatedAtMs IS NOT NULL AND importedItemCount = expectedItemCount)
  )
) STRICT;

CREATE TABLE library_core_feed_items (
  globalId          TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(globalId AS BLOB)) BETWEEN 1 AND 4096
  ),
  platform          TEXT,
  contentType       TEXT,
  publishedAt       INTEGER,
  capturedAt        INTEGER,
  authorId          TEXT,
  authorDisplayName TEXT,
  authorHandle      TEXT,
  sourceUrl         TEXT,
  hidden            INTEGER CHECK (hidden IS NULL OR hidden IN (0, 1)),
  saved             INTEGER CHECK (saved IS NULL OR saved IN (0, 1)),
  archived          INTEGER CHECK (archived IS NULL OR archived IN (0, 1)),
  readAt            INTEGER,
  archivedAt        INTEGER,
  liked             INTEGER CHECK (liked IS NULL OR liked IN (0, 1)),
  likedAt           INTEGER,
  likedSyncedAt     INTEGER,
  seenSyncedAt      INTEGER,
  feedUrl           TEXT,
  sampleData        INTEGER NOT NULL DEFAULT 0 CHECK (sampleData IN (0, 1)),
  deletedAt         INTEGER,
  payloadJson       TEXT    NOT NULL CHECK (
    length(CAST(payloadJson AS BLOB)) BETWEEN 2 AND 4194304
    AND json_valid(payloadJson)
    AND json_type(payloadJson) = 'object'
  ),
  updatedAtMs       INTEGER NOT NULL CHECK (updatedAtMs BETWEEN 0 AND 9007199254740991)
) STRICT;

CREATE INDEX library_core_feed_items_timeline
  ON library_core_feed_items (publishedAt DESC, capturedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL AND archived IS NOT 1 AND hidden IS NOT 1;

CREATE INDEX library_core_feed_items_saved
  ON library_core_feed_items (publishedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL AND saved = 1;

CREATE INDEX library_core_feed_items_archived
  ON library_core_feed_items (archivedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL AND archived = 1;

CREATE INDEX library_core_feed_items_platform
  ON library_core_feed_items (platform, publishedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL;

CREATE INDEX library_core_feed_items_feed
  ON library_core_feed_items (feedUrl, publishedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL;

CREATE TABLE library_core_desktop_backups (
  backupId       TEXT    NOT NULL PRIMARY KEY,
  createdAtMs    INTEGER NOT NULL CHECK (createdAtMs BETWEEN 0 AND 9007199254740991),
  revision       INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  itemCount      INTEGER NOT NULL CHECK (itemCount BETWEEN 0 AND 1000000),
  reason         TEXT    NOT NULL CHECK (reason IN ('auto', 'manual')),
  fileName       TEXT    NOT NULL,
  byteLength     INTEGER NOT NULL CHECK (byteLength > 0),
  sha256         TEXT    NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

PRAGMA user_version = 2;
