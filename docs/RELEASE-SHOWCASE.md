# Production showcase animations

Every new production application version must regenerate the showcase for every
supported theme from that release's exact source. Treat asset generation,
publication, README delivery, and marketing verification as required release
work. Do not close a production release with missing themes, stale animations,
or an unverified website handoff.

## Required captures

Read the theme registry used by the application and marketing site. The current
themes are Ember, Midas, Scriptorium, Starship, Dark Star, and Neon. Include new
themes when they enter that registry; do not maintain an incomplete release list.

Generate one animation per theme with this exact sequence:

1. Unified Feed.
2. Map with one linked friend selected and its details visible.
3. Friends.
4. Friend detail.
5. Stories on mobile, with two columns.
6. Mobile reader.

Omit the separate Instagram mobile grid frame. Use 120% desktop interface zoom.
Preserve the reviewed mobile viewport and device framing. Bake the marketing
card radius and theme-aware border into desktop frames only, scaling their
pixel dimensions for export. Keep rounded corners and the mobile canvas
transparent, including partial alpha in device shadows. Do not add a border or
clipping radius to the whole animation element on the website.

Use the anonymous demo Library. Wait for content, images, fonts, map tiles,
graph layout and selected details to settle. Failed or incomplete captures
block the new asset set. Preserve existing corpus-stage and integrity checks;
content counts do not establish visual or editorial quality.

## Production assets and source proof

For every production version:

1. Capture every frame for every theme from the exact validated release source.
   Local iterations may retain approved frames, but production must not reuse
   frames from an earlier source or use desktop-only capture.
2. Export a transparent animated WebP for each theme, using the reviewed
   quality-90 setting unless the owner approves another setting. Retain the
   source PNGs and manifest. APNG and lossless WebP are review alternatives.
3. Publish each animation as `freed-showcase-<theme-id>.webp`, its static
   `freed-showcase-unified-<theme-id>.png` poster, and the manifest on the
   corresponding GitHub release. Scriptorium is the GitHub README variant.
4. Record tag, source SHA, theme, ordered frame identities, durations, dimensions,
   zoom, decoration tokens, file sizes, SHA-256 hashes and public URLs. Require
   all expected themes and six frames per theme. Decode the animation to check
   timing, looping, alpha and clearing between desktop and mobile frames.
5. Verify both immutable tag URLs and stable latest-release URLs against the
   published manifest. Follow redirects and verify bytes; an HTTP success alone
   does not prove freshness. Never replace old immutable assets to hide a failed
   capture. Follow the release workflow's existing failure and recovery rules.

## Marketing and README delivery

Use a separate `www` task and the existing `freed-ship-www` workflow for website
changes. Carry the source release ID, tag, SHA and manifest digest into that task.
Never merge `dev` into `www` to move showcase media or instructions.

The marketing animation must follow `activeThemeId`, including theme previews,
and reference the matching published WebP. Use the same theme's static poster
for reduced motion. Verify the rendered image source and downloaded hash for
all themes on the live site after each production release, even when stable
latest-release URLs make a website code change unnecessary. A local preview
URL, missing asset, older release hash, or fixed mixed-theme GIF fails closeout.

Keep the Scriptorium embed below the `Freed.wtf` link and above the first
horizontal rule in README.md.
Once its release asset exists and has passed public verification, use:

```markdown
![Freed in Scriptorium](https://github.com/freed-project/freed/releases/latest/download/freed-showcase-scriptorium.webp)
```

Verify that URL against the new Scriptorium asset on every production release.
Until the first verified per-theme publication, the README uses the checked-in
`docs/assets/freed-showcase-scriptorium.webp` preview. Its adjacent JSON records
local provenance. Do not change the README to a release URL that does not exist.
Switch the embed through the authorized documentation flow after first
publication; never move a tag or hand-edit a released commit to refresh a README.

Record the final asset URLs, expected and observed hashes, website theme checks,
and README source in release closeout. Missing deployment authority leaves the
website handoff pending; it does not waive verification.

## Local iteration and implementation status

`scripts/build-showcase-local.mjs` supports one-theme generation, explicit
`--all` generation, `--compare` encodings, and `--encode-only` iteration from
saved frames. Its local review server exposes timing and encoding controls.
These are review tools, not release publication authority or proof.

At this instruction update, the checked-in production workflow and
`scripts/lib/release-showcase-assets.mjs` still implement the older five-view,
mixed-theme GIF contract. Update those capture, manifest, upload and public
verification paths to the contract above before the next production release.
The marketing page now uses the active theme and a matching reduced-motion
poster. Its reviewed standalone asset set lives in `website/public/showcase/`,
with content-hashed URLs selected by `website/src/data/showcase.json`. This set
is an owner-reviewed showcase publication, not a tagged application release.
When publishing the next application release, update that mapping to the new
verified release assets and verify their live bytes. Instruction changes alone
do not implement or validate release automation. Stop release closeout if that
integration is missing.

Dev releases do not publish production showcase assets. A PWA-only snapshot
without a new application version does not count as a completed tagged
production release or satisfy its showcase obligations.
