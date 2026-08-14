CREATE TABLE projection_rebuild_state (
  singleton            INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  rebuildId            TEXT    NOT NULL UNIQUE CHECK (
    length(CAST(rebuildId AS BLOB)) BETWEEN 1 AND 128
  ),
  sourceSchemaVersion  INTEGER NOT NULL CHECK (sourceSchemaVersion = 1),
  sourceDocumentId     TEXT    NOT NULL CHECK (
    length(CAST(sourceDocumentId AS BLOB)) BETWEEN 1 AND 4096
  ),
  sourceHeadsDigest    TEXT    NOT NULL CHECK (
    length(sourceHeadsDigest) = 64
    AND sourceHeadsDigest NOT GLOB '*[^0-9a-f]*'
  ),
  sourceHeadCount      INTEGER NOT NULL CHECK (
    sourceHeadCount BETWEEN 0 AND 9007199254740991
  ),
  sourceGeneration     INTEGER NOT NULL CHECK (
    sourceGeneration BETWEEN 0 AND 9007199254740991
  ),
  sourceSaveRevision   INTEGER NOT NULL CHECK (
    sourceSaveRevision BETWEEN 0 AND 9007199254740991
  ),
  totalRows            INTEGER NOT NULL CHECK (totalRows BETWEEN 0 AND 250000),
  nextBatchIndex       INTEGER NOT NULL CHECK (
    nextBatchIndex BETWEEN 0 AND 9007199254740991
  ),
  projectionRevision  INTEGER NOT NULL CHECK (
    projectionRevision BETWEEN 0 AND 9007199254740991
  ),
  projectedRows        INTEGER NOT NULL CHECK (
    projectedRows BETWEEN 0 AND totalRows
  ),
  complete             INTEGER NOT NULL CHECK (
    complete IN (0, 1)
    AND (complete = 0 OR projectedRows = totalRows)
  )
) STRICT;

CREATE TABLE projection_rebuild_batches (
  rebuildId      TEXT    NOT NULL,
  batchIndex     INTEGER NOT NULL CHECK (
    batchIndex BETWEEN 0 AND 9007199254740991
  ),
  batchId        TEXT    NOT NULL UNIQUE,
  projectedRows  INTEGER NOT NULL CHECK (
    projectedRows BETWEEN 0 AND 250000
  ),
  complete       INTEGER NOT NULL CHECK (complete IN (0, 1)),
  PRIMARY KEY (rebuildId, batchIndex),
  FOREIGN KEY (rebuildId)
    REFERENCES projection_rebuild_state (rebuildId)
    ON DELETE CASCADE,
  FOREIGN KEY (batchId)
    REFERENCES projection_batches (batchId)
) STRICT;

PRAGMA user_version = 3;
