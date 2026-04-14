# Release Notes Workflow

Freed release notes now use a hybrid flow:

1. `./scripts/release.sh`
   Bumps app versions and generates draft release-note artifacts.
   Pass `--channel=dev` for a dev prerelease, or omit it on `main` for production.
2. Review the generated files under `release-notes/`.
3. Edit the copy and daily editorial guidance as needed.
4. Mark the release file as approved.
5. Commit the review changes.
6. Run `./scripts/release-publish.sh <version>` to create the tag.

## Channels

- Production tags use `YY.M.DDBUILD`, for example `26.4.1203`
- Dev tags use `YY.M.DDBUILD-dev`, for example `26.4.1204-dev`
- Release artifacts now include a top-level `channel` field so workflows can publish dev builds as prereleases

The release workflow only publishes notes from an approved checked-in release
artifact. GitHub Actions does not write final release prose on its own.

## Files

### `release-notes/releases/vX.Y.Z.json`

Per-build release artifact with:

- `channel`: `production` or `dev`
- `approved`: must be `true` before tagging
- `editorialNotes`: optional human guidance for this specific build
- `release.deck`: terse noun-phrase heading for the most meaningful shipped outcomes
- `release.features`: up to 3 headliner bullets
- `release.fixes`: concrete bug fixes and repairs, capped at 15 lines
- `release.followUps`: the remaining supporting changes for that day, capped at 15 lines
- `releaseBody`: rendered markdown used by the GitHub Release

### `release-notes/releases/vX.Y.Z.md`

Rendered markdown preview of the release body.

### `release-notes/daily/<channel>/YY.M.D.json`

Per-day editorial memory. This is how one piece of feedback can carry across
later builds on the same day.

Important fields:

- `preferredDeck`: optional exact heading for the latest release of that day
- `editorialGuidance`: human guidance about tone and emphasis
- `pinnedHighlights`: major items that should stay prominent in later same-day releases
- `editorialNotes`: freeform notes for future drafting

The daily file no longer stores rendered website bullets. The website now uses
the latest approved release of a day as the source of truth for that day's
grouped card.

## Typical Review Loop

1. Run `./scripts/release.sh --channel=production` from `main`, or `./scripts/release.sh --channel=dev` from `dev`
2. Open the generated `release-notes/releases/vX.Y.Z.json`
3. Tighten the `deck`, `features`, `fixes`, and `followUps`
   The deck should read like `X, Y, and Z`, not a sentence
   Features should use shipped-product language, not commit tense
   If fixes or follow-ups run long, consolidate related items into one line
4. Add or update `pinnedHighlights` in the matching daily file when a theme
   should stay prominent for the rest of the day
5. Set `"approved": true` in the release file
6. Commit the reviewed notes
7. Run `./scripts/release-publish.sh X.Y.Z`

The publish step validates that:

- the deck does not duplicate a feature or follow-up
- there are at most 3 features
- there are at most 15 fixes and 15 follow-ups after consolidation
- same-day latest releases still include earlier same-day highlights

Freed Desktop update prompts use the deck line only. They do not render bullet lists.

## Environment

- `OPENAI_API_KEY`: optional, used to generate stronger draft notes
- `OPENAI_RELEASE_NOTES_MODEL`: optional, defaults to `gpt-5.4`

If no OpenAI key is present, the generator falls back to deterministic
heuristics so the workflow still works.

## Historical regeneration

Use the dedicated migration script to regenerate artifacts and optionally
rewrite GitHub release bodies:

```bash
node scripts/backfill-release-notes.mjs
node scripts/backfill-release-notes.mjs --rewrite-github
node scripts/backfill-release-notes.mjs --rewrite-github --dry-run
```
