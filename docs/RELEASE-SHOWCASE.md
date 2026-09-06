# Release screenshots and GIF

The production release workflow captures five views from the PWA built at the
release tag: Unified Feed, Stories, Instagram, Map, and Friends. The result is
five PNG screenshots and a looping GIF slideshow. It is not an interaction
recording or a capture of the installed native application.

The browser uses an anonymous demo Library. Capture waits for the welcome
overlay to close, content to populate, and visible images and fonts to load.
Map capture additionally waits for MapLibre's settled tile state. Map instance
construction alone is not acceptance: markers can appear before the basemap.
Demo imagery remains externally hosted. A capture failure blocks publication.

After GIF generation, the manifest records the release commit, capture details,
asset sizes, SHA-256 checksums, and public download URLs. The workflow uploads
the files to the draft GitHub release. After publication it downloads both the
tag-specific and latest URL for every image and checks their bytes against the
manifest. A failed public check means the release needs attention, even if its
desktop packages were already published.

The capture also records the rendered Unified Feed and Stories counts. Release
finalization records `corpusStage: interim` for the owner-authorized functional
release before editorial completion. Only exactly 900 regular entries and
100 visual Stories, totaling 1,000, can be labeled `complete`. Both stages
require consistent positive counts, all five rendered captures, and the same
asset integrity and public URL checks. Public verification rejects a stage
that disagrees with its counts. Counts do not replace editorial review or
matching-image verification.

## Use the files

1. Open the completed production release on GitHub and expand **Assets**.
2. Download `freed-showcase-manifest.json`. Its asset entries contain the exact
   links for that release and links that follow GitHub's latest release.
3. Use a tag-specific link for reproducible documentation. Use the latest link
   for a page that should follow production releases automatically.

After the first successful publication, this Markdown embeds the slideshow:

```markdown
![Freed product preview](https://github.com/freed-project/freed/releases/latest/download/freed-showcase.gif)
```

The homepage should offer a static PNG for visitors who request reduced motion.
Keep that website change in the `www` lane. Do not embed the latest URL before
the first verified asset exists. GIFs and screenshots stay in GitHub release
storage, not in the repository.

A PWA-only snapshot deployment does not run this tagged release workflow and
does not generate a new asset set. Dev releases skip showcase publication.

## Current verification

The previous production release, `v26.8.1901`, contains no showcase assets.
The repaired pipeline still needs an exact-source browser capture and a
successful production run before its public links can be called ready.
