-- Schema 7: isolated editable-follower authority and durable signed-intent state.
--
-- A follower imports immutable checkpoints into the local materialized Library,
-- but it never becomes the canonical writer. Keep its accepted remote anchor,
-- actor enrollment, and unpublished intents outside the writer authority and
-- replication tables. Merely importing a checkpoint can therefore never grant
-- this installation permission to advance the cloud control pointer.

CREATE TABLE library_core_follower_anchor (
  singletonId              INTEGER NOT NULL PRIMARY KEY CHECK (singletonId = 1),
  libraryId                TEXT    NOT NULL CHECK (
    length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'
  ),
  epoch                    INTEGER NOT NULL CHECK (
    epoch BETWEEN 1 AND 9007199254740991
  ),
  epochId                  TEXT    NOT NULL CHECK (
    length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'
  ),
  authorityKeyId           TEXT    NOT NULL CHECK (
    length(authorityKeyId) = 64 AND authorityKeyId NOT GLOB '*[^0-9a-f]*'
  ),
  authorityPublicKey       TEXT    NOT NULL CHECK (
    length(authorityPublicKey) = 64
    AND authorityPublicKey NOT GLOB '*[^0-9a-f]*'
  ),
  observedFrontierJson     TEXT    NOT NULL CHECK (
    length(CAST(observedFrontierJson AS BLOB)) BETWEEN 2 AND 4194304
    AND json_valid(observedFrontierJson)
    AND json_type(observedFrontierJson) = 'array'
  ),
  manifestObjectKey        TEXT    NOT NULL CHECK (
    length(CAST(manifestObjectKey AS BLOB)) BETWEEN 1 AND 4096
  ),
  manifestContentDigest    TEXT    NOT NULL CHECK (
    length(manifestContentDigest) = 64
    AND manifestContentDigest NOT GLOB '*[^0-9a-f]*'
  ),
  generation               INTEGER NOT NULL CHECK (
    generation BETWEEN 0 AND 9007199254740991
  ),
  remoteIngestSequence     INTEGER NOT NULL CHECK (
    remoteIngestSequence BETWEEN 0 AND 9007199254740991
  ),
  remoteMaterializedDigest TEXT    NOT NULL CHECK (
    length(remoteMaterializedDigest) = 64
    AND remoteMaterializedDigest NOT GLOB '*[^0-9a-f]*'
  ),
  writerId                 TEXT    NOT NULL CHECK (
    length(writerId) = 64 AND writerId NOT GLOB '*[^0-9a-f]*'
  ),
  controlRevision          TEXT    NOT NULL CHECK (
    length(CAST(controlRevision AS BLOB)) BETWEEN 1 AND 512
  ),
  installedAtMs            INTEGER NOT NULL CHECK (
    installedAtMs BETWEEN 0 AND 9007199254740991
  ),
  UNIQUE (libraryId, epochId)
) STRICT;

CREATE TABLE library_core_follower_actor (
  libraryId                     TEXT    NOT NULL,
  epochId                       TEXT    NOT NULL,
  actorId                       TEXT    NOT NULL,
  actorPublicKey                TEXT    NOT NULL,
  actorChainGenesis             TEXT,
  enrollmentRequestDigest       TEXT    NOT NULL,
  canonicalEnrollmentRequestJson TEXT  NOT NULL CHECK (
    length(CAST(canonicalEnrollmentRequestJson AS BLOB)) BETWEEN 1 AND 65536
  ),
  enrollmentCertificateDigest   TEXT,
  canonicalEnrollmentCertificateJson TEXT CHECK (
    canonicalEnrollmentCertificateJson IS NULL
    OR length(CAST(canonicalEnrollmentCertificateJson AS BLOB))
      BETWEEN 1 AND 65536
  ),
  createdAtMs                   INTEGER NOT NULL CHECK (
    createdAtMs BETWEEN 0 AND 9007199254740991
  ),
  enrolledAtMs                  INTEGER CHECK (
    enrolledAtMs IS NULL
    OR enrolledAtMs BETWEEN createdAtMs AND 9007199254740991
  ),
  PRIMARY KEY (libraryId, epochId, actorId),
  UNIQUE (libraryId, epochId),
  FOREIGN KEY (libraryId, epochId)
    REFERENCES library_core_follower_anchor (libraryId, epochId)
    ON DELETE CASCADE,
  CHECK (length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(actorPublicKey) = 64 AND actorPublicKey NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    actorChainGenesis IS NULL OR (
      length(actorChainGenesis) = 64
      AND actorChainGenesis NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    length(enrollmentRequestDigest) = 64
    AND enrollmentRequestDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    enrollmentCertificateDigest IS NULL OR (
      length(enrollmentCertificateDigest) = 64
      AND enrollmentCertificateDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (enrollmentCertificateDigest IS NULL
      AND canonicalEnrollmentCertificateJson IS NULL
      AND actorChainGenesis IS NULL
      AND enrolledAtMs IS NULL)
    OR
    (enrollmentCertificateDigest IS NOT NULL
      AND canonicalEnrollmentCertificateJson IS NOT NULL
      AND actorChainGenesis IS NOT NULL
      AND enrolledAtMs IS NOT NULL)
  )
) STRICT;

CREATE TABLE library_core_follower_enrollment_publication (
  libraryId          TEXT    NOT NULL,
  epochId            TEXT    NOT NULL,
  actorId            TEXT    NOT NULL,
  objectKey          TEXT    NOT NULL CHECK (
    length(CAST(objectKey AS BLOB)) BETWEEN 1 AND 4096
  ),
  contentDigest      TEXT    NOT NULL CHECK (
    length(contentDigest) = 64 AND contentDigest NOT GLOB '*[^0-9a-f]*'
  ),
  transportObjectId  TEXT    NOT NULL CHECK (
    length(CAST(transportObjectId AS BLOB)) BETWEEN 1 AND 4096
  ),
  publishedAtMs      INTEGER NOT NULL CHECK (
    publishedAtMs BETWEEN 0 AND 9007199254740991
  ),
  PRIMARY KEY (libraryId, epochId, actorId),
  FOREIGN KEY (libraryId, epochId, actorId)
    REFERENCES library_core_follower_actor (libraryId, epochId, actorId)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE library_core_follower_intent_actor (
  libraryId                     TEXT    NOT NULL,
  epochId                       TEXT    NOT NULL,
  actorId                       TEXT    NOT NULL,
  nextIntentSequence            INTEGER NOT NULL CHECK (
    nextIntentSequence BETWEEN 1 AND 9007199254740991
  ),
  latestOperationId             TEXT,
  latestActorChainDigest        TEXT    NOT NULL CHECK (
    length(latestActorChainDigest) = 64
    AND latestActorChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  publishedThroughIntentSequence INTEGER NOT NULL CHECK (
    publishedThroughIntentSequence BETWEEN 0 AND 9007199254740990
  ),
  latestPublishedSegmentDigest TEXT CHECK (
    latestPublishedSegmentDigest IS NULL OR (
      length(latestPublishedSegmentDigest) = 64
      AND latestPublishedSegmentDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  nextResultSequence            INTEGER NOT NULL DEFAULT 1 CHECK (
    nextResultSequence BETWEEN 1 AND 9007199254740991
  ),
  latestResultSegmentDigest     TEXT CHECK (
    latestResultSegmentDigest IS NULL OR (
      length(latestResultSegmentDigest) = 64
      AND latestResultSegmentDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  PRIMARY KEY (libraryId, epochId, actorId),
  FOREIGN KEY (libraryId, epochId, actorId)
    REFERENCES library_core_follower_actor (libraryId, epochId, actorId)
    ON DELETE CASCADE,
  CHECK (
    (nextIntentSequence = 1 AND latestOperationId IS NULL)
    OR (nextIntentSequence > 1 AND latestOperationId IS NOT NULL)
  ),
  CHECK (publishedThroughIntentSequence < nextIntentSequence),
  CHECK (
    (publishedThroughIntentSequence = 0
      AND latestPublishedSegmentDigest IS NULL)
    OR
    (publishedThroughIntentSequence > 0
      AND latestPublishedSegmentDigest IS NOT NULL)
  ),
  CHECK (
    (nextResultSequence = 1 AND latestResultSegmentDigest IS NULL)
    OR (nextResultSequence > 1 AND latestResultSegmentDigest IS NOT NULL)
  )
) STRICT;

CREATE TABLE library_core_follower_intent_transaction (
  transactionId        TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(transactionId AS BLOB)) BETWEEN 1 AND 128
  ),
  transactionDigest    TEXT    NOT NULL CHECK (
    length(transactionDigest) = 64
    AND transactionDigest NOT GLOB '*[^0-9a-f]*'
  ),
  libraryId            TEXT    NOT NULL,
  epochId              TEXT    NOT NULL,
  actorId              TEXT    NOT NULL,
  firstIntentSequence  INTEGER NOT NULL CHECK (
    firstIntentSequence BETWEEN 1 AND 9007199254740990
  ),
  lastIntentSequence   INTEGER NOT NULL CHECK (
    lastIntentSequence BETWEEN firstIntentSequence AND 9007199254740990
  ),
  operationCount       INTEGER NOT NULL CHECK (operationCount BETWEEN 1 AND 1000),
  canonicalEnvelopeBytes INTEGER NOT NULL CHECK (
    canonicalEnvelopeBytes BETWEEN 1 AND 4194304
  ),
  enqueuedAtMs         INTEGER NOT NULL CHECK (
    enqueuedAtMs BETWEEN 0 AND 9007199254740991
  ),
  FOREIGN KEY (libraryId, epochId, actorId)
    REFERENCES library_core_follower_intent_actor (libraryId, epochId, actorId)
    ON DELETE CASCADE,
  UNIQUE (libraryId, epochId, actorId, firstIntentSequence),
  CHECK (lastIntentSequence = firstIntentSequence + operationCount - 1)
) STRICT;

CREATE INDEX library_core_follower_intent_transaction_order
  ON library_core_follower_intent_transaction (
    libraryId, epochId, actorId, firstIntentSequence
  );

CREATE TABLE library_core_follower_intent_operation (
  operationId          TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(operationId AS BLOB)) BETWEEN 1 AND 128
  ),
  transactionId        TEXT    NOT NULL,
  transactionMemberIndex INTEGER NOT NULL CHECK (transactionMemberIndex >= 0),
  libraryId            TEXT    NOT NULL,
  epochId              TEXT    NOT NULL,
  actorId              TEXT    NOT NULL,
  intentSequence       INTEGER NOT NULL CHECK (
    intentSequence BETWEEN 1 AND 9007199254740990
  ),
  actorChainDigest     TEXT    NOT NULL CHECK (
    length(actorChainDigest) = 64
    AND actorChainDigest NOT GLOB '*[^0-9a-f]*'
  ),
  canonicalEnvelopeJson TEXT  NOT NULL CHECK (
    length(CAST(canonicalEnvelopeJson AS BLOB)) BETWEEN 1 AND 4194304
  ),
  envelopeDigest       TEXT    NOT NULL CHECK (
    length(envelopeDigest) = 64 AND envelopeDigest NOT GLOB '*[^0-9a-f]*'
  ),
  publishedSegmentDigest TEXT CHECK (
    publishedSegmentDigest IS NULL OR (
      length(publishedSegmentDigest) = 64
      AND publishedSegmentDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  FOREIGN KEY (transactionId)
    REFERENCES library_core_follower_intent_transaction (transactionId)
    ON DELETE CASCADE,
  UNIQUE (libraryId, epochId, actorId, intentSequence),
  UNIQUE (transactionId, transactionMemberIndex)
) STRICT;

CREATE INDEX library_core_follower_intent_operation_unpublished
  ON library_core_follower_intent_operation (
    libraryId, epochId, actorId, intentSequence
  )
  WHERE publishedSegmentDigest IS NULL;

CREATE TABLE library_core_follower_intent_result (
  resultOperationId      TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(resultOperationId AS BLOB)) BETWEEN 1 AND 128
  ),
  libraryId              TEXT    NOT NULL,
  epochId                TEXT    NOT NULL,
  actorId                TEXT    NOT NULL,
  resultSequence         INTEGER NOT NULL CHECK (
    resultSequence BETWEEN 1 AND 9007199254740990
  ),
  intentOperationId      TEXT    NOT NULL,
  intentSequence         INTEGER NOT NULL CHECK (
    intentSequence BETWEEN 1 AND 9007199254740990
  ),
  status                 TEXT    NOT NULL CHECK (
    status IN ('accepted', 'provider_completed', 'provider_failed')
  ),
  providerReceiptDigest  TEXT CHECK (
    providerReceiptDigest IS NULL OR (
      length(providerReceiptDigest) = 64
      AND providerReceiptDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  importedAtMs           INTEGER NOT NULL CHECK (
    importedAtMs BETWEEN 0 AND 9007199254740991
  ),
  UNIQUE (libraryId, epochId, actorId, resultSequence),
  FOREIGN KEY (libraryId, epochId, actorId)
    REFERENCES library_core_follower_intent_actor (libraryId, epochId, actorId)
    ON DELETE CASCADE,
  FOREIGN KEY (intentOperationId)
    REFERENCES library_core_follower_intent_operation (operationId),
  CHECK (
    (status = 'accepted' AND providerReceiptDigest IS NULL)
    OR (status != 'accepted' AND providerReceiptDigest IS NOT NULL)
  )
) STRICT;

CREATE INDEX library_core_follower_intent_result_order
  ON library_core_follower_intent_result (
    libraryId, epochId, actorId, resultSequence
  );

PRAGMA user_version = 7;
