CREATE TABLE library_core_meta (
  key          TEXT    NOT NULL PRIMARY KEY,
  integerValue INTEGER,
  textValue    TEXT,
  CHECK ((integerValue IS NULL) <> (textValue IS NULL)),
  CHECK (
    integerValue IS NULL
    OR integerValue BETWEEN 0 AND 9007199254740991
  )
) STRICT;

INSERT INTO library_core_meta (key, integerValue)
VALUES
  ('projectionRevision', 0),
  ('nextIngestSequence', 1),
  ('materializerIngestSequence', 0);

CREATE TABLE library_core_actors (
  libraryId                   TEXT    NOT NULL,
  epoch                       INTEGER NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  epochId                     TEXT    NOT NULL,
  actorId                     TEXT    NOT NULL,
  actorPublicKey              TEXT    NOT NULL,
  enrollmentOperationId       TEXT    NOT NULL UNIQUE,
  enrollmentCertificateDigest TEXT    NOT NULL,
  canonicalEnrollmentCertificateJson TEXT NOT NULL CHECK (
    length(CAST(canonicalEnrollmentCertificateJson AS BLOB))
      BETWEEN 1 AND 4194304
  ),
  actorChainGenesis           TEXT    NOT NULL,
  nextSequence                INTEGER NOT NULL CHECK (nextSequence BETWEEN 1 AND 9007199254740991),
  previousOperationId         TEXT,
  previousChainDigest         TEXT    NOT NULL,
  enrolledAtMs                INTEGER NOT NULL CHECK (enrolledAtMs BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (libraryId, epochId, actorId),
  UNIQUE (libraryId, epochId, enrollmentCertificateDigest),
  CHECK (length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(actorPublicKey) = 64 AND actorPublicKey NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(enrollmentCertificateDigest) = 64
    AND enrollmentCertificateDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(actorChainGenesis) = 64
    AND actorChainGenesis NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(previousChainDigest) = 64
    AND previousChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    (nextSequence = 1 AND previousOperationId IS NULL)
    OR (nextSequence > 1 AND previousOperationId IS NOT NULL)
  )
) STRICT;

CREATE TABLE library_core_actor_enrollment_outbox (
  enrollmentOperationId              TEXT    NOT NULL PRIMARY KEY,
  canonicalEnrollmentCertificateJson TEXT    NOT NULL,
  enqueuedAtMs                       INTEGER NOT NULL CHECK (
    enqueuedAtMs BETWEEN 0 AND 9007199254740991
  ),
  acknowledgedAtMs                   INTEGER CHECK (
    acknowledgedAtMs IS NULL
    OR acknowledgedAtMs BETWEEN enqueuedAtMs AND 9007199254740991
  ),
  FOREIGN KEY (enrollmentOperationId)
    REFERENCES library_core_actors (enrollmentOperationId)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE library_core_transactions (
  transactionId               TEXT    NOT NULL PRIMARY KEY,
  transactionDigest           TEXT    NOT NULL,
  libraryId                   TEXT    NOT NULL,
  epoch                       INTEGER NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  epochId                     TEXT    NOT NULL,
  actorId                     TEXT    NOT NULL,
  memberCount                 INTEGER NOT NULL CHECK (memberCount BETWEEN 1 AND 1000),
  firstSequence               INTEGER NOT NULL CHECK (firstSequence BETWEEN 1 AND 9007199254740991),
  lastSequence                INTEGER NOT NULL CHECK (
    lastSequence BETWEEN firstSequence AND 9007199254740990
  ),
  previousOperationId         TEXT,
  previousChainDigest         TEXT    NOT NULL,
  committedOperationId        TEXT    NOT NULL,
  committedChainDigest        TEXT    NOT NULL,
  canonicalEnvelopeBytes      INTEGER NOT NULL CHECK (
    canonicalEnvelopeBytes BETWEEN 1 AND 4194304
  ),
  firstIngestSequence         INTEGER NOT NULL CHECK (
    firstIngestSequence BETWEEN 1 AND 9007199254740991
  ),
  lastIngestSequence          INTEGER NOT NULL CHECK (
    lastIngestSequence BETWEEN firstIngestSequence AND 9007199254740991
  ),
  previousRevision            INTEGER NOT NULL CHECK (previousRevision BETWEEN 0 AND 9007199254740990),
  committedRevision           INTEGER NOT NULL CHECK (
    committedRevision = previousRevision + 1
  ),
  committedAtMs               INTEGER NOT NULL CHECK (committedAtMs BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY (libraryId, epochId, actorId)
    REFERENCES library_core_actors (libraryId, epochId, actorId),
  CHECK (
    length(transactionDigest) = 64
    AND transactionDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(previousChainDigest) = 64
    AND previousChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(committedChainDigest) = 64
    AND committedChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (lastSequence = firstSequence + memberCount - 1),
  CHECK (lastIngestSequence = firstIngestSequence + memberCount - 1)
) STRICT;

CREATE TABLE library_core_operations (
  operationId                 TEXT    NOT NULL PRIMARY KEY,
  transactionId               TEXT    NOT NULL,
  transactionMemberIndex      INTEGER NOT NULL CHECK (transactionMemberIndex >= 0),
  transactionMemberCount      INTEGER NOT NULL CHECK (
    transactionMemberCount BETWEEN 1 AND 1000
  ),
  libraryId                   TEXT    NOT NULL,
  epoch                       INTEGER NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  epochId                     TEXT    NOT NULL,
  actorId                     TEXT    NOT NULL,
  actorSequence               INTEGER NOT NULL CHECK (actorSequence BETWEEN 1 AND 9007199254740990),
  ingestSequence              INTEGER NOT NULL UNIQUE CHECK (
    ingestSequence BETWEEN 1 AND 9007199254740991
  ),
  previousActorOperationId    TEXT,
  previousActorChainDigest    TEXT    NOT NULL,
  actorChainDigest            TEXT    NOT NULL,
  transactionDigest           TEXT    NOT NULL,
  memberDigest                TEXT    NOT NULL,
  signingBodyDigest           TEXT    NOT NULL,
  envelopeDigest              TEXT    NOT NULL,
  operationType               TEXT    NOT NULL,
  entityType                  TEXT    NOT NULL,
  entityId                    TEXT    NOT NULL,
  canonicalEnvelopeJson       TEXT    NOT NULL CHECK (
    length(CAST(canonicalEnvelopeJson AS BLOB)) BETWEEN 1 AND 4194304
  ),
  committedAtMs               INTEGER NOT NULL CHECK (committedAtMs BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY (transactionId) REFERENCES library_core_transactions (transactionId),
  UNIQUE (libraryId, epochId, actorId, actorSequence),
  UNIQUE (transactionId, transactionMemberIndex),
  CHECK (transactionMemberIndex < transactionMemberCount),
  CHECK (
    (actorSequence = 1 AND previousActorOperationId IS NULL)
    OR (actorSequence > 1 AND previousActorOperationId IS NOT NULL)
  ),
  CHECK (
    length(previousActorChainDigest) = 64
    AND previousActorChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(actorChainDigest) = 64
    AND actorChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(transactionDigest) = 64
    AND transactionDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(memberDigest) = 64
    AND memberDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(signingBodyDigest) = 64
    AND signingBodyDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(envelopeDigest) = 64
    AND envelopeDigest NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

CREATE TABLE library_core_operation_causal_tips (
  operationId  TEXT    NOT NULL,
  tipIndex     INTEGER NOT NULL CHECK (tipIndex >= 0),
  actorId      TEXT    NOT NULL,
  sequence     INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  tipOperationId TEXT  NOT NULL,
  chainDigest  TEXT    NOT NULL,
  PRIMARY KEY (operationId, tipIndex),
  FOREIGN KEY (operationId) REFERENCES library_core_operations (operationId)
    ON DELETE CASCADE,
  CHECK (length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(chainDigest) = 64
    AND chainDigest NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

CREATE INDEX library_core_causal_tip_lookup
  ON library_core_operation_causal_tips (actorId, sequence);

CREATE TABLE library_core_feed_item_read_state (
  entityId          TEXT    NOT NULL PRIMARY KEY,
  readAtMs          INTEGER NOT NULL CHECK (readAtMs BETWEEN 0 AND 9007199254740991),
  sourceOperationId TEXT    NOT NULL,
  sourceActorId     TEXT    NOT NULL,
  sourceSequence    INTEGER NOT NULL CHECK (sourceSequence BETWEEN 1 AND 9007199254740990),
  sourceChainDigest TEXT    NOT NULL,
  FOREIGN KEY (sourceOperationId)
    REFERENCES library_core_operations (operationId),
  CHECK (
    length(sourceActorId) = 64
    AND sourceActorId NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(sourceChainDigest) = 64
    AND sourceChainDigest NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

CREATE TABLE library_core_replication_outbox (
  operationId           TEXT    NOT NULL PRIMARY KEY,
  canonicalEnvelopeJson TEXT    NOT NULL,
  enqueuedAtMs          INTEGER NOT NULL CHECK (enqueuedAtMs BETWEEN 0 AND 9007199254740991),
  acknowledgedAtMs      INTEGER CHECK (
    acknowledgedAtMs IS NULL
    OR acknowledgedAtMs BETWEEN enqueuedAtMs AND 9007199254740991
  ),
  FOREIGN KEY (operationId) REFERENCES library_core_operations (operationId)
    ON DELETE CASCADE
) STRICT;

PRAGMA user_version = 1;
