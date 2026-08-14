CREATE TABLE projection_batches (
  batchId             TEXT    NOT NULL PRIMARY KEY,
  inputDigest         TEXT    NOT NULL,
  previousRevision    INTEGER NOT NULL CHECK (previousRevision >= 0),
  committedRevision   INTEGER NOT NULL CHECK (committedRevision = previousRevision + 1),
  upserted             INTEGER NOT NULL CHECK (upserted >= 0),
  deleted              INTEGER NOT NULL CHECK (deleted >= 0)
) STRICT;

PRAGMA user_version = 2;
