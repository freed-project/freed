# Release Notes Workflow

Freed release notes now use a hybrid flow:

1. `./scripts/release.sh`
   Bumps app versions and generates draft release-note artifacts.
2. Review the generated files under `release-notes/`.
3. Edit the copy and daily editorial guidance as needed.
4. Mark the release file as approved.
5. Commit the review changes.
6. Run `./scripts/release-publish.sh <version>` to create the tag.

The release workflow only publishes notes from an approved checked-in release
artifact. GitHub Actions does not write final release prose on its own.

## Files

### `release-notes/releases/vX.Y.Z.json`

Per-build release artifact with:

- `approved`: must be `true` before tagging
- `editorialNotes`: optional human guidance for this specific build
- `release`: structured sections used for release notes
- `releaseBody`: rendered markdown used by the GitHub Release

### `release-notes/releases/vX.Y.Z.md`

Rendered markdown preview of the release body.

### `release-notes/daily/YY.M.D.json`

Per-day editorial memory. This is how one piece of feedback can carry across
later builds on the same day.

Important fields:

- `editorialGuidance`: human guidance about tone and emphasis
- `pinnedHighlights`: major items that should stay prominent in same-day rollups
- `rollup`: generated grouped-day summary used by the website changelog

## Typical Review Loop

1. Run `./scripts/release.sh`
2. Open the generated `release-notes/releases/vX.Y.Z.json`
3. Tighten any weak bullets
4. Add or update `pinnedHighlights` in the matching daily file when a theme
   should stay prominent for the rest of the day
5. Set `"approved": true` in the release file
6. Commit the reviewed notes
7. Run `./scripts/release-publish.sh X.Y.Z`

## Environment

- `OPENAI_API_KEY`: optional, used to generate stronger draft notes
- `OPENAI_RELEASE_NOTES_MODEL`: optional, defaults to `gpt-5.4`

If no OpenAI key is present, the generator falls back to deterministic
heuristics so the workflow still works.
