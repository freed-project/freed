-- Stage portable checkpoint imports without touching the active Library.
-- Final activation replaces the materialized rows and Desktop state in one
-- SQLite transaction, so a process crash leaves either the previous Library
-- or the complete imported Library active, never a partially imported mix.

CREATE TABLE library_core_import_stage (
  singletonId        INTEGER NOT NULL PRIMARY KEY CHECK (singletonId = 1),
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
  startedAtMs        INTEGER NOT NULL CHECK (startedAtMs BETWEEN 0 AND 9007199254740991)
) STRICT;

CREATE TABLE library_core_import_item_stage (
  globalId     TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(globalId AS BLOB)) BETWEEN 1 AND 4096
  ),
  itemJson     TEXT    NOT NULL CHECK (
    length(CAST(itemJson AS BLOB)) BETWEEN 2 AND 4194304
    AND json_valid(itemJson)
    AND json_type(itemJson) = 'object'
  ),
  updatedAtMs  INTEGER NOT NULL CHECK (updatedAtMs BETWEEN 0 AND 9007199254740991)
) STRICT;

PRAGMA user_version = 9;
