# Social share image

Run `npm run generate:social-preview` from `website/` whenever showcase screenshots
are regenerated or their active mapping changes. The normal website build also
runs it. Unchanged source and template hashes preserve the reviewed PNG bytes
across build platforms; refreshed screenshots or design changes regenerate it. `npm run check:social-preview` verifies the checked-in output without
writing files.

The generator selects the mobile Stories frame from the homepage's active Ember
mapping in `src/data/showcase.json` and verifies its hash. Do not use the historical
`public/showcase/manifest.json` or retain a phone image from an older release.

`template.svg` preserves the approved typography as vector outlines, Ember colors,
provider icons, and phone positioning without depending on installed fonts.
`framing.json` locates the phone bezel within the source showcase canvas. Review
these bounds if capture geometry changes. Keep the screenshot's aspect ratio.

Preserve the approved composition when reviewing refreshed screenshots: the phone
starts 30 pixels below the top, extends below the tile, and has equal horizontal
space to its right, between it and the text block, and to the left of the text.
Keep the phone's approved scale, text placement, and accented logo without an
underline. Inspect the full-size image and a small link-card thumbnail for clipping,
readability, and location-label layout. Row count is not a layout requirement.

Commit the generated PNG and `src/data/social-preview.json` with the refreshed
showcase mapping. The generated record supplies both Open Graph and Twitter image
metadata and records the source asset, capture, crop, and template hash. After
shipping, verify the live metadata points to the new content-hashed PNG and that
its bytes match the generated record.
