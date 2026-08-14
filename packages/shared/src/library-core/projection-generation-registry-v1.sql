PRAGMA application_id = 1179079217;

CREATE TABLE projection_generation_meta (
  key TEXT PRIMARY KEY,
  integerValue INTEGER NOT NULL
) STRICT;

INSERT INTO projection_generation_meta (key, integerValue) VALUES
  ('registrationSequence', 0);

CREATE TABLE projection_generations (
  generationId TEXT PRIMARY KEY
    CHECK(
      length(generationId) = 64
      AND generationId = lower(generationId)
      AND generationId NOT GLOB '*[^0-9a-f]*'
    ),
  fileName TEXT NOT NULL UNIQUE
    CHECK(
      length(fileName) BETWEEN 1 AND 255
      AND fileName NOT IN ('.', '..')
      AND instr(fileName, '/') = 0
      AND instr(fileName, char(92)) = 0
    ),
  rebuildId TEXT NOT NULL UNIQUE
    CHECK(length(CAST(rebuildId AS BLOB)) BETWEEN 1 AND 128),
  sourceDocumentId TEXT NOT NULL
    CHECK(length(CAST(sourceDocumentId AS BLOB)) BETWEEN 1 AND 4096),
  sourceHeadsDigest TEXT NOT NULL
    CHECK(
      length(sourceHeadsDigest) = 64
      AND sourceHeadsDigest = lower(sourceHeadsDigest)
      AND sourceHeadsDigest NOT GLOB '*[^0-9a-f]*'
    ),
  sourceHeadCount INTEGER NOT NULL
    CHECK(sourceHeadCount BETWEEN 0 AND 9007199254740991),
  sourceGeneration INTEGER NOT NULL
    CHECK(sourceGeneration BETWEEN 0 AND 9007199254740991),
  sourceSaveRevision INTEGER NOT NULL
    CHECK(sourceSaveRevision BETWEEN 0 AND 9007199254740991),
  totalRows INTEGER NOT NULL
    CHECK(totalRows BETWEEN 0 AND 250000),
  projectionRevision INTEGER NOT NULL
    CHECK(projectionRevision BETWEEN 0 AND 9007199254740991),
  byteLength INTEGER NOT NULL
    CHECK(byteLength > 0),
  registeredSequence INTEGER NOT NULL UNIQUE
    CHECK(registeredSequence BETWEEN 1 AND 9007199254740991)
) STRICT;

CREATE TABLE projection_reader_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  currentGenerationId TEXT
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  rollbackGenerationId TEXT
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  transitionSequence INTEGER NOT NULL
    CHECK(transitionSequence BETWEEN 0 AND 9007199254740991),
  CHECK(
    currentGenerationId IS NULL
    OR rollbackGenerationId IS NULL
    OR currentGenerationId <> rollbackGenerationId
  )
) STRICT;

INSERT INTO projection_reader_state (
  singleton,
  currentGenerationId,
  rollbackGenerationId,
  transitionSequence
) VALUES (1, NULL, NULL, 0);

CREATE TABLE projection_generation_transitions (
  transitionId TEXT PRIMARY KEY
    CHECK(length(CAST(transitionId AS BLOB)) BETWEEN 1 AND 128),
  transitionDigest TEXT NOT NULL
    CHECK(
      length(transitionDigest) = 64
      AND transitionDigest = lower(transitionDigest)
      AND transitionDigest NOT GLOB '*[^0-9a-f]*'
    ),
  transitionKind TEXT NOT NULL
    CHECK(transitionKind IN ('select', 'rollback')),
  expectedCurrentGenerationId TEXT
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  selectedGenerationId TEXT NOT NULL
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  previousGenerationId TEXT
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  committedRollbackGenerationId TEXT
    REFERENCES projection_generations(generationId) ON DELETE RESTRICT,
  committedSequence INTEGER NOT NULL UNIQUE
    CHECK(committedSequence BETWEEN 1 AND 9007199254740991)
) STRICT;

CREATE INDEX projection_generation_registration_order
  ON projection_generations(registeredSequence);

PRAGMA user_version = 1;
