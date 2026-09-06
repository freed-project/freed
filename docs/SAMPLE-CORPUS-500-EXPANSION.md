# Expansion to 500 authored episodes

## Progress snapshot: September 4

All three author assignments have finished and the local corpus integration reaches 500 episodes from 52 characters, including 145 RSS story entries. Tests, final delivery validation, and publication remain pending at this checkpoint. This is a saved snapshot, not an automatic live monitor or a production claim.

The integrated presentation count is 80 reviewed photo entries and 420 intentional text-only entries after removing eight mismatched Manny photographs. The base and three supplemental catalogs contain 1,772 source image records, including 20 newly reviewed additions. Source catalog size is not the public feed count.

| Batch | Characters | Episodes | RSS stories | Status |
| --- | ---: | ---: | ---: | --- |
| Original | 9 | 70 | 15 | Existing authored episodes retained with image-fit repairs |
| Ocean | 14 | 140 | 40 | Integrated with reviewed photos and explicit text-only entries |
| Land | 15 | 150 | 50 | Integrated with 4 reviewed photos and 146 text-only entries |
| Air | 14 | 140 | 40 | Integrated with reviewed photos and explicit text-only entries |
| Total | 52 | 500 | 145 | Local integration complete; tests and publication pending |

The original 70 episodes plus 430 new entries are integrated locally. Author review and successful integration do not imply owner approval of every passage or successful production deployment. Review evidence lives in [Ocean](SAMPLE-CORPUS-OCEAN-REVIEW.md), [Land](SAMPLE-CORPUS-LAND-REVIEW.md), and [Air](SAMPLE-CORPUS-AIR-REVIEW.md).

Image acquisition encountered Wikimedia HTTP 429 responses and stopped rather than retrying aggressively. The owner approved an intentional mixed photo and text-only feed. Entries without an honest scene match use explicit null image bindings, not random animal portraits. A broken declared photo still fails validation. Reviewed portraits may serve as avatars without pretending to illustrate every episode.

### Welcome and newsletter review checkpoint

The latest welcome and newsletter refinements are implemented locally in `DemoWelcomeBanner.tsx` and the shared `NewsletterSignup.tsx`. The owner approved the banner and authorized a full production release after the queued Friends Galaxy changes. These notes describe inspected code, not production publication.

- First Look retains the selected "Take back your feed." copy, themed Freed logo, and single "Explore Freed Demo" action. Its opaque elevated card has a 4px strong theme border. The 460ms departure overlaps the guide's 900ms arrival, with First Look above the guide during the overlap.
- The Field Guide uses an opaque elevated background and matching 4px border. Below 641px its centered description is "Social media that respects you." and its download action reads "Download Freed". At 641px and wider, the centered description has two lines: "Social media that respects you, and your friends." then "Ready to make it your own?"; the action reads "Download Freed Desktop".
- Action buttons use compact text and padding. At 576px and narrower the guide fills the available width with side gutters, drags vertically only, and has no minimize, expand, or hide-tab state. Wider layouts allow two-axis dragging. Interactive form controls do not start a drag.
- Opening signup changes the header to "Freed Newsletter" and removes both the guide description and the compact form's introductory copy. The privacy footer is centered. The download action stays available beside "Skip the newsletter", whose X icon returns to the guide without dismissing it.
- Email input suggests a name automatically until the reader edits that name. Validation remains inline; successful human verification continues the pending signup automatically. Existing preview-only behavior still avoids creating a real subscription.

Responsive, transition, and form-interaction checks remain part of final delivery validation. Banner owner review is complete. The exact current behavior supersedes the earlier mobile minimized-tab requirement.

### Production route

The owner directs publication through the repository's production branches and Vercel's Git-triggered builds, not a manual local CLI deployment. Local Vercel account access is not an established blocker for that route. GitHub records successful production PWA deployment 6256754791 by `vercel[bot]` for main commit `0a8c27f1b769bf73a7a8244e1c31ac31f670b061`. Follow the governed product-to-main promotion path, then verify the resulting deployment and official demo domain. The marketing lane remains separate.

## Acceptance

The local integration contains exactly 500 episodes. Catalog images, rejected drafts, duplicated variants, and generated fallback captions do not count toward that total. Every declared image must pass its scene-fit gate; an intentional text-only choice satisfies presentation policy without claiming a photo was reviewed. The historical Manny audit must not be read as proof that its old pairings were accepted.

Preserve the approved Frogbert gravel passage and Alma's premature mourning story exactly. New stories should earn their own emotional stakes, not repeat these plots. The full editorial guide controls every entry.

## Cast plan

The following 43 new characters each contribute ten locally integrated entries. Each has natural-history grounding, a plausible fictional home, and an individual sequence of events. Photographs require their own scene review; text-only entries remain an explicit valid choice. Ten entries must never become a repeating plot structure. Aster Reed and Velvet Night replace the preliminary Otis Pebble and Finn Mossback concepts, which were not authored or admitted.

| Character | Animal | Desire and developing trouble |
| --- | --- | --- |
| Nell Pelagic | Dumbo octopus | Wants an undisturbed patch of bottom; discovers that choosing solitude and being left alone feel different. |
| Percy Silt | Sea pig | Devoted to finding the good sediment; follows a companion's tracks until the tracks stop being useful. |
| Vera Veil | Swimming sea cucumber | Keeps leaving places too early; learns which discomforts travel with her. |
| Pip Pocket | Bobtail squid | Convinced his concealment is excellent; his small routines keep exposing him. |
| Iris Undertow | Cuttlefish | Can change her appearance faster than her mind; a familiar neighbor recognizes the wrong version. |
| Tavi Tilt | Mantis shrimp | Investigates everything with force; eventually encounters something he wants to keep intact. |
| Dot Thimble | Pygmy seahorse | Knows one tiny home extraordinarily well; a small displacement is an expedition. |
| Rue Ribbon | Ribbon eel | Ventures out farther than intended; retreats become elaborate commitments. |
| Basil Backward | Slipper lobster | Wants a quiet crevice and keeps choosing occupied ones. |
| Clove Clatter | Hermit crab | A practiced negotiator about housing, much less practiced about sharing. |
| Pearl Underfoot | Peacock spider | Learns that not every moving shape is an audience or a threat. |
| Ludo Leap | Jumping spider | Measures a jump beautifully, forgets the landing surface. |
| Ada Dew | Tree frog | Guards a comfortable leaf as the weather changes its definition of comfortable. |
| Moss Button | Glass frog | A small guardian with a body that conceals almost nothing. |
| Nib Willow | Red panda | Wants the best fork in a tree; grows attached to the inconvenient route there. |
| Juniper Ears | Fennec fox | Hears far too much, interprets too quickly, and occasionally gets it right. |
| Sumi Smallhours | Slow loris | Prefers a deliberate evening; other lives refuse to move at that speed. |
| Pella Wideawake | Tarsier | Waits with enormous intensity for events that are usually much smaller. |
| Mallow Fold | Pangolin | Protection is easy to begin and awkward to stop. |
| Aster Reed | Common darter dragonfly | Defends a reed until the wider pond and a broken perch revise the value of ownership. |
| Bramble Shortlegs | Wombat | Argues with a root through failed home improvements, then discovers it makes a good backrest. |
| Orla Reach | Echidna | Pursues food into places the rest of her body cannot negotiate. |
| Finch Fidget | Quokka | Curious enough to cause trouble; not as universally cheerful as people suppose. |
| Sorrel Spring | Jerboa | Excellent at sudden departures, less skilled at choosing destinations. |
| Kit Snowshoe | Pika | Collects winter food with fierce preferences; has to live with earlier choices. |
| Nessa Whisker | Arctic fox | Revisits a route after the snow changes; memory becomes useful and misleading. |
| Tully Tumble | Rock hyrax | Has a favorite lookout and an inconveniently recognizable alarm call. |
| Wren Boulder | Klipspringer | Trusts tiny footholds more than generous ones; has trouble explaining this to a companion. |
| Fern Longnose | Coati | Follows smells beyond the group's patience and returns with mixed evidence. |
| Mira Mask | Raccoon | Investigates a stream with her hands and develops a grudge against moving water. |
| Ellis Hook | Leaf-tailed gecko | Needs to be overlooked, then discovers the loneliness of succeeding. |
| Cora Curl | Chameleon | Takes a long time to commit to a branch; the branch has no such reservations. |
| Willa Drift | Leafy sea dragon | Resembles the scenery closely enough to be inconvenienced by the scenery. |
| Brio Beak | Puffin | Carries more than he can comfortably explain or land with. |
| Alba Longwing | Albatross | A capable traveler repeatedly humbled by the last few feet of a landing. |
| Ines Inkcap | Inca tern | Sharp-eyed, short-tempered, and oddly loyal to an irritating fishing companion. |
| Lark Spoon | Spoonbill | Finds food by touch and forms confident theories about things she has not seen. |
| Sable Crest | Secretary bird | Walks toward problems, sometimes farther than she meant to. |
| Faye Thread | Weaver bird | Repairs one flaw and discovers the repair matters to somebody else. |
| Rollo Round | Pufferfish | Good at becoming a problem to swallow; would like other talents acknowledged. |
| Nellie Nudge | Manatee | Has a route, an appetite, and a surprising capacity for small stubborn decisions. |
| Rhea Return | Hawksbill turtle | Knows a feeding circuit whose landmarks keep changing. |
| Velvet Night | Atlas moth | Carries a hungry caterpillar's work into a brief adult life with enormous wings and no working appetite. |

## Formats and sequence

The integrated mix is 145 RSS story entries and 355 social posts. Format follows the incident. Stories need room for changed understanding, remembered relationships, and consequences; length alone does not qualify a post as a story. Reflective writing and comedy should both span ocean, land, and air characters.

Keep the existing per-visit shuffle and chronological order within each arc. Verify that a new viewer gets variety without seeing an aftermath before its cause. Do not force every character into ten identically spaced beats.

## Ocean placement

Nell, Percy, and Vera need offshore deep-water homes, not land coordinates borrowed from photographers or aquariums. Record approximate fictional home locations separately from image provenance. Confirm species range and depth with primary natural-history sources. A reef frogfish remains a benthic reef animal, not a generic abyssal anglerfish.

## Review ledger

For each entry, record text review, image scene fit, biological premise, geographic fit, and arc continuity. Drafting completion and publication readiness are separate counts. Keep rejected drafts outside the runtime corpus. Never substitute a library count for an editorial review result.
