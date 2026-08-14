-- Schema 4: durable cloud writer admission for ordinary Desktop mutations.
--
-- The cloud control pointer is the authority boundary. A Desktop may continue
-- offline only from the last control tuple it durably verified. Ordinary
-- Library writes and provider actions are admitted only when that tuple names
-- this installation's enrolled actor as the active writer.

CREATE TABLE library_core_cloud_writer_admission (
  singletonId       INTEGER NOT NULL PRIMARY KEY CHECK (singletonId = 1),
  localWriterId     TEXT    NOT NULL CHECK (
    length(localWriterId) = 64 AND localWriterId NOT GLOB '*[^0-9a-f]*'
  ),
  activeWriterId    TEXT    NOT NULL CHECK (
    length(activeWriterId) = 64 AND activeWriterId NOT GLOB '*[^0-9a-f]*'
  ),
  storageEpoch      TEXT    NOT NULL CHECK (
    length(storageEpoch) = 64 AND storageEpoch NOT GLOB '*[^0-9a-f]*'
  ),
  controlRevision   TEXT    NOT NULL CHECK (
    length(CAST(controlRevision AS BLOB)) BETWEEN 1 AND 512
  ),
  verifiedAtMs      INTEGER NOT NULL CHECK (
    verifiedAtMs BETWEEN 0 AND 9007199254740991
  )
) STRICT;

PRAGMA user_version = 4;
