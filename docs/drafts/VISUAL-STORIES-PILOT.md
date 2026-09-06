# Visual Stories pilot

Six lead-approved in-place conversions of already admitted pairings are implemented. No new episode, duplicate photograph, accepted-count increase, or prose rewrite. The target remains 900 regular entries plus 100 visual Stories, exactly 1,000 total.

Each conversion adds only `contentType: "story"` to the existing episode. Character IDs, ordinals, platforms, titles, bodies, image hashes and chronology are unchanged. These are short visual Instagram/Facebook dispatches. RSS articles are not converted or relabeled as Stories. The regular bucket decreases by six and the visual Story bucket increases by six; the total stays unchanged.

This pilot has five Instagram entries and one Facebook entry. It is not the proposed final channel ratio. The remaining Story selection should broaden subjects and include more Facebook accounts. No new photo review is claimed here: these exact pairings were independently viewed and admitted in ocean batches 11, 12 and 13. Their Story crops still require rendered review; filling a portrait frame must not crop away the features named below.

## 1. Dot Thimble: A little too secure

Stable slot: `dot-thimble`, episode 2. Platform: `instagram`. Proposed content type: `story`.

> I told him I was relaxed. He glanced at my tail. I loosened it one turn. The branch moved. I put the turn back before either of us could form an opinion.

Image SHA1: `60b71bfd616cf7c294da7eec8898ab642f31ebc1`.

[Exact delivery image](https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/Pygmy_Seahorse_%28Hippocampus_bargibanti%29_%286079487627%29.jpg/1280px-Pygmy_Seahorse_%28Hippocampus_bargibanti%29_%286079487627%29.jpg) · [Source and attribution](https://commons.wikimedia.org/wiki/File:Pygmy_Seahorse_(Hippocampus_bargibanti)_(6079487627).jpg). Creator: Bernard DUPONT from FRANCE. License: CC BY-SA 2.0.

Scene fit and crop constraint: Keep the wrapped tail visible. That grip is the evidence behind the failed claim of relaxation. The companion and exchange are fictional; do not imply another seahorse appears in frame.

## 2. Dot Thimble: The full distance

Stable slot: `dot-thimble`, episode 5. Platform: `instagram`. Proposed content type: `story`.

> A fish asked how far away the other side of the fan was. I told her it depended how many places she intended to panic. She said she meant in a straight line. I don't know anyone who lives like that.

Image SHA1: `3d8b38d0e27f10c98ad4067c1ab7a0557565374c`.

[Exact delivery image](https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/Hippocampus_bargibanti_%2816244523652%29.jpg/1280px-Hippocampus_bargibanti_%2816244523652%29.jpg) · [Source and attribution](https://commons.wikimedia.org/wiki/File:Hippocampus_bargibanti_(16244523652).jpg). Creator: Rickard Zerpe. License: CC BY-SA 2.0.

Scene fit and crop constraint: Preserve enough branching coral around the face to communicate scale. The route and visiting fish are fictional, not visible actions. This is a brief account of distance from an anxious small body, not a long article.

## 3. Willa Drift: Still shaking

Stable slot: `willa-drift`, episode 1. Platform: `instagram`. Proposed content type: `story`.

> I tried to shake a bit of weed off. Everything shook. I stopped to see which bit was the weed. Everything stopped. This could take the rest of my life.

Image SHA1: `12e32e9ef5a59292bd7b172796d156545102d495`.

[Exact delivery image](https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Phycodurus_eques_P2023150.JPG/1280px-Phycodurus_eques_P2023150.JPG) · [Source and attribution](https://commons.wikimedia.org/wiki/File:Phycodurus_eques_P2023150.JPG). Creator: Peter Southwood. License: CC BY-SA 3.0.

Scene fit and crop constraint: Show the whole body with surrounding weed, rather than cropping to the head. Matching frills and vegetation make the confusion legible. The still photo does not document shaking.

## 4. Rue Ribbon: Much better for the current

Stable slot: `rue-ribbon`, episode 5. Platform: `facebook`. Proposed content type: `story`.

> I said I needed more space. He withdrew. A little too far, I thought. I told him the current felt different now. He came back up. I said that was much better for the current.

Image SHA1: `ce7f7d25d8f5f995bd4ca86bafe420ff705db60c`.

[Exact delivery image](https://upload.wikimedia.org/wikipedia/commons/1/13/Rhinomuraena_quaesita_%28Garman%2C_1888%29.jpg) · [Source and attribution](https://commons.wikimedia.org/wiki/File:Rhinomuraena_quaesita_(Garman,_1888).jpg). Creator: BEDO (Thailand). License: CC BY-SA 4.0.

Scene fit and crop constraint: Keep both eel heads in frame. The pair is genuinely visible; the negotiated distance is fictional. Do not turn this into an unsupported mating claim.

## 5. Vera Veil: Keep talking

Stable slot: `vera-veil`, episode 6. Platform: `instagram`. Proposed content type: `story`.

> The current caught my edge while he was saying something lovely. I folded in half. He stopped. I told him to carry on. I wanted the rest of the compliment, even if I had to hear it upside down.

Image SHA1: `1846b7b8ade1b1e305194e566134a08c8271277b`.

[Exact delivery image](https://oceanexplorer.noaa.gov/wp-content/uploads/2020/09/20200914-hires.jpg) · [Source and attribution](https://oceanexplorer.noaa.gov/multimedia/daily-image-media-20200914/). Creator: NOAA Ocean Exploration, Gulf of Mexico 2018. License: Public domain.

Scene fit and crop constraint: Retain the curled swimming flap. It carries the physical interruption. The admirer and spoken compliment are offscreen fiction, not objects in this image.

## 6. Tavi Tilt: Within reach

Stable slot: `tavi-tilt`, episode 10. Platform: `instagram`. Proposed content type: `story`.

> She said my antennae were lovely. I had been showing her my clubs. I put those away.
>
> I meant to thank her. Instead I described how far my antennae could reach.
>
> She said she could see that.
>
> I pulled them back. She moved closer.

Image SHA1: `b05602b8f4c57ca8ef96874a008140cf042fa851`.

[Exact delivery image](https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Odontodactylus_scyllarus1.jpg/1280px-Odontodactylus_scyllarus1.jpg) · [Source and attribution](https://commons.wikimedia.org/wiki/File:Odontodactylus_scyllarus1.jpg). Creator: Jens Petersen. License: CC BY 2.5.

Scene fit and crop constraint: Preserve the extended antennae and folded striking appendages. The portrait supports the contrast between what Tavi displays and what he hears praised. The partner remains offscreen fiction.

## Type-only implementation

`SampleCharacterEpisode.contentType` optionally supports `post`, `story`, `article` and `video`, each compatible with the existing `ContentType` union. Missing values retain existing defaults. `SampleCharacterArc.platform` now also permits `youtube`, `medium` and `substack`; per-episode platform overrides reuse that union. These type changes alone neither fabricate playable videos nor change any published episode. Runtime projection remains a separate owner-reviewed implementation.
