-- Bind a staged checkpoint and follower anchor to the exact immutable
-- manifest reference from the authenticated cloud control pointer. Existing
-- candidate anchors remain readable only after a fresh authenticated import
-- supplies the missing transport object identity.

ALTER TABLE library_core_import_stage
  ADD COLUMN sourceCheckpointObjectKey TEXT CHECK (
    sourceCheckpointObjectKey IS NULL
    OR length(CAST(sourceCheckpointObjectKey AS BLOB)) BETWEEN 1 AND 4096
  );

ALTER TABLE library_core_import_stage
  ADD COLUMN sourceCheckpointContentDigest TEXT CHECK (
    sourceCheckpointContentDigest IS NULL
    OR (
      length(sourceCheckpointContentDigest) = 64
      AND sourceCheckpointContentDigest NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE library_core_import_stage
  ADD COLUMN sourceCheckpointTransportObjectId TEXT CHECK (
    sourceCheckpointTransportObjectId IS NULL
    OR length(CAST(sourceCheckpointTransportObjectId AS BLOB)) BETWEEN 1 AND 4096
  );

ALTER TABLE library_core_follower_anchor
  ADD COLUMN manifestTransportObjectId TEXT CHECK (
    manifestTransportObjectId IS NULL
    OR length(CAST(manifestTransportObjectId AS BLOB)) BETWEEN 1 AND 4096
  );

PRAGMA user_version = 10;
