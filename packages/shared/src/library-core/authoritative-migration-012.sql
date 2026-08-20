/* Bind every enrolled actor to an explicit immutable operation capability.
   Existing v1 Desktop and PWA actors receive only the fixed legacy-editor
   operation set that schema v11 already accepted. New actor classes require
   a verified v2 capability certificate. No missing row or missing scope can
   imply write authority. */

CREATE TABLE library_core_actor_capability_state (
  libraryId                    TEXT    NOT NULL,
  epoch                        INTEGER NOT NULL CHECK (
    epoch BETWEEN 1 AND 9007199254740991
  ),
  epochId                      TEXT    NOT NULL,
  actorId                      TEXT    NOT NULL,
  certificateVersion           INTEGER NOT NULL CHECK (
    certificateVersion IN (1, 2)
  ),
  actorClass                   TEXT    NOT NULL CHECK (
    actorClass IN ('legacy_editor', 'editor', 'scraper', 'agent')
  ),
  allowedOperationTypesJson    TEXT    NOT NULL CHECK (
    length(CAST(allowedOperationTypesJson AS BLOB)) BETWEEN 3 AND 4096
  ),
  scopeMode                    TEXT    NOT NULL CHECK (
    scopeMode IN ('legacy_editor', 'library_wide', 'bounded')
  ),
  scopeKind                    TEXT CHECK (
    scopeKind IS NULL OR scopeKind IN ('provider', 'source')
  ),
  scopeId                      TEXT CHECK (
    scopeId IS NULL
    OR length(CAST(scopeId AS BLOB)) BETWEEN 1 AND 4096
  ),
  issuanceIdentity             TEXT,
  retirementIdentity           TEXT,
  capabilityCertificateDigest TEXT    NOT NULL,
  issuedAtMs                   INTEGER NOT NULL CHECK (
    issuedAtMs BETWEEN 0 AND 9007199254740991
  ),
  retired                      INTEGER NOT NULL DEFAULT 0 CHECK (
    retired IN (0, 1)
  ),
  retirementCertificateDigest TEXT,
  PRIMARY KEY (libraryId, epochId, actorId),
  FOREIGN KEY (libraryId, epoch, epochId, actorId)
    REFERENCES library_core_actors (libraryId, epoch, epochId, actorId)
    ON DELETE CASCADE,
  CHECK (length(libraryId) = 64 AND libraryId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(epochId) = 64 AND epochId NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(actorId) = 64 AND actorId NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    length(capabilityCertificateDigest) = 64
    AND capabilityCertificateDigest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    issuanceIdentity IS NULL
    OR (
      length(issuanceIdentity) = 64
      AND issuanceIdentity NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    retirementIdentity IS NULL
    OR (
      length(retirementIdentity) = 64
      AND retirementIdentity NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    retirementCertificateDigest IS NULL
    OR (
      length(retirementCertificateDigest) = 64
      AND retirementCertificateDigest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (retired = 0 AND retirementCertificateDigest IS NULL)
    OR (retired = 1 AND retirementCertificateDigest IS NOT NULL)
  ),
  CHECK (
    (
      certificateVersion = 1
      AND actorClass = 'legacy_editor'
      AND scopeMode = 'legacy_editor'
      AND scopeKind IS NULL
      AND scopeId IS NULL
      AND issuanceIdentity IS NULL
      AND retirementIdentity IS NULL
    )
    OR (
      certificateVersion = 2
      AND actorClass IN ('editor', 'scraper', 'agent')
      AND scopeMode IN ('library_wide', 'bounded')
      AND issuanceIdentity IS NOT NULL
      AND retirementIdentity IS NOT NULL
      AND (
        (scopeMode = 'library_wide' AND scopeKind IS NULL AND scopeId IS NULL)
        OR (
          scopeMode = 'bounded'
          AND scopeKind IN ('provider', 'source')
          AND scopeId IS NOT NULL
        )
      )
    )
  )
) STRICT;

INSERT INTO library_core_actor_capability_state (
  libraryId, epoch, epochId, actorId, certificateVersion, actorClass,
  allowedOperationTypesJson, scopeMode, scopeKind, scopeId,
  issuanceIdentity, retirementIdentity, capabilityCertificateDigest,
  issuedAtMs, retired, retirementCertificateDigest
)
SELECT
  libraryId, epoch, epochId, actorId, 1, 'legacy_editor',
  '["account_remove","account_upsert","feed_item_archive_assignment","feed_item_capture_upsert","feed_item_like_assignment","feed_item_read_assignment","feed_item_remove","feed_item_saved_assignment","person_remove_and_accounts","person_upsert","preferences_leaf_assignment","rss_feed_remove_keep_items","rss_feed_remove_with_items","rss_feed_upsert"]',
  'legacy_editor', NULL, NULL, NULL, NULL,
  enrollmentCertificateDigest, enrolledAtMs, 0, NULL
FROM library_core_actors;

CREATE INDEX library_core_actor_capability_active
  ON library_core_actor_capability_state (
    libraryId, epochId, retired, actorClass, actorId
  );

PRAGMA user_version = 12;
