/* Record one immutable, authority-signed protocol correction for a Library
   whose historical genesis certificate named the retired Automerge engine.
   The accepted authority epoch itself is not replaced, so actor enrollment,
   writer admission, follower anchors, intents, results, and checkpoints keep
   their exact Library and epoch identities. */

CREATE TABLE library_core_native_authority_protocol (
  libraryId                            TEXT    NOT NULL PRIMARY KEY,
  sourceEpoch                         INTEGER NOT NULL CHECK (
    sourceEpoch BETWEEN 1 AND 9007199254740991
  ),
  sourceEpochId                       TEXT    NOT NULL,
  sourceTransitionCertificateDigest  TEXT    NOT NULL,
  protocolTransitionCertificateDigest TEXT   NOT NULL UNIQUE,
  canonicalProtocolTransitionCertificateJson TEXT NOT NULL CHECK (
    length(CAST(canonicalProtocolTransitionCertificateJson AS BLOB))
      BETWEEN 1 AND 4194304
  ),
  sourceManifestDigest                TEXT    NOT NULL,
  acceptedAtMs                        INTEGER NOT NULL CHECK (
    acceptedAtMs BETWEEN 0 AND 9007199254740991
  ),
  FOREIGN KEY (
    libraryId,
    sourceEpoch,
    sourceEpochId,
    sourceTransitionCertificateDigest
  ) REFERENCES library_core_authority_epochs (
    libraryId,
    epoch,
    epochId,
    transitionCertificateDigest
  ),
  CHECK (length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(sourceEpochId) = 64 AND sourceEpochId NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(sourceTransitionCertificateDigest) = 64
    AND sourceTransitionCertificateDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(protocolTransitionCertificateDigest) = 64
    AND protocolTransitionCertificateDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(sourceManifestDigest) = 64
    AND sourceManifestDigest NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

PRAGMA user_version = 11;
