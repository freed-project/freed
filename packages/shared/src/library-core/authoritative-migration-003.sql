-- Schema 3: durable PWA intent acceptance and provider-result publication.
--
-- Result rows are committed in the same transaction as the canonical intent
-- operation. Cloud publication may fail or lose its response without losing
-- the receipt that the PWA needs to leave Pending state.

CREATE TABLE library_core_intent_result_outbox (
  resultOperationId     TEXT    NOT NULL PRIMARY KEY CHECK (
    length(CAST(resultOperationId AS BLOB)) BETWEEN 1 AND 128
  ),
  libraryId             TEXT    NOT NULL,
  epochId               TEXT    NOT NULL,
  actorId               TEXT    NOT NULL CHECK (
    length(CAST(actorId AS BLOB)) BETWEEN 1 AND 128
  ),
  resultSequence        INTEGER NOT NULL CHECK (
    resultSequence BETWEEN 1 AND 9007199254740991
  ),
  intentOperationId     TEXT    NOT NULL REFERENCES library_core_operations(operationId),
  intentSequence        INTEGER NOT NULL CHECK (
    intentSequence BETWEEN 1 AND 9007199254740991
  ),
  status                TEXT    NOT NULL CHECK (
    status IN ('accepted', 'provider_completed', 'provider_failed')
  ),
  providerReceiptDigest TEXT CHECK (
    providerReceiptDigest IS NULL OR (
      length(providerReceiptDigest) = 64
      AND providerReceiptDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  enqueuedAtMs          INTEGER NOT NULL CHECK (
    enqueuedAtMs BETWEEN 0 AND 9007199254740991
  ),
  acknowledgedAtMs     INTEGER CHECK (
    acknowledgedAtMs IS NULL
    OR acknowledgedAtMs BETWEEN enqueuedAtMs AND 9007199254740991
  ),
  UNIQUE (epochId, actorId, resultSequence),
  CHECK (
    (status = 'accepted' AND providerReceiptDigest IS NULL)
    OR (status != 'accepted' AND providerReceiptDigest IS NOT NULL)
  )
) STRICT;

CREATE INDEX library_core_intent_result_outbox_pending
  ON library_core_intent_result_outbox (libraryId, epochId, actorId, resultSequence)
  WHERE acknowledgedAtMs IS NULL;

PRAGMA user_version = 3;
