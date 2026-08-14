CREATE TABLE IF NOT EXISTS feed_items (
  globalId          TEXT    NOT NULL PRIMARY KEY,
  platform          TEXT,
  contentType       TEXT,
  publishedAt       INTEGER,
  capturedAt        INTEGER,
  authorId          TEXT,
  authorDisplayName TEXT,
  authorHandle      TEXT,
  sourceUrl         TEXT,
  hidden            INTEGER,
  saved             INTEGER,
  archived          INTEGER,
  readAt            INTEGER,
  archivedAt        INTEGER,
  likedAt           INTEGER,
  tags              TEXT,
  contentBlob       TEXT,
  preservedBlob     TEXT,
  rest              TEXT    NOT NULL,
  sortAt            INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS library_meta (
  key          TEXT    NOT NULL PRIMARY KEY,
  integerValue INTEGER NOT NULL
) STRICT;

INSERT OR IGNORE INTO library_meta (key, integerValue)
VALUES ('projectionRevision', 0);

CREATE INDEX IF NOT EXISTS feed_items_timeline
  ON feed_items (sortAt DESC, globalId ASC)
  WHERE archived IS NOT 1 AND hidden IS NOT 1;

CREATE INDEX IF NOT EXISTS feed_items_saved
  ON feed_items (saved, publishedAt DESC)
  WHERE saved = 1;

CREATE INDEX IF NOT EXISTS feed_items_archived
  ON feed_items (archivedAt DESC)
  WHERE archived = 1;

CREATE INDEX IF NOT EXISTS feed_items_platform
  ON feed_items (platform, publishedAt DESC);

CREATE INDEX IF NOT EXISTS feed_items_author
  ON feed_items (authorId, publishedAt DESC);

PRAGMA user_version = 1;
