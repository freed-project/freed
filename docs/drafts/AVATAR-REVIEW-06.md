# Avatar review 06

September 5, 2026. Five crops admitted locally after the lead independently inspected the rendered 220-pixel and 48-pixel circles. The exact proposed focal points and character mappings are integrated. Bramble remains held. This is local avatar admission, not production delivery verification.

Read the existing avatar map, focal points, prior review 01 and 02, current arcs, and the runtime crop implementation. Reused existing catalog hotlinks. Inspected complete image framing first in an isolated headless Playwright browser, then actual circular crops at 220 and 48 CSS pixels. Canvas drawing used the runtime's 256-pixel intermediate crop and its source-coordinate formula: square side equals the shorter source dimension divided by zoom; focal x/y are normalized source coordinates; crop edges are clamped to the image. This is not CSS object-position approximating the runtime.

Local evidence:

- `output/playwright/avatar-review-06-full.png`: eleven full-frame candidates, with subject and hash labels.
- `output/playwright/avatar-review-06-crops.png`: eight tested focal crops, each shown at 220 and 48 pixels.
- [Exact proposed rows](avatar-crops-06.json): source URL, image URL, creator, license, dimensions, full SHA1 and crop settings for the five recommendations.

No image binaries were added to Git. The browser session was scoped to this review and closed. No runtime files were changed. These checks establish browser image and crop rendering; they do not certify the separate production avatar delivery or WebGL path.

## Decisions

| Character | SHA1 | Focal x, y, zoom | Decision and visible evidence |
| --- | --- | --- | --- |
| Nessa Whisker | `9e24b0348fd09652399ecf64d61b561f06217d3f` | `0.515, 0.43, 4` | Recommend. One summer-coated Arctic fox, both ears and eyes, black nose and open mouth. Pale sky separates the whole face at 48 pixels. Crop excludes the ground without confusing a second animal. Summer coat fits the accepted later chronology. |
| Pella Wideawake | `8d005d86f17c1c8293041d4b2997700b7663b1f8` | `0.38, 0.50, 1.1` | Recommend. One Philippine tarsier face. Both enormous eyes and small muzzle remain complete at 220 pixels and recognizable at 48. Ears are outside this close portrait, but no second animal or competing object creates identity ambiguity. |
| Finch Fidget | `48d1f523316f5c6e88284e388cd209e2d5aad301` | `0.44, 0.37, 2` | Recommend. One quokka facing the camera, both ears, eyes and dark nose visible. At 48 pixels the nose and ears distinguish the face from its textured background. The source's body and held vegetation establish the full animal before cropping. |
| Willa Drift | `94af8624565c4a94c21bf13f61bf19720f4e6024` | `0.25, 0.59, 2.5` | Recommend as a leafy-seadragon portrait. The lower-left head and long snout now survive the circle, together with leaf-like appendages against dark blue water. At 48 pixels the orange silhouette and projecting snout remain distinct, although the eye is tiny. This resolves the missing-head failure in review 02. The catalog's legacy `identityNameBase` says Leaf Erickson; the proposal's explicit `characterId` binds the reviewed source to Willa, not a new identity. |
| Rollo Round | `ba6000625ba4db870dc40fd30c019038bf6430c4` | `0.65, 0.48, 1.5` | Recommend. One blackspotted puffer in side view. Eye, blunt mouth, cheek spots and yellow fin remain visible. Reef texture is concentrated below the face, and at 48 pixels the eye and muzzle still read clearly. |
| Bramble Shortlegs | `ee8525784aded7bb55e47ffa94cace257e3f6b9f` | Tested `0.30, 0.64, 2.5` | Hold. This accepted memory photograph contains an adult female and juvenile. The tested adult crop removes the juvenile but cuts the muzzle and reads as undifferentiated fur at 48 pixels. More importantly, the accepted episode identifies the adult as Mother and Bramble as the remembered juvenile. Do not silently make Mother's portrait his avatar. A separate single adult common-wombat catalog candidate is needed. |

## Source identity and alternatives

Nessa's source is [Arctic Fox on Banks Island 04](https://commons.wikimedia.org/wiki/File:Arctic_Fox_on_Banks_Island_04.jpg), Stephan Sprinz, CC BY 4.0. The complete photograph shows one live fox on a rise. The alternate molt image, `4166db4f4461285fb2e09caacdea9a314562cadf`, was also tested at `0.485, 0.46, 3`. Its face becomes identifiable but still merges with grey gravel and loose fur at the small size. Prefer the new clear-sky portrait. Neither source is a claim that the Banks Island animal physically traveled to Nessa's fictional Svalbard home.

Pella's [Philippine Tarsier Bohol](https://commons.wikimedia.org/wiki/File:Philippine_Tarsier_Bohol.jpg), John Martin PERRY, CC BY-SA 4.0, has an explicit subject and location in its established source record. The alternative `89d806673889ab0a8d2f37592dd53fa65080dbe4` is a more distant tarsier surrounded by bright leaves; it gives a weaker small face.

Finch's [Quokka (Setonix brachyurus) (27725086285)](https://commons.wikimedia.org/wiki/File:Quokka_(Setonix_brachyurus)_(27725086285).jpg), patrickkavanagh, CC BY 2.0, explicitly names the species. The alternate `9eb3ca7e637dd9840aea52ff562ee007bf29be5b` contains two quokkas in close contact and was excluded from the avatar proposal before cropping.

Willa's [Leafy Seadragon on Kangaroo Island](https://commons.wikimedia.org/wiki/File:Leafy_Seadragon_on_Kangaroo_Island.jpg), James Rosindell, CC BY-SA 4.0, is the existing reviewed leafy-seadragon source. The recent close-up `da7d71889cba543a2cab3eaae73866e2e2b83b33`, tested at `0.51, 0.44, 1.3`, makes the animal's yellow head and frills merge with green water and nearby growth. The older dark-blue source gives a cleaner icon. This is portrait acceptance only, not evidence of an offscreen shrimp.

Rollo's [Arothron nigropunctatus 1](https://commons.wikimedia.org/wiki/File:Arothron_nigropunctatus_1.jpg), Dr. Dwayne Meadows, NOAA/NMFS/OPR, public domain in the existing catalog, names the species. The alternative `1448f5d76905360a4b463d8bd1071b7a7b6fc523` is an overhead view with adjacent shadow; it suits the accepted shadow story better than a face-led avatar.

Bramble's [common wombat female with juvenile](https://commons.wikimedia.org/wiki/File:Common_wombat_(Vombatus_ursinus)_female_with_juvenile_Maria_Island_2.jpg), Charles J. Sharp, CC BY-SA 4.0, reliably identifies the species but cannot override the accepted fictional family roles. The held crop is intentionally absent from the proposal JSON.

Source provenance above comes from the existing accepted catalog records and cited file identities. This pass independently reviewed image content and crops; it did not refetch Commons API license metadata or hash the transformed thumbnail bytes as though they were original files.

## Lead handoff

The five proposed SHA1 values already exist in the aggregated media catalogs. After lead review, add only explicit character mappings and focal points. Preserve the held Bramble gap until a suitable source is reviewed. Do not count this document or its proposal JSON as five completed runtime avatars.
