# Stability artifact schemas

`stability-artifact-v1.schema.json` is the checked-in interchange contract for
the evidence capture, memory profile, sync replay, provider risk review, and
stability controller skills.

Draft a manifest outside the repository, validate it with:

```bash
node scripts/stability-artifact.mjs validate --input <manifest.json> --kind <kind>
```

Write an immutable, content-addressed copy to the automation state root with:

```bash
node scripts/stability-artifact.mjs write --input <manifest.json>
```

The default destination is
`~/.freed/automation/artifacts/<kind>/<task-id>/<timestamp>-<digest>.json`.
The writer adds `artifactDigest`, uses an atomic rename, and reuses an identical
artifact instead of creating duplicate control input.

Every manifest requires at least one source reference with a SHA-256 digest.
Kind-specific payload fields are typed and validated, not merely checked for
presence. A manifest with an embedded `artifactDigest` is accepted only when
the digest still matches the complete artifact content.
