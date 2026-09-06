# Avatar review 09

September 5, 2026. Six new avatar recommendations and one held Frogbert replacement. No runtime edits or admissions.

Confirmed the actual profile IDs from the arcs: `alba-longwing`, `basil-backward`, `clove-clatter`, `ludo-leap`, `nellie-nudge`, `sorrel-spring`. Ludo Leap is the regal jumping spider, not Ludo Bluecap. Nellie Nudge is the Florida manatee, not the proposed weevil Nellie Notch. Basil Backward is the slipper lobster, not the catalog's historical basalt label. Nova was outside this review's ownership.

## Independent review method

Read the current arcs, current avatar map and FROGBERT-VISUAL-CANON-02. No suitable already-aggregated portrait was found for these six identities. Obtained fresh Commons original hashes, dimensions, descriptions, categories, creators and licenses for eleven candidates. Viewed complete image framing in an isolated headless Playwright session before making crops. Then inspected actual circular crops at 220 and 48 CSS pixels, using the runtime's square source crop, normalized focal coordinates, edge clamp and 256-pixel intermediate canvas.

- `output/playwright/avatar-review-09-full.png`: first eight complete images, including the rejected museum lobster.
- `output/playwright/avatar-review-09-more-full.png`: three live lobster/crab alternatives.
- `output/playwright/avatar-review-09-crops.png`: first crop pass, superseded.
- `output/playwright/avatar-review-09-crops-final.png`: final seven visual decisions. Use this sheet for lead review.
- [Six proposed records](avatar-crops-09.json): exact source and image URLs, original SHA1, dimensions, credit/license, focal points and aggregation flag. The held Frogbert candidate is excluded from this JSON.

The browser was closed. No image binaries were added to Git. Local screenshots are untracked review evidence, not publication assets. Source loading and canvas screenshots do not establish production avatar-delivery or WebGL success.

## Recommendations

| Character | SHA1 | Focal x, y, zoom | Visible evidence |
| --- | --- | --- | --- |
| Clove Clatter | `d22e5f02ef39f32230ce492d115bc4ae9209109c` | `0.53, 0.55, 2` | Recommend. One visible blue-legged hermit crab, protruding eyes, dark head and conspicuous blue legs with orange joints. At 48 pixels the legs and dark face separate from the shell. Aquarium scene; no claim of a wild Key Largo exposure. |
| Nellie Nudge | `aba9a528563e81d8a0b5043d359fc87e7711ee5c` | `0.52, 0.43, 1.8` | Recommend. The front animal's broad muzzle, small eyes and flippers remain clear. The full image contains another manatee at far left; the final circle excludes that animal completely. At 48 pixels the nose and rounded face remain legible. No calf or mother is inferred. |
| Sorrel Spring | `c263066d24a1ee1c33c581da1909c65851cd18a2` | `0.25, 0.38, 3` | Recommend. The foreground jerboa's dark eye, short rounded ear, whiskers and small forepaws remain visible. Another animal farther behind is present in the full photograph and completely excluded from this circle. No parentage or age transition is assigned. At 48 pixels the face and ear remain distinct. |
| Alba Longwing | `2527881b2d12ddbd9941c08d183bff9845e54d2a` | `0.60, 0.48, 2.3` | Recommend as a flight silhouette, not an eye-contact portrait. The revised crop retains the complete bill and white head, upper body and broad dark wings. Wing tips and tail extend beyond the circle, but at 48 pixels one banked albatross remains recognizable. This fixes the first crop's clipped bill. |
| Ludo Leap | `4a4bd8407f474bb534b5dd688b314f4909cc7344` | `0.47, 0.49, 1.2` | Recommend. Close portrait of one male regal jumping spider, with large forward eyes and blue-green chelicerae. The front eyes and iridescent structures remain distinct at 48 pixels. No prey, second spider or incompatible female color form is introduced. |
| Basil Backward | `e20e6efadfc41b9de4bac57cdfd99c6d05a6d6a1` | `0.45, 0.55, 1.6` | Recommend as a recognizable slipper-lobster portrait. Broad shovel-like antennae, forebody and legs are visible. The photograph is softer than the best portraits, but the flattened head shape and paired antennae remain readable at 48 pixels. One live animal in aquarium habitat, not the museum specimen. |

## Frogbert: species passes, tiny portrait remains held

I inspected the exact requested original hash `b9606d59340989ec6073ffdd227de149265c718d`, [Antennarius striatus 2.jpg](https://commons.wikimedia.org/wiki/File:Antennarius_striatus_2.jpg). Fresh Commons metadata confirms Stephen Childs, CC BY 2.0, original 1,121 × 1,600; file title, description and category explicitly identify Antennarius striatus. This is a valid species-consistent candidate, not the unidentified fish being removed from the current avatar map.

The complete photo shows a grain-covered, head-on hairy frogfish. Two actual crops were inspected:

- `0.55, 0.66, 1.4`: the mouth and one orange eye can be found at 220 pixels, but coarse grains dominate the 48-pixel circle.
- `0.50, 0.63, 1`: more of the face and head outline survive, but the 48-pixel circle still reads mainly as sand and texture. This is the candidate shown on the final sheet.

Recommendation: **hold for avatar quality**. Verified species alone does not make an effective small portrait. Do not count this as an approved replacement or re-add the earlier unidentified avatar. A clearer striatus face, possibly a carefully isolated fish from the approved pair, still needs its own review. Both owner-approved Frogbert passages and their media remain untouched by this review.

Exact reviewed delivery URL: [960-pixel Antennarius striatus 2.jpg](https://thumb.wikimedia.org/wikipedia/commons/thumb/7/76/Antennarius_striatus_2.jpg/960px-Antennarius_striatus_2.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail). The source hash identifies the original file, not the thumbnail.

## Source, taxonomy and continuity checks

**Clove:** [Hermit crab cropped.jpg](https://commons.wikimedia.org/wiki/File:Hermit_crab_cropped.jpg), RevolverOcelot, CC BY-SA 3.0, 2,028 × 1,488. Fresh category is Clibanarius tricolor; description names blue-legged hermit crab. The blue limbs agree with the named subject. The first `Clibanarius tricolor.jpg`, SHA1 `cf8f0c85d689c522f778021988fd3b459a76e4dc`, was mostly dark shell. `ClibanariusTricolor.jpg`, SHA1 `6d14d067576419bd619ea3333d3e78a2e21b64cf`, was a distant overhead shell and legs. Neither gave a comparably clear face.

**Nellie:** [Here's Looking at You Kid: Meet a Florida Manatee](https://commons.wikimedia.org/wiki/File:Here%27s_Looking_at_You_Kid_-_Meet_a_Florida_Manatee.jpg), 3,072 × 2,304. Fresh category explicitly identifies Trichechus manatus latirostris of Crystal River. The source description credits **Robert Bonde, USGS**; retain that actual photographer credit rather than only the API's agency field. Exact file license is CC BY 2.0, retained in the proposal instead of silently declaring all USGS-hosted material public domain. The alternative FWS 26 photo, SHA1 `e963b7e46e560e7bf72212b8145bbd2444d64cea`, shows a side view with a school of fish and has a weaker face.

**Sorrel:** [Jaculus jaculus.jpg](https://commons.wikimedia.org/wiki/File:Jaculus_jaculus.jpg), Elias Neideck, CC BY-SA 3.0, 2,292 × 1,776. Both title and category identify Jaculus jaculus. Full framing shows long hind legs, long tail and short ears compatible with this lesser Egyptian jerboa, not the conspicuously long-eared jerboa. The source supplies no exact age or sex; no such claim is added. The portrait does not relocate the fictional Sinai home.

**Alba:** [Northern royal albatross (31759302480)](https://commons.wikimedia.org/wiki/File:Northern_royal_albatross,(_Diomedea_sanfordi,)_(31759302480).jpg), Bernard Spragg, CC0, 3,196 × 2,004. Source title names Diomedea sanfordi, and category is Diomedea sanfordi in flight. The image shows a white body and dark upperwings. Do not substitute wandering or southern royal albatross imagery based on a generic white head. Sex is not supplied by the source; the image adds no conflicting sex-specific claim to Alba's existing female voice.

**Ludo:** [Phidippus regius male.jpg](https://commons.wikimedia.org/wiki/File:Phidippus_regius_male.jpg), Wenzel Sylvester, CC BY-SA 4.0, 4,848 × 3,234. File title and description explicitly identify the male, with blue-green chelicerae. The face agrees with the identification. This establishes a male portrait choice for lead canon review; no existing accepted female portrait or explicit contrary sex assignment was found in this bounded arc review. Do not infer behavior from the close-up.

**Basil:** [Blunt Slipper Lobster (Scyllarides squammosus), GRB](https://commons.wikimedia.org/wiki/File:Blunt_Slipper_Lobster_(Scyllarides_squammosus)_-_GRB.JPG), George Berninger Jr., CC BY-SA 3.0, 1,779 × 1,395. Description explicitly locates the live animal at Churaumi Aquarium, Okinawa. Title/category identify Scyllarides squammosus. The [Waikiki Aquarium species guide](https://www.waikikiaquarium.org/experience/animal-guide/invertebrates/crustaceans/slipper-lobster/) identifies this as one of Hawaii's relatively shallow reef slipper lobsters, so it is compatible with Basil's Maui setting. This is a proposed visual species anchor for the broad existing slipper-lobster character, not a claim that the Okinawa photograph was taken at Maui. Source sex is unspecified.

The first Basil candidate, [Scyllarides squammosus.jpg](https://commons.wikimedia.org/wiki/File:Scyllarides_squammosus.jpg), SHA1 `f6ac33fd6cd1beb5d1e59563ea60454f7056f393`, is a displayed museum specimen with a label. Its source category and full image agree on that context. It was rejected before crop admission.

## Lead handoff

All six proposed media records are new to the inspected aggregate and marked `alreadyAggregated: false`. Aggregate only lead-approved records before binding avatars. Frogbert remains a separate held repair and is absent from the proposal JSON. Avatar admission does not admit a new post or any existing image-less draft, and no body copy was changed.

## Lead admission

Lead independently inspected the final seven-decision sheet. Six recommended portraits accepted and aggregated before mapping. Frogbert remains held for tiny-crop legibility. Basil is now visually anchored to Scyllarides squammosus and Ludo Leap to a male Phidippus regius; these choices do not admit any episode.
