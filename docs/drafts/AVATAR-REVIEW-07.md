# Avatar review 07

September 5, 2026. Five portraits admitted locally: Bramble, Faye, Ines, Mira and Velvet. The lead independently inspected all five 220-pixel and 48-pixel rendered circles and approved the proposed focal settings. Three new media rows were aggregated before their avatar mappings. Pip remains held. These are local admissions, not production delivery proof.

## Method and evidence

Read the current arcs, avatar map, prior review 02 and review 06. Inspected six existing or draft source images at full framing in an isolated headless Playwright session. Then inspected four newly sourced images. Reviewed the five final circular crop proposals at 220 and 48 CSS pixels, using the same square-source crop, edge clamp and 256-pixel intermediate canvas as the runtime. Focal settings are source coordinates, not CSS object-position.

- `output/playwright/avatar-review-07-full.png`: six initial candidates, complete framing.
- `output/playwright/avatar-review-07-new-full.png`: four new candidates, including the rejected squid illustration.
- `output/playwright/avatar-review-07-crops.png`: five proposed crops at both requested sizes.
- [Exact proposal metadata](avatar-crops-07.json): full URLs, hashes, dimensions, licenses, credits, source identity evidence, focal points, alt text and whether each source is already aggregated.

The three new recommended sources have fresh Commons API `imageinfo` and category evidence from this review. SHA1 and dimensions refer to the original asset, not its 960-pixel delivery thumbnail. Mira and Velvet reuse established catalog provenance. Browser loads establish image availability for this review, not production WebGL/CORS acceptance. No image binaries were added to Git. Screenshots remain untracked local review evidence and must not be published with the text files. The isolated browser was closed.

## Proposed crops

| Character | SHA1 | Focal x, y, zoom | Independent visual decision |
| --- | --- | --- | --- |
| Bramble Shortlegs | `d970eb22c747e9ecaab6d7f67ce95059b3de38ac` | `0.55, 0.48, 1.05` | Recommend. A single common wombat with a broad, adult-proportioned body rests its muzzle over its front paws. Both eyes, blunt muzzle and claws remain visible at 220 pixels. The broad face and nose remain readable at 48. No second animal, known fictional mother, or juvenile relationship is being silently reassigned. Source does not specify exact age or sex. |
| Faye Thread | `c09fc4fb01f26ae08b3107a2b3a83700e7ec7ee1` | `0.57, 0.36, 2` | Recommend. One male southern masked weaver. Yellow crown and breast, complete black face mask, red eye and projecting bill remain clear. At 48 pixels the yellow/black head remains recognizable; surrounding branches do not cross the face. |
| Ines Inkcap | `518b3a329675a707220963bfd75d396b64ac95d1` | `0.51, 0.44, 1.2` | Recommend. One Inca tern facing the camera. Red bill and both curled white moustache feathers survive the circle at 220 pixels and remain distinct at 48. Quiet grey background. This is a captive Artis portrait, not evidence of a wild Peruvian scene. |
| Mira Mask | `09edc781bc141cd69b3ccd00d3a9aaf7bb417b27` | `0.43, 0.46, 4` | Recommend. One raccoon from the accepted stream photograph. Both ears, eye mask and nose survive the crop, with a small part of shoulder and neck. At 48 pixels the high-contrast mask separates the face from the rocky background. |
| Velvet Night | `42278fec6e965262d43eaad25091aab733dad3c5` | `0.44, 0.52, 1` | Recommend as a moth silhouette rather than a face portrait. The shifted crop includes head/antenna area, body and broad patterned wings beside the cocoon. At 48 pixels the characteristic wing shape and pale windows remain recognizable against black. Small wing-tip clipping remains at the circle's left edge, but the image now reads as one moth rather than an isolated wing fragment. Lead should assess the silhouette at native 48-pixel size. |

## New source provenance

### Bramble

[CommonWombat.jpg](https://commons.wikimedia.org/wiki/File:CommonWombat.jpg), Ena Music, CC BY-SA 4.0, original 6,016 × 4,016. Fresh category evidence includes `Vombatus ursinus` and Maria Island National Park. The description states common wombat, Maria Island, Tasmania. The full photo is a close view of a single animal resting with its head over its paws. It is consistent with Bramble's common-wombat identity and Tasmanian home without asserting that Maria Island is Cradle Mountain.

The single grazing wombat from held LAND-REGULAR-05, SHA1 `ae7fd32d3d8f3071d729ed6d62664cf1bc5b39c3`, was inspected in full and passed species/form screening. Its lowered face is much less useful as an avatar. The mother-and-juvenile source remains excluded for the reasons in review 06. The new portrait does not resolve the separate masculine/feminine pronoun inconsistency documented in LAND-REGULAR-05-ADMISSION.

### Faye

[Southern Masked Weaver male RWD.jpg](https://commons.wikimedia.org/wiki/File:Southern_Masked_Weaver_male_RWD.jpg), Dick Daniels, CC BY-SA 3.0 selected from the source's licenses, original 1,473 × 1,234. Fresh metadata describes a male Ploceus velatus at Johannesburg; category also explicitly identifies Ploceus velatus. This matches Faye's current male southern masked-weaver canon. Johannesburg is the photograph's location, not a change to the fictional Okavango home.

The accepted nest-building source, SHA1 `7596421494764dbf754b9deb836e8872bc3d9e32`, leaves the small head partly hidden by leaves and nest material. Keep it for the authored scene; the new side portrait supplies a clearer identity.

### Ines

[Artis Inca tern (14010168986).jpg](https://commons.wikimedia.org/wiki/File:Artis_Inca_tern_(14010168986).jpg), Kitty Terwolbeck, CC BY 2.0, original 4,272 × 2,848. Title identifies Inca tern; fresh category is `Larosterna inca in Artis`. The description identifies Artis Royal Zoo, Amsterdam. This is an honest captive portrait of the correct species. Do not claim that its empty grey background shows the Peru coast.

The earlier pair photograph, SHA1 `c8a1d05b1bc35a0dee8d9d09644128c7065e0210`, shows two similar birds close together. It remains unsuitable for an unambiguous identity crop when this single-bird alternative exists.

## Existing source reuse

Mira reuses [Raccoon at water](https://commons.wikimedia.org/wiki/File:Raccoon_at_water._(aef5af31618e4c79aa563f9a309cf21d).jpg), the accepted LAND-REGULAR-04 photograph. Exact credit and license are retained in the proposal JSON. The full image shows one raccoon beside water; focal cropping changes neither the pictured species nor the source geography.

Velvet reuses [An Atlas moth in the morning](https://commons.wikimedia.org/wiki/File:An_Atlas_moth_in_the_morning.jpg). Full image inspection shows one moth hanging beside its cocoon. This is a crop repair of review 02's rejected centered avatar, not a new episode or a second moth. Exact established source metadata is retained in the JSON.

## Pip hold and taxonomy exclusions

The accepted `Squid party!.png`, SHA1 `6f0e9f5daab859ccae3ebfa4fb9be4143fe5695d`, shows many hatchling squid inside a clear container. It is an honest childhood group scene but cannot identify one adult Pip. No hatchling was arbitrarily selected as his completed avatar.

The apparent candidate [Euprymna scolopes.jpg](https://commons.wikimedia.org/wiki/File:Euprymna_scolopes.jpg), SHA1 `3f7cb7ac5e9afcfaa9f597ecb8009df3aa16bb3b`, is an illustration by R. L. Hudson. Fresh categories explicitly identify an illustration and retouched historical scan; full image inspection confirms it. Rejected before crop admission.

The separate [Euprymna scolopes (Bobtail squid).jpg](https://commons.wikimedia.org/wiki/File:Euprymna_scolopes_(Bobtail_squid).jpg) has misleading title/category identity. Its current description explicitly says probable Euprymna species, **not E. scolopes**, and gives a Timor-area photograph location. It is rejected for Pip despite the filename. Do not reuse this or its related color-form photograph as evidence of Hawaiian bobtail squid without resolving that contradiction.

A further bounded Commons metadata request for `Hawaiian bobtail squid 2.png`, `Hawaiian Bobtail Squid.jpg` and `Euprymna scolopes1.jpg` returned HTTP 403. Those files were not inspected or admitted. Pip still needs a verified single live E. scolopes portrait.

## Safe integration order

The proposal marks Bramble, Faye and Ines `alreadyAggregated: false`; their complete media fields are ready for a reviewed catalog addition. Mira and Velvet are already aggregated. The main editor must approve each crop, aggregate any new media rows first, then add avatar mappings and focal points. Nothing in this document admits a held narrative or changes public entry counts.
