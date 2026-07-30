PRAGMA application_id = 1178751575;

CREATE TABLE feed_browse_generation (
  singleton                         INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  generationId                      TEXT    NOT NULL CHECK (
    length(generationId) = 64
    AND generationId NOT GLOB '*[^0-9a-f]*'
  ),
  transitionSequence                INTEGER NOT NULL CHECK (
    transitionSequence BETWEEN 0 AND 9007199254740991
  ),
  projectionRevision                INTEGER NOT NULL CHECK (
    projectionRevision BETWEEN 0 AND 9007199254740991
  ),
  filterJson                        TEXT    NOT NULL CHECK (
    length(CAST(filterJson AS BLOB)) BETWEEN 1 AND 1048576
    AND json_valid(filterJson)
    AND json_type(filterJson) = 'object'
  ),
  rankingClockMs                    INTEGER NOT NULL CHECK (
    rankingClockMs BETWEEN 0 AND 9007199254740991
  ),
  recommendationOrderSchemaVersion INTEGER NOT NULL CHECK (
    recommendationOrderSchemaVersion = 1
  ),
  totalRows                         INTEGER NOT NULL CHECK (
    totalRows BETWEEN 0 AND 250000
  ),
  writtenRows                       INTEGER NOT NULL DEFAULT 0 CHECK (
    writtenRows BETWEEN 0 AND totalRows
  ),
  nextBatchIndex                    INTEGER NOT NULL DEFAULT 0 CHECK (
    nextBatchIndex BETWEEN 0 AND 9007199254740991
  ),
  complete                          INTEGER NOT NULL DEFAULT 0 CHECK (
    complete IN (0, 1)
    AND (complete = 0 OR writtenRows = totalRows)
  )
) STRICT;

CREATE TABLE feed_browse_rows (
  priority       INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  publishedAt    INTEGER NOT NULL CHECK (
    publishedAt BETWEEN 0 AND 9007199254740991
  ),
  sourceSequence INTEGER NOT NULL CHECK (
    sourceSequence BETWEEN 0 AND 9007199254740991
  ),
  globalId       TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(globalId AS BLOB)) BETWEEN 1 AND 4096
  ),
  cardJson       TEXT    NOT NULL CHECK (
    length(CAST(cardJson AS BLOB)) BETWEEN 1 AND 262144
    AND json_valid(cardJson)
    AND json_type(cardJson) = 'object'
    AND json_type(cardJson, '$.globalId') = 'text'
    AND json_extract(cardJson, '$.globalId') = globalId
  )
) STRICT;

CREATE UNIQUE INDEX feed_browse_rows_order
  ON feed_browse_rows (
    priority DESC,
    publishedAt DESC,
    sourceSequence ASC,
    globalId ASC
  );

CREATE TABLE feed_browse_batches (
  batchIndex      INTEGER NOT NULL PRIMARY KEY CHECK (
    batchIndex BETWEEN 0 AND 9007199254740991
  ),
  pageDigest      TEXT    NOT NULL CHECK (
    length(pageDigest) = 64
    AND pageDigest NOT GLOB '*[^0-9a-f]*'
  ),
  rowCount        INTEGER NOT NULL CHECK (rowCount BETWEEN 1 AND 128),
  cumulativeRows  INTEGER NOT NULL CHECK (
    cumulativeRows BETWEEN rowCount AND 250000
  )
) STRICT;

PRAGMA user_version = 1;
