# Freed Sample Corpus Editorial Guide

This document is the durable editorial contract for the sample data shown in Freed Desktop, the PWA, feature previews, and `demo.freed.wtf`. Use it whenever the corpus is expanded, regenerated, or reviewed.

The goal is not to simulate generic social media. The goal is to make creation itself appear to have seized several social accounts and developed excellent comic timing.

## Governing idea

Every post is a first-person dispatch from a real insect, microscopic creature, undersea animal, geological formation, planet, star, nebula, or other natural subject.

The voice is universally reverent and non-sectarian. The subject regards creation as glorious, strange, excessive, ancient, and worthy of attention. The humor is sharp, specific, and occasionally merciless. Reverence is the foundation. Snark is the delivery system.

The writing should feel like an inside joke penned by a volcano or praying mantis. It must never sound like a clinical caption, a travel diary, a marketing department, or an appliance trying to pass a biology exam.

## Non-negotiable rules

1. Write from first-person experience.
   The natural subject is the narrator. A post may begin with `Apparently`, `Observed`, `Forty million years`, or another strong phrase, but the narrator's own experience and attitude must remain present.

2. Begin inside the joke.
   Do not introduce the narrator, restate the title, or explain the premise before the funny part begins.

3. Never make every post begin the same way.
   In particular, do not use `I am the...`, `I am a...`, or any other repeated opening as a corpus template. Sentence rhythm, opening words, and comic construction must vary.

4. Anchor every joke in a true natural detail.
   A mantis has raptorial forelegs. A nudibranch can appropriate stinging cells. A diatom builds a silica shell. A caldera records volcanic collapse. A galaxy may contain billions of stars. The fact gives the joke its teeth.

5. Preserve wonder beneath the joke.
   The subject may be vain, territorial, professionally ambitious, scientifically pedantic, or magnificently aggrieved. It must never make nature feel cheap, cynical, cruel for its own sake, or disposable.

6. Match the copy to the image.
   The narrated subject, title, identity, photograph, and any map location must describe the same thing. A dragonfly post needs a dragonfly photograph. A caldera post needs a caldera photograph. Approximate thematic matching is not enough.

7. Treat uniqueness as an editorial requirement, not merely an identifier requirement.
   Do not duplicate images, complete posts, titles, names, punch lines, factual premises, or conspicuous sentence structures. Changing one noun in a repeated template does not create a new post.

8. Keep titles out of body copy.
   Titles are metadata. The narrator does not recite the title of its own post.

9. Keep the world natural.
   Do not reference computers, software, algorithms, databases, the internet, digital technology, dashboards, roadmaps, notifications, or similar machinery. Workplace language is allowed only as satire inside the LinkedIn voice, and it should describe natural behavior rather than actual technology.

10. Keep people out of the pictures.
    Prefer pristine nature, microscopy, undersea life, geology, weather, and space. Avoid close-ups of people, travel portraits, cafes, roads, buildings, vehicles, tourist scenes, and human-centered compositions.

## Platform voices

The factual premise belongs to the subject. The comic form belongs to the platform.

### Instagram

Slightly and comically egotistical. The narrator knows the light is excellent, assumes the landscape is a supporting actor, and treats magnificence as a personal brand that fortunately happens to be justified.

Useful comic ingredients include flattering angles, equal billing, unnecessary modesty, colors refusing restraint, and the horizon serving as set dressing.

Do not reduce the voice to hashtags, influencer slang, or repeated references to filters.

### Facebook

Opinionated, adversarial, and locally aggrieved. The narrator has identified somebody who is wrong and intends to settle the matter in public. The disagreement should feel oddly specific and socially familiar.

Useful comic ingredients include appeals processes, neighborhood disputes, unsolicited corrections, territorial leaves, unqualified birds, and a person named Martin who should simply walk around.

Do not make the voice hateful, partisan, or cruel.

### LinkedIn

Career-oriented workplace satire. The narrator converts survival, camouflage, erosion, migration, or deep time into a suspiciously polished professional triumph. The tone is `look at me, I am so successful`, delivered with Dilbert-like corporate absurdity.

Useful comic ingredients include promotions, strategic ownership, visible leadership, organic growth, stakeholder humility, mentoring, measurable impact, and taking credit before the river circulates minutes.

Do not reference real employers, products, software, or professional identities.

### X

Comically nerdy and scientific. The narrator records observations, rejects a null hypothesis, identifies uncontrolled variables, invokes sample size, and treats an ordinary rival as a threat to methodological rigor.

The science joke must remain understandable without a degree. Keep the post within the platform character limit.

Do not turn every post into the same `Observed` construction. Vary field notes, results, sample reports, and terse arguments.

### Substack

Long-form confidence with a grievance worth footnoting. The narrator has written far too much, interviewed colorful sources, added a diagram counsel opposed, and placed the firmest conclusion below the subscription line.

The tone should suggest an intelligent naturalist with one magnificent obsession, not generic newsletter promotion.

### Medium

Reflective explanatory writing that cannot resist a framework, numbered lessons, or a provocative headline. The narrator tries to compress deep time or impossible anatomy into useful takeaways, then notices that the mystery has become suspiciously tidy.

Do not let the listicle structure overpower the subject-specific joke.

### YouTube

Showmanship, episode framing, visual spectacle, and mild production chaos. The narrator offers a close look, a survival demonstration, an unnecessary close-up, or a wide shot that consumes the effects budget.

Do not add actual calls to subscribe, manufactured outrage, or repetitive creator slang.

### RSS and saved reading

Patient field reporting. These voices can be quieter, but they must remain first person, specific, and funny. Measurement and astonishment should coexist. Saved items should feel worth returning to when attention has recovered from the week.

## Subject identities

Every identity name should be memorable, unique, and connected to the subject. Prefer names such as `Grace Hoppergrass`, `Manny Tis`, `Nudi Branch Manager`, `Tardi Grade`, `Callie Dera`, and `Milky Waylon` over generic human names.

The joke should be legible without becoming a random sequence of puns. The identity must still feel like a character who could have written the post.

The Friends Galaxy should distribute people across care levels 1 through 5. Five-star friends belong near the center, receive the most visual prominence, and have breathing room. Provider identities should form believable Facebook, Instagram, LinkedIn, X, and RSS neighborhoods around the social graph.

## Image and attribution standard

The current corpus hotlinks attributable Wikimedia Commons thumbnails. Image binaries do not belong in the repository.

Every selected image must:

- show the stated subject clearly;
- be visually strong enough for a product demonstration;
- have a stable source page, named creator when available, and an accepted public or Creative Commons license;
- have sufficient resolution for feed cards, stories, avatars, and map markers;
- avoid duplicate files and duplicate underlying hashes;
- avoid people, buildings, vehicles, diagrams, illustrations, specimens, labels, and obvious human staging;
- preserve canonical coordinates when Commons supplies trustworthy latitude and longitude.

The source generator lives at `scripts/generate-sample-corpus.mjs`. The checked-in runtime catalog lives at `packages/shared/src/sample-corpus.generated.json` and intentionally excludes unused source prose and original dimensions to keep the PWA fast.

## Approved tonal examples

These examples define the quality bar. They are references, not templates.

### Instagram, volcanic caldera

> Forty million years on hair and makeup, and the cloud arrives late expecting equal billing. I let it stay. Generosity looks magnificent at this altitude.

### Facebook, leaf insect

> Apparently I am blocking the path. This is rich coming from a species that paved half the valley and now needs a sign to locate a waterfall. Walk around, Martin.

### LinkedIn, leaf insect

> Thrilled to announce my successful pivot from twig nobody noticed to Regional Camouflage Leader. Key learnings: remain motionless, let competitors get eaten, and describe survival as an organic growth strategy.

### X, ladybird

> Observed: seven spots, two elytra, zero tolerance for your aphid methodology. Null hypothesis rejected on the grounds that I ate it.

### Substack, praying mantis

> The bee calls it an ambush. I prefer a conversation with an unexpectedly firm conclusion. Paid subscribers receive the full transcript and one foreleg diagram my solicitor begged me not to publish.

## Common failures

### Clinical exposition

Weak:

> I am a praying mantis. I use my forelegs to catch prey.

Better:

> The bee calls it an ambush. I prefer a conversation with an unexpectedly firm conclusion.

### Repeated narrator introduction

Weak:

> I am the volcano behind Morning Light Across the Dunes.

Better:

> Forty million years on hair and makeup, and the cloud arrives late expecting equal billing.

### Generic inspiration

Weak:

> Nature is beautiful and reminds us to slow down.

Better:

> One river found my smallest weakness and spent ages turning it into magnificent interior design.

### Platform costume without platform character

Weak:

> Amazing mantis photo. #nature #beautiful

Better:

> One flower objected when I copied its outfit, so I ate the complaint department.

## Writing procedure for additional posts

1. Identify the exact pictured subject.
2. Find one true behavior, structure, process, scale, or ecological relationship unique to that subject.
3. Write one first-person comic premise in the subject's own voice.
4. Remove any opening that introduces or labels the narrator.
5. Choose the platform and reshape the joke using that platform's personality.
6. Add a distinct rival, occasion, or consequence only when it remains coherent with the subject's world.
7. Read the post aloud. Remove anything clinical, explanatory, repetitive, or merely cute.
8. Compare it against the entire corpus for repeated images, facts, names, titles, punch lines, and sentence structures.
9. Confirm that the body never repeats its metadata title.
10. Confirm that the post remains reverent even at maximum snark.

## Reusable generation brief

Use the following brief when drafting a new batch:

> Write first-person sample posts narrated by the pictured natural subjects themselves. The world should feel like a nature documentary celebrating the glory and majesty of creation, with universally reverent, non-sectarian language and biting subject-specific humor. Begin inside the joke. Never introduce the narrator or begin every post with the same phrase. Anchor each joke in a true biological, geological, oceanographic, or astronomical detail. Give Instagram a slightly egotistical voice, Facebook an opinionated and adversarial voice, LinkedIn absurd career ambition, X nerdy scientific rigor, Substack footnoted long-form conviction, Medium reflective framework-building, YouTube visual showmanship, and RSS or saved reading patient field-report wit. Every post, image, title, identity name, factual premise, and conspicuous sentence structure must be unique. Do not mention digital technology, software, computers, the internet, or generic travel experiences. Keep reverence underneath the snark.

## Engineering procedure for new subjects

When a new subject is added:

1. Add its search phrase, category, and comic identity base to `TOPICS` in `scripts/generate-sample-corpus.mjs`.
2. Add a strict subject requirement to `TOPIC_REQUIREMENTS` so search results cannot drift to a merely related subject.
3. Add one factual comic premise to `SUBJECT_PREMISES` in `packages/shared/src/sample-corpus.ts`.
4. Add or refine category-specific rivals only when they remain plausible within that natural setting.
5. Regenerate the catalog and inspect the images visually.
6. Run the focused shared and PWA corpus tests.
7. Run `npm run validate:feature` before publication.

## Acceptance checklist

A corpus addition is not complete until all of the following are true:

- every post has first-person presence without a repeated narrator introduction;
- every post begins inside a specific joke;
- every joke contains a defensible natural fact;
- every platform sounds recognizably different;
- every displayed image matches the narrated subject;
- every image URL and source hash is unique;
- every full post, title, and identity name is unique;
- no body repeats its title;
- no banned technology language appears in rendered copy;
- all X posts remain within 280 characters;
- all image licenses and source pages remain attributable;
- map locations use source coordinates and photographic markers;
- Friends Galaxy identities retain provider neighborhoods and care levels 1 through 5;
- the demo checkpoint remains deterministic and refreshes to a pristine read-only showcase;
- the PWA production build remains inside its offline cache policy.

