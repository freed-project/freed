# P1-03: GDrive self-write filtering + no-op upload skip

runner-safe: false | provider-visible: true (changes Google Drive polling, download, and upload frequency) | soak-gated: YES (after P1-02 has a completed installed-build outcome)
Findings: F01 (poll leg). Prereq: P1-01/P1-02 merged.

## Defect

The GDrive Changes poll (`packages/sync/src/cloud/gdrive.ts` ~314-320) has no self-write filtering: every own upload is re-downloaded and re-merged ~5s later. Uploads also proceed when the merged binary is identical to the remote. Additionally, `gdriveUploadSafe` silently drops the If-Match header when the ETag header is absent (~163), silently disabling optimistic locking.

## Change

1. Record own file revision/md5 after each successful upload; skip change notifications matching it.
2. Byte-compare merged binary vs just-downloaded remote; skip the PATCH when equal.
3. While in the file: log (do not silently drop) when If-Match is omitted due to a missing ETag.

## Blast radius

GDrive adapter only. Dropbox untouched (finish-or-delete is a separate decision per program rules).

## Verify

- Unit tests with fixture change feeds: own-revision changes skipped; foreign changes processed.
- Idle single-device soak: download-merge count → ~0; Google API request volume drops an order of magnitude; 403 rate-limit errors disappear.
