-- Schema 2: the durable bridge from one exact Automerge commit to SQLite.
--
-- Automerge commits, then SQLite commits. Those are two writes and nothing
-- makes them atomic, so the gap has to be survivable rather than avoided. This
-- table holds one durable attempt per mutation, recorded before the SQLite
-- commit is tried, carrying the exact canonical envelope bytes.
--
-- Retry replays the stored bytes rather than rebuilding them. Rebuilding is
-- what makes exact retry impossible: envelope identity includes the actor's
-- chain tip, a successful commit advances that tip, and a rebuild after the
-- lost response would therefore produce a different transaction. Storing the
-- bytes is what makes the operation identity survive its own success.
--
-- This is the first migration. Databases created before it hold schema 1 and
-- reach schema 2 by applying exactly this file, so the reference catalogue is
-- always the genesis schema plus every migration in order.

CREATE TABLE library_core_read_bridge_attempts (
  -- The mutation identity the caller is retrying. Supplied by the caller and
  -- stable across retries; that stability is the whole mechanism.
  attemptId                 TEXT    NOT NULL PRIMARY KEY CHECK (
    length(attemptId) BETWEEN 1 AND 128
  ),
  libraryId                 TEXT    NOT NULL CHECK (
    length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'
  ),
  epochId                   TEXT    NOT NULL CHECK (
    length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'
  ),
  actorId                   TEXT    NOT NULL CHECK (
    length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'
  ),

  -- The exact durable Automerge revision this attempt followed. A later
  -- attempt that names the same mutation against a different revision is a
  -- different fact and must not silently reuse this one.
  sourceStorageGeneration   INTEGER NOT NULL CHECK (
    sourceStorageGeneration BETWEEN 0 AND 9007199254740991
  ),
  sourceSaveRevision        INTEGER NOT NULL CHECK (
    sourceSaveRevision BETWEEN 0 AND 9007199254740991
  ),
  sourceHeadsDigest         TEXT    NOT NULL CHECK (
    length(sourceHeadsDigest) = 64
    AND sourceHeadsDigest NOT GLOB '*[^0-9a-f]*'
  ),

  -- The actor tip the stored envelopes were built against. Kept so a resumed
  -- attempt can be recognised as stale instead of being replayed into a fork.
  actorSequence             INTEGER NOT NULL CHECK (
    actorSequence BETWEEN 1 AND 9007199254740991
  ),
  previousOperationId       TEXT CHECK (
    previousOperationId IS NULL
    OR length(previousOperationId) BETWEEN 1 AND 128
  ),
  previousChainDigest       TEXT    NOT NULL CHECK (
    length(previousChainDigest) = 64
    AND previousChainDigest NOT GLOB '*[^0-9a-f]*'
  ),

  -- Inside the signed envelopes, so it is stored rather than re-read from a
  -- clock. A retry that took a fresh timestamp would change the bytes.
  createdAtMs               INTEGER NOT NULL CHECK (
    createdAtMs BETWEEN 0 AND 9007199254740991
  ),

  transactionId             TEXT    NOT NULL UNIQUE CHECK (
    length(transactionId) BETWEEN 1 AND 128
  ),
  transactionDigest         TEXT    NOT NULL CHECK (
    length(transactionDigest) = 64
    AND transactionDigest NOT GLOB '*[^0-9a-f]*'
  ),

  -- The exact canonical envelope bytes, as a JSON array of strings. Replayed
  -- verbatim; never regenerated.
  canonicalEnvelopesJson    TEXT    NOT NULL CHECK (
    length(canonicalEnvelopesJson) BETWEEN 2 AND 4194304
    AND json_valid(canonicalEnvelopesJson)
    AND json_type(canonicalEnvelopesJson) = 'array'
    AND json_array_length(canonicalEnvelopesJson) BETWEEN 1 AND 1000
  ),
  memberCount               INTEGER NOT NULL CHECK (
    memberCount BETWEEN 1 AND 1000
  ),

  -- 'prepared' means the bytes are durable and the SQLite commit has not been
  -- confirmed. 'committed' means the receipt below was read back.
  state                     TEXT    NOT NULL CHECK (
    state IN ('prepared', 'committed')
  ),
  preparedAtMs              INTEGER NOT NULL CHECK (
    preparedAtMs BETWEEN 0 AND 9007199254740991
  ),
  committedAtMs             INTEGER CHECK (
    committedAtMs IS NULL
    OR committedAtMs BETWEEN preparedAtMs AND 9007199254740991
  ),
  committedIngestSequence   INTEGER CHECK (
    committedIngestSequence IS NULL
    OR committedIngestSequence BETWEEN 1 AND 9007199254740991
  ),

  -- A committed attempt carries its completion; a prepared one carries none.
  -- Anything else is a state the resume path would have to guess about.
  CHECK (
    (state = 'prepared'
      AND committedAtMs IS NULL
      AND committedIngestSequence IS NULL)
    OR (state = 'committed'
      AND committedAtMs IS NOT NULL
      AND committedIngestSequence IS NOT NULL)
  ),
  CHECK (json_array_length(canonicalEnvelopesJson) = memberCount)
) STRICT;

-- Resume scans want the unfinished attempts, oldest first.
CREATE INDEX library_core_read_bridge_attempts_resume
  ON library_core_read_bridge_attempts (state, preparedAtMs);

PRAGMA user_version = 2;
