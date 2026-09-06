# Avatar review 08

September 5, 2026. Six independent crop recommendations for lead review. No runtime edits, catalog aggregation, publication or completed-avatar claim.

## Method

Read current character arcs and the provisional land canon. Started with existing accepted images for Tully and Fern and the held pangolin media proposal. Wren's current accepted photograph shows hooves, so it cannot supply a portrait. Sumi had no aggregated image in the inspected catalog. Pip was reopened only after new source evidence established a single adult Hawaiian bobtail squid and its primary research attribution.

Fresh Commons API image metadata and categories were obtained for Wren, Mallow, two Sumi candidates, Pip's PNG and its parent TIFF. Metadata supplies original hashes and dimensions; transformed thumbnail bytes were not misrepresented as original hashes. Full images were independently viewed in an isolated headless Playwright browser before cropping. Actual circular crops were then inspected at 220 and 48 CSS pixels using the runtime square crop, source-coordinate focal points, clamped edges and 256-pixel intermediate canvas.

Evidence:

- `output/playwright/avatar-review-08-full.png`: six full-frame land candidates.
- `output/playwright/avatar-review-08-pip-full.png`: entire 800-pixel squid image, including its scale annotation.
- `output/playwright/avatar-review-08-crops.png`: initial crop pass, superseded.
- `output/playwright/avatar-review-08-crops-final.png`: final six proposals at both requested sizes. Use this for lead review.
- [Proposal metadata](avatar-crops-08.json): exact URLs, full hashes, dimensions, credits, licenses, focal points and aggregation flags.

The review browser was closed. No image binaries were added to Git. Screenshots are untracked local evidence, not publication assets. These checks establish visible crop quality and successful source loads in the review browser, not production CORS or WebGL delivery.

## Final crop decisions

| Character | SHA1 | Focal x, y, zoom | Visible evidence and recommendation |
| --- | --- | --- | --- |
| Tully Tumble | `7431bccd9df168ce5b8ff6c8ef62567641653166` | `0.61, 0.53, 2.8` | Recommend. Single rock hyrax from the accepted branch photograph. Ear, forehead, eye, whiskers and muzzle fill the circle. At 48 pixels the dark eye and nose remain visible against the soft background. It is an attentive side portrait, not a group crop. |
| Fern Longnose | `f3ae7a54e302fadd0331daabe2f8be0000cceac7` | `0.56, 0.38, 2.5` | Recommend. One white-nosed coati. Both ears and eyes, pale facial markings and complete long snout remain visible after revising the initially clipped nose. At 48 pixels the tapering white snout and black nose distinguish the face from the tree. |
| Wren Boulder | `0c520c2851a3b045bc5fa2bd449b990fbd1038f1` | `0.40, 0.22, 2.4` | Recommend. Source explicitly identifies a female klipspringer. Large ears, dark facial markings and complete muzzle remain visible; no horns appear. The slender neck and ear silhouette survive at 48 pixels. This preserves the female characterization in the provisional canon. |
| Mallow Fold | `ee256a5a0db7c007464a9b6311db5392ca8e3d53` | `0.32, 0.60, 1.5` | Recommend as a pangolin side portrait. The final crop retains the full pointed snout, eye and layered head/shoulder scales. At 48 pixels the scale texture and long snout remain recognizable. Water and reflection are background context, not a second animal. Source sex is unspecified; no sex-specific anatomy or new sex claim is introduced. |
| Sumi Smallhours | `7cc2e536b2f9307a72d9a0799bf3cd2f0a3918d8` | `0.52, 0.30, 2` | Recommend. A live pygmy slow loris grips branches. Both round eyes and dark nose survive the face crop. At 48 pixels the eye rings and round face are distinct. The photograph has conspicuous flash/eye reflection; this is photographic appearance, not glowing-eye biology. Source gives no sex or precise age, so neither is added to canon. |
| Pip Pocket | `8ee3a18f67319c6dd45c4faa2b468b976686a1df` | `0.49, 0.45, 1.45` | Recommend as a scientific portrait crop, subject to lead approval of that presentation. One explicitly adult E. scolopes. Eye, speckled mantle, fin and arm bases show against black. The circular edges trim the mantle end and arm tips; the central squid remains recognizable at 48 pixels. The final crop excludes the source's scale annotation completely. No hand, apparatus, label or second squid remains in the avatar. |

## Existing sources

Tully reuses [Giles Laurent's rock hyrax climbing a tree in Damaraland](https://commons.wikimedia.org/wiki/File:189_Rock_hyrax_climbing_a_tree_in_Damaraland_Photo_by_Giles_Laurent.jpg), CC BY-SA 4.0. The source title explicitly identifies rock hyrax. The pictured individual is alone; the family image from the same batch was not substituted. The image does not change Tully's fictional Matobo home or invent a relationship.

Fern reuses [white-nosed coati relaxing in a tree in Tulum](https://commons.wikimedia.org/wiki/File:White-nosed_coati_(Nasua_narica)_relaxing_in_a_tree_in_Tulum,_Quintana_Roo,_Mexico.png), Chuck Homler / Focus On Wildlife, CC BY-SA 4.0. The explicit Nasua narica title and full image agree. Tulum remains the source location; the fictional Corcovado home stays unchanged. This portrait does not establish photographed sex or parentage.

## New catalog proposals

### Wren

[Klipspringer female (51897521620)](https://commons.wikimedia.org/wiki/File:Klipspringer_(Oreotragus_oreotragus)_female_..._(51897521620).jpg), Bernard DUPONT, CC BY-SA 2.0, 3,648 × 4,440. Fresh category is Oreotragus oreotragus; title explicitly says female. Source description locates the image at Nkumbe in Kruger National Park, South Africa. Full photo shows a single alert animal with adult proportions. The portrait carries no claim of travel to Kruger or a subspecies change for the Serengeti character. Do not derive more specific taxonomy than the source supplies.

### Mallow

[Manis temminckii (29681414615)](https://commons.wikimedia.org/wiki/File:Manis_temminckii_(29681414615).jpg), CC BY 2.0, 1,024 × 660. Fresh category explicitly identifies Smutsia temminckii, the ground pangolin compatible with Mallow's southern African setting. Preserve the source description's actual photographic credit: **Tikki Hywood Trust**, distributed through the U.S. Fish and Wildlife Service. The API's uploader/artist field naming USFWS alone is incomplete attribution; the proposal keeps both.

The same image was proposed but not admitted in LAND-REGULAR-05. Its held narrative remains held. A face crop can pass as an avatar without admitting that reflection/drinking story. Sex and exact life stage are not supplied by the source and are not inferred here. The image shows a developed scaled body and one individual, not a mother-and-young scene.

### Sumi

[Nycticebus pygmaeus 010](https://commons.wikimedia.org/wiki/File:Nycticebus_pygmaeus_010.jpg), Dr. K.A.I. Nekaris, CC BY-SA 3.0, 1,300 × 1,733. Fresh category and description explicitly identify pygmy slow loris from Seima Biodiversity Conservation Area, Mondulkiri, Cambodia. The old source genus spelling is provenance, not a claim to resolve current taxonomic revisions. Sumi remains the existing pygmy slow-loris character with a Cat Tien home; no Cambodia trip or exact individual identity is asserted.

The alternative Ouwehands Dierenpark photograph, SHA1 `acfe59bf58eb08f8ccc3cea195091bb7d8309a57`, was viewed in full and rejected for avatar clarity. It is dark, softly resolved, and divided by foreground branches. The selected live animal is clear and species-consistent; it is not one of the dried-specimen search results, which were excluded before image selection.

### Pip: newly resolved evidence

[Hawaiian bobtail squid 2.png](https://commons.wikimedia.org/wiki/File:Hawaiian_bobtail_squid_2.png), Margaret McFall-Ngai, 800 × 800, is explicitly an **adult Euprymna scolopes** in the title/category/description record. Fresh original SHA1 is `8ee3a18f67319c6dd45c4faa2b468b976686a1df`. The exact delivered PNG is in the proposal JSON.

The file identifies its parent [Hawaiian Bobtail squid.tiff](https://commons.wikimedia.org/wiki/File:Hawaiian_Bobtail_squid.tiff), SHA1 `e804d6e59a8e473fcbcd00bfc3e7b61262246405`, and that parent cites Margaret McFall-Ngai's [2014 PLOS Biology article](https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1001783). I opened the primary article. Figure 1 identifies the adult host E. scolopes; its caption explains the separate hand inset as a size reference. The extracted PNG contains the animal and a 1 cm scale, but no hand inset. This is new, positive species and adult evidence rather than another attempt to accept the misidentified Timor photograph.

The article declares Creative Commons Attribution reuse with author and source credit. The exact extracted Commons PNG declares CC BY-SA 4.0; the proposal conservatively preserves that exact file's license rather than silently replacing it with the parent's terms. Attribute Margaret McFall-Ngai and retain the source chain. Describe the avatar as cropped from the scientific image. The final circular crop removes a measurement annotation, not a copyright credit. Keep the untouched source hotlink and original provenance.

The source is a scientific portrait, not a wild seafloor scene. Do not bind the full scale-bearing figure to a new narrative as though it were a gorgeous natural-scene photograph. This recommendation is limited to the reviewed avatar crop. The mistaken Euprymna photograph and the historical illustration rejected in review 07 remain rejected.

## Lead handoff

Tully and Fern are already aggregated. Wren, Mallow, Sumi and Pip are complete new media proposals, marked `alreadyAggregated: false`. After lead review, aggregate those four records before adding avatar hashes and focal points. Their approval would complete six profile mappings without adding six posts or admitting any held prose.

## Lead admission

Lead independently viewed the final six-profile crop sheet at both sizes. All six accepted as profile portraits. The four new sources were aggregated in sample-corpus-avatar-eight-media.json before the six hashes and focal points were bound. Pip is approved only as this scientific portrait crop; no held episode is admitted.
