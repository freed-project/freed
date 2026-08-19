-- Bind follower overlay replay to the exact actor tip included by the
-- imported immutable checkpoint. A canonical result may be published before
-- the checkpoint containing that transaction, so result presence alone is
-- not proof that an optimistic edit can be removed from the local overlay.

ALTER TABLE library_core_follower_anchor
  ADD COLUMN checkpointActorId TEXT CHECK (
    checkpointActorId IS NULL OR (
      length(checkpointActorId) = 64
      AND checkpointActorId NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE library_core_follower_anchor
  ADD COLUMN checkpointAcceptedSequence INTEGER CHECK (
    checkpointAcceptedSequence IS NULL
    OR checkpointAcceptedSequence BETWEEN 0 AND 9007199254740991
  );

ALTER TABLE library_core_follower_anchor
  ADD COLUMN checkpointAcceptedOperationId TEXT CHECK (
    checkpointAcceptedOperationId IS NULL
    OR length(CAST(checkpointAcceptedOperationId AS BLOB)) BETWEEN 1 AND 128
  );

ALTER TABLE library_core_follower_anchor
  ADD COLUMN checkpointAcceptedChainDigest TEXT CHECK (
    checkpointAcceptedChainDigest IS NULL OR (
      length(checkpointAcceptedChainDigest) = 64
      AND checkpointAcceptedChainDigest NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE library_core_follower_anchor
  ADD COLUMN checkpointEnrollmentCertificateDigest TEXT CHECK (
    checkpointEnrollmentCertificateDigest IS NULL OR (
      length(checkpointEnrollmentCertificateDigest) = 64
      AND checkpointEnrollmentCertificateDigest NOT GLOB '*[^0-9a-f]*'
    )
  );

PRAGMA user_version = 8;
