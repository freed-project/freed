import generatedCorpus from "./sample-corpus.generated.json" with { type: "json" };

// Editorial contract: docs/SAMPLE-CORPUS-EDITORIAL-GUIDE.md

export type SampleCorpusCategory = "astronomy" | "geology" | "insect" | "microfauna" | "undersea";
export type SampleCorpusPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "medium"
  | "rss"
  | "saved"
  | "substack"
  | "x"
  | "youtube";

export interface SampleCorpusPlace {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
}

export interface SampleCorpusMediaAsset {
  id: string;
  subject: string;
  category: SampleCorpusCategory;
  identityNameBase: string;
  detail: string;
  imageUrl: string;
  sourceUrl: string;
  creator: string;
  license: string;
  width: number;
  height: number;
  sha1: string;
  coordinates?: { lat: number; lng: number };
  baseUrl: string;
  alt: string;
  fieldNote: string;
  placeId?: string;
}

type GeneratedAsset = Omit<SampleCorpusMediaAsset, "alt" | "baseUrl" | "fieldNote" | "placeId">;

const SUBJECT_PREMISES: Readonly<Record<string, string>> = {
  "praying mantis": "The bee calls it an ambush, but I prefer a conversation with an unexpectedly firm conclusion",
  "orchid mantis": "One flower objected when I copied its outfit, so I ate the complaint department",
  "jewel beetle": "I arrived wearing structural color and watched every gemstone reconsider its career",
  "beetle macro": "My armor has survived birds, weather, and one photographer who thought personal space was optional",
  "butterfly macro": "I completed a total bodily reconstruction and still get introduced as delicate",
  "moth macro": "The moon left the porch light on for me, and I will not be taking questions about navigation",
  dragonfly: "Four wings let me reverse in midair, mostly so I can return and judge the same pond twice",
  damselfly: "I fold my wings politely because the dragonflies have already made hovering unbearably theatrical",
  "bee macro": "I pollinated thirty flowers before breakfast and somehow the honey still gets top billing",
  "ant macro": "I carried fifty times my weight uphill while the mammals held a meeting about productivity",
  "grasshopper macro": "I yelled into the field with my hind legs, then the light hit my femurs and suddenly everyone called it art",
  katydid: "The leaf claims I copied its veins, but my legal team says resemblance is not admission",
  "firefly insect": "I make cold light inside my abdomen because sunsets have become complacent",
  "stick insect": "I have spent all morning impersonating a twig and the tree has yet to acknowledge my range",
  "leaf insect": "Apparently I am blocking the path, which is rich coming from a species that paved half the valley",
  "lacewing insect": "My wings look like cathedral windows because aphid control deserves architecture",
  "weevil macro": "The snout is specialized equipment, not a punchline, although I admit it enters rooms first",
  "ladybird beetle macro": "Seven spots, two elytra, and zero tolerance for your aphid methodology",
  "caterpillar macro": "I am currently a stomach with legs, but the rebrand has already entered production",
  "nematode microscopy": "One drop of water contains my whole jurisdiction, and your zoning appeal has been denied",
  "tardigrade microscopy": "I survived vacuum, radiation, freezing, and the committee that drafted our mission statement",
  "rotifer microscopy": "My crown of cilia looks festive because filtration should never feel like paperwork",
  "radiolarian microscopy": "I built a glass skeleton at microscopic scale and still made symmetry look expensive",
  "diatom microscopy": "I live in a silica jewel box and quietly manufacture enough oxygen to improve everybody's afternoon",
  "foraminifera microscopy": "I added another chamber to my shell because deep time rewards sensible extensions",
  "nudibranch underwater": "I ate a stinging animal, stole its weapons, and matched the outfit to my new personality",
  "jellyfish underwater": "I have no brain, bones, or heart, yet the current keeps inviting me to important functions",
  "octopus underwater": "Eight arms make multitasking possible and privacy an entirely theoretical concept",
  "cuttlefish underwater": "I changed color, texture, and apparent mood before the predator finished its opening remark",
  "squid underwater": "My jet propulsion is excellent, although the ink department remains too eager to publish",
  "seahorse underwater": "I delegated pregnancy to the father and the reef has been discussing our innovation ever since",
  "coral reef underwater": "I built a city from tiny mouths and limestone, then filled every vacancy with color",
  "manta ray underwater": "I flew through water without flapping, which has made the birds defensive",
  "whale shark underwater": "I became the largest fish and kept a diet so polite that plankton still underestimate the situation",
  "sea turtle underwater": "I crossed an ocean using magnetism and returned to the beach without once asking for directions",
  "sea anemone underwater": "I look like a flower because lunch approaches more confidently when the furniture seems harmless",
  "starfish underwater": "I misplaced an arm and grew another, so the incident has been reclassified as routine maintenance",
  "nautilus underwater": "I have been adding chambers to the same elegant spiral since before mammals found their confidence",
  "comb jelly underwater": "I diffract rainbows through rows of cilia because bioluminescence alone felt insufficiently formal",
  "sea slug underwater": "I carry stolen chloroplasts, borrowed toxins, and absolutely no interest in modest coloration",
  "moray eel underwater": "I open and close my mouth to breathe, but the reef prefers to call it a threat display",
  "leafy seadragon underwater": "I dressed as drifting seaweed and became the most overdressed object in the kelp forest",
  "frogfish underwater": "I walk on fins and carry a fishing rod on my forehead, which makes subtlety a complicated allegation",
  "deep sea fish": "I brought my own lantern into the abyss because daylight has a terrible attendance record",
  "feather star underwater": "I spread eighty feathery arms into the current and let dinner make the first move",
  "basalt columns geology": "I cooled into hexagons without a ruler and geometry has been insufferable about it ever since",
  "volcanic lava geology": "I arrived as liquid stone, ignored every boundary, and left the landscape with permanent feedback",
  "volcano crater geology": "I removed my own summit in one decisive meeting and now host a lake where the agenda used to be",
  "geyser geology": "I keep boiling water under pressure until punctuality becomes spectacular",
  "crystal cave geology": "I grew chandeliers in total darkness because an audience would only have interfered",
  "ice cave geology": "I carved blue rooms beneath a glacier and scheduled the entire exhibition to melt",
  "karst geology": "I dissolved the ground from underneath and let the landscape discover negative space",
  "hoodoo geology": "I balanced a boulder on a narrow column for ten thousand years and still hear concerns about stability",
  "slot canyon geology": "One river found my smallest weakness and spent ages turning it into magnificent interior design",
  "mineral crystal geology": "I arranged atoms into ceremony while the surrounding rock remained aggressively informal",
  "geode geology": "I kept the crystals on the inside because revelation benefits from competent pacing",
  "glacier crevasse geology": "I opened one blue fracture in the ice and immediately acquired a reputation for drama",
  "salt flat geology": "I evaporated an ancient lake and left a mirror large enough to embarrass the sky",
  "sandstone erosion geology": "The wind asked for one soft edge, and I have been negotiating the revision ever since",
  "tectonic fault geology": "I store continental disagreement underground until everyone has forgotten the original issue",
  "fumarole geology": "I exhale sulfur through volcanic ground because subtle warnings were not being respected",
  "travertine terrace geology": "I deposited mineral lace one hot spring at a time and called the staircase complete several centuries later",
  "petrified wood geology": "I replaced every cell with stone and retained more personality than the surrounding sediment",
  "sea stack geology": "The headland left me standing alone, which the ocean describes as an ongoing negotiation",
  "limestone cave geology": "I let weakly acidic water decorate the ceiling, then waited a hundred thousand years for the reveal",
  "glacier icefall geology": "I move downhill by breaking magnificently, a management style that has not translated well to mammals",
  "volcanic caldera geology": "Forty million years on hair and makeup, and the cloud arrives late expecting equal billing",
  "sand dunes geology": "I migrate grain by grain and still manage to erase every footprint before the next review",
  "river canyon geology": "I let a river repeat itself until the continent finally understood the point",
  "fjord geology": "I invited the sea into a valley carved by ice and the mountains have never stopped posing",
  "hot spring geology": "I heat groundwater with buried magma and color the margins with microbes who refuse neutral palettes",
  "obsidian geology": "I cooled too quickly for crystals and became volcanic glass with an understandably sharp disposition",
  "amethyst crystal geology": "I trapped iron inside quartz, added radiation, and somehow emerged dressed for royalty",
  "badlands geology": "I removed the vegetation and let every sedimentary grievance become visible",
  "mesa geology": "I kept one hard cap of stone while the rest of the plateau resigned around me",
  "waterfall gorge geology": "I dropped a river over resistant rock and let the mist handle public relations",
  "lava tube cave geology": "I drained the fire from my tunnel and left a cathedral where molten rock once commuted",
  "nebula NASA": "I made these colors from gas, dust, and a complete refusal to remain background scenery",
  "galaxy NASA": "I keep several billion stars nearby because minimalism has limits",
  "supernova remnant NASA": "I exploded once and have spent millennia making the aftermath look composed",
  "planet NASA": "I cleared my orbit, rounded myself with gravity, and still get compared with my siblings at every gathering",
  "moon NASA": "I locked one face toward my planet and let everyone invent motives for the other side",
  "aurora night sky": "I let charged particles strike the upper atmosphere and persuaded the night to wear curtains",
  "solar eclipse": "I placed one small moon over one enormous star and watched perspective become a public event",
  "comet NASA": "I warmed near the Sun, grew a tail millions of kilometers long, and refused to call ahead",
  "star cluster NASA": "I formed thousands of siblings from one cloud and kept the family portrait gravitationally bound",
  "galaxy cluster astronomy": "I gathered whole galaxies with invisible mass and still left room between every introduction",
  "globular cluster astronomy": "I packed ancient stars into a sphere so dense that solitude became an outer-halo privilege",
  "cosmic dust nebula": "I blocked the starlight until gravity turned my darkest material into new suns",
  "stellar nursery nebula": "I collapse cold clouds into stars and endure everyone calling the process adorable",
  "Jupiter storm astronomy": "I have been rotating an anticyclone for centuries and still receive unsolicited weather advice",
  "Saturn rings astronomy": "I arranged ice into rings thin enough to vanish edge-on and broad enough to monopolize every portrait",
  "star trails night sky": "I let the planet rotate beneath fixed stars and accepted credit for the choreography",
  "zodiacal light night sky": "I scattered sunlight through interplanetary dust and made the dawn look privately illuminated",
  "solar prominence NASA": "I lifted plasma above the Sun on magnetic arches and declined the suggestion to keep a lower profile",
  "Jupiter NASA": "I became twice as massive as every other planet combined and still kept the fastest day",
  "Saturn NASA": "I acquired rings visible from another world and have heard enough about being photogenic",
  "Mars landscape NASA": "I oxidized an entire planet red and left river valleys as evidence for a wetter alibi",
  "Earth from space NASA": "I removed the borders from view and watched every argument become appropriately small",
  "Hubble nebula": "I posed in ionized gas for a telescope above the atmosphere and made scale everybody's problem",
  "Hubble galaxy": "I sent ancient starlight into an orbiting mirror and arrived with every spiral arm accounted for",
  "James Webb nebula": "I let infrared vision through the dust and discovered that secrecy had been wildly overstated",
  "James Webb galaxy": "I crossed most of cosmic history and still reached the detector looking younger than expected",
  "emission nebula astronomy": "I let hot stars ionize my gas until the whole cloud began signing in color",
  "planetary nebula astronomy": "I shed my outer layers near the end of a star's life and turned departure into architecture",
  "spiral galaxy astronomy": "I rotate billions of stars through spiral arms that are patterns, not permanent seating",
  "barred spiral galaxy astronomy": "I built a stellar bar through my center because ordinary spirals lacked executive structure",
  "lunar crater NASA": "I kept the impact scar because airless worlds have no weather department to soften criticism",
  "lunar eclipse": "I passed through my planet's shadow and borrowed every sunset at once",
  "Milky Way night sky": "I wrapped the night in our galaxy's disk and let one small planet mistake it for a cloud",
  "meteor shower night sky": "I drove Earth through a comet's debris and let the atmosphere edit every grain into light",
  "sunspot NASA": "I cooled one magnetic patch by thousands of degrees and still outshone nearly everything you know",
  "planetary rings NASA": "I spread shattered ice and rock around a planet until orbital debris achieved formalwear",
  "Venus NASA": "I rotate backward beneath sulfuric clouds and keep the hottest surface in the neighborhood",
  "Mercury NASA": "I orbit closest to the Sun, freeze at night, and consider moderation an outer-planet affectation",
  "Uranus NASA": "I rotate on my side with faint rings and refuse to treat ninety-eight degrees as a phase",
  "Neptune NASA": "I keep the fastest winds in the system at a distance that discourages complaints",
};

const FALLBACK_PREMISES: Readonly<Record<SampleCorpusCategory, string>> = {
  insect: "I arrived with six legs, excellent camouflage, and no obligation to explain the arrangement",
  microfauna: "I built a complete life below the threshold of unaided vision and still made room for opinions",
  undersea: "I grew this shape under pressure and let the current decide whether anyone was ready",
  geology: "I spent deep time becoming this view and will not be rushed through the introduction",
  astronomy: "I sent ancient light across the dark and arrived before the observer finished feeling important",
};

const CATEGORY_RIVALS: Readonly<Record<SampleCorpusCategory, readonly string[]>> = {
  insect: [
    "a leaf with territorial ambitions", "the aphid delegation", "a bee demanding equal billing",
    "one deeply confident gardener", "a spider acting as fact-checker", "the flower's publicity team",
    "a bird with no credentials", "the meadow's chaotic leadership", "an underqualified caterpillar",
    "a fern with inherited influence", "the moth from the neighboring stem", "a dragonfly demanding a solo",
  ],
  microfauna: [
    "a bacterium with strong opinions", "the drop's surface tension", "a rotifer acting as fact-checker",
    "one deeply confident amoeba", "the tardigrade delegation", "a diatom demanding equal billing",
    "the microscope light's publicity team", "an underqualified ciliate", "the pond film's chaotic leadership",
    "a nematode from the neighboring droplet", "the algae's revision notes", "one protozoan demanding a solo",
  ],
  undersea: [
    "the tide's revision notes", "a gull with no credentials", "three plankton with strong opinions",
    "the committee from the neighboring reef", "a moray acting as fact-checker", "the current's chaotic leadership",
    "an underqualified sea urchin", "a crab demanding equal billing", "the kelp's publicity team",
    "one deeply confident octopus", "a shark from the next trench", "the horizon's fragile ego",
  ],
  geology: [
    "a river that never stops repeating itself", "the cloud that arrived late", "the wind's unsolicited advice",
    "an underqualified pebble", "erosion's legal department", "one deeply confident tectonic plate",
    "the glacier's revision notes", "the sea demanding equal billing", "a boulder acting as fact-checker",
    "the weather's chaotic leadership", "a volcano from the neighboring range", "the horizon's fragile ego",
  ],
  astronomy: [
    "gravity's legal department", "the moon's publicity team", "one star demanding a solo",
    "a comet with no forwarding address", "an underqualified asteroid", "the Sun's lighting demands",
    "a dust cloud acting as fact-checker", "the neighboring galaxy's revision notes", "one deeply confident planet",
    "a black hole declining comment", "the horizon's fragile ego", "a telescope demanding equal billing",
  ],
};

const OCCASIONS = [
  "before breakfast", "during the migration", "at the edge of the storm", "under the full moon",
  "while the valley was still quiet", "just as the current changed", "during an otherwise routine metamorphosis",
  "after several million patient years", "between one tide and the next", "as the light crossed the ridge",
  "while the reef pretended not to stare", "before the atmosphere became argumentative",
  "during the brief reign of perfect light", "after the ice released its oldest complaint",
  "while the meadow conducted its morning gossip", "as the shadow reached the crater",
  "before the stars surrendered to dawn", "during a completely avoidable display of majesty",
] as const;

const VERDICTS = [
  "I stand by the result", "I regret only the weak attendance", "I have declined all corrections",
  "I consider the matter beautifully settled", "I would absolutely do it again",
  "I accept applause in stunned silence", "I blame deep time and excellent lighting",
  "I have entered the outcome into the permanent record",
] as const;

const IDENTITY_EPITHETS = [
  "Fern Chapel", "Moonlit Reef", "Basalt Choir", "Velvet Current", "Amber Meadow",
  "Quiet Crater", "Coral Garden", "Salt Horizon", "Moss Council", "Twilight Pool",
  "Silver Dune", "Starlit Ridge", "Hidden Kelp", "Crystal Hollow", "Orchid Thicket",
  "Deep Blue", "Glacier Gate", "Warm Tide", "Canyon Echo", "Wildflower Court",
  "Tidal Lantern", "Ancient Stone", "Meteor Meadow", "Rainforest Balcony", "Lunar Valley",
  "Emerald Grotto", "Comet Tail", "Golden Savanna", "Night Bloom", "Whale Road",
  "Mantis Grove", "Jelly Sea", "Geode Hall", "Nebula Field", "Dragonfly Bend",
  "Octopus Garden", "Volcano Rim", "Star Cluster", "Beetle Wood", "Aurora Vale",
] as const;

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function displaySubject(asset: Pick<SampleCorpusMediaAsset, "subject">): string {
  return asset.subject
    .replace(/\b(?:macro|microscopy|underwater|NASA|astronomy|geology|night sky)\b/gi, "")
    .replace(/^(firefly|lacewing) insect$/i, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function premiseFor(asset: Pick<SampleCorpusMediaAsset, "subject" | "category">): string {
  return SUBJECT_PREMISES[asset.subject] ?? FALLBACK_PREMISES[asset.category];
}

function narrativeParts(
  category: SampleCorpusCategory,
  index: number,
  variant: number,
): { rival: string; occasion: string; verdict: string } {
  const sequence = index + variant * 1_701;
  const rivals = CATEGORY_RIVALS[category];
  return {
    rival: rivals[sequence % rivals.length]!,
    occasion: OCCASIONS[Math.floor(sequence / rivals.length) % OCCASIONS.length]!,
    verdict: VERDICTS[Math.floor(sequence / (rivals.length * OCCASIONS.length)) % VERDICTS.length]!,
  };
}

function renderNarrative(
  asset: Pick<SampleCorpusMediaAsset, "subject" | "category">,
  platform: SampleCorpusPlatform,
  index: number,
  variant: number,
): string {
  const premise = premiseFor(asset);
  const { rival, occasion, verdict } = narrativeParts(asset.category, index, variant);
  const frame = (index + variant) % 4;

  switch (platform) {
    case "instagram": {
      const frames = [
        `${premise}; naturally, ${rival} expected equal billing ${occasion}, but I kept my good side and let effortless beauty close the argument; ${verdict}.`,
        `${premise}; ${occasion}, I allowed ${rival} into the frame for scale, then watched the light discover who the portrait was actually about; ${verdict}.`,
        `${premise}; no filter survived ${occasion}, so I gave ${rival} one rehearsal and made the horizon find a more flattering angle; ${verdict}.`,
        `${premise}; ${rival} suggested modesty ${occasion}, but I had already committed to magnificent and the colors refused a downgrade; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "facebook": {
      const frames = [
        `${premise}; apparently ${rival} objects ${occasion}, but I will not accept corrections from anyone who missed the obvious point; walk around, Martin; ${verdict}.`,
        `${premise}; ${occasion}, ${rival} called this unnecessary, which is exactly the sort of opinion that keeps the valley from inviting people back; ${verdict}.`,
        `${premise}; I am told ${rival} disagrees ${occasion}, but we tried being reasonable last season and the herons became unbearable; ${verdict}.`,
        `${premise}; ${rival} may appeal the decision ${occasion}, provided the complaint is written on a leaf and delivered upstream; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "linkedin": {
      const frames = [
        `Thrilled to report that ${premise.toLowerCase()}; ${occasion}, I converted ${rival} into visible leadership, cross-functional learning, and an organic growth strategy; ${verdict}.`,
        `${premise}; pleased to share that ${occasion} I leveraged ${rival} into a high-impact resilience narrative with no additional headcount; ${verdict}.`,
        `${premise}; my key learning ${occasion} was to let ${rival} take minutes while I retained strategic ownership of the spectacle; ${verdict}.`,
        `${premise}; after mentoring ${rival} ${occasion}, I delivered measurable wonder at scale and accepted a promotion from remarkable to inevitable; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "x": {
      const frames = [
        `Observed: ${premise}; ${occasion}; I logged ${rival} as the uncontrolled variable; null hypothesis rejected.`,
        `${premise}; n=1 ${occasion}, control=${rival}; I obtained a frankly devastating effect size.`,
        `Field note: ${premise}; ${occasion}, I measured ${rival} twice and found ordinary Tuesday statistically untenable.`,
        `Result: ${premise}; I excluded ${rival} ${occasion} for contaminating the sample with opinions.`,
      ];
      return frames[frame]!;
    }
    case "substack": {
      const frames = [
        `${premise}; ${occasion}, ${rival} called it excessive, so I wrote the full transcript, added one scandalous diagram, and placed the firmest conclusion below the subscription line; ${verdict}.`,
        `${premise}; my deeply reported dispute with ${rival} began ${occasion} and now includes four thousand words, two anonymous plankton, and a correction the moon refuses to print; ${verdict}.`,
        `${premise}; ${occasion}, I followed ${rival} through the evidence, the counterargument, and one footnote so merciless that the tide requested counsel; ${verdict}.`,
        `${premise}; paid readers may examine what ${rival} did ${occasion}, why the canyon declined comment, and the foreleg diagram my solicitor begged me to omit; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "medium": {
      const frames = [
        `${premise}; ${occasion}, I distilled the dispute with ${rival} into five lessons, made patience number three, and immediately regretted how tidy the mystery looked; ${verdict}.`,
        `${premise}; what ${rival} taught me ${occasion} about boundaries, adaptation, and the hidden cost of pretending every revelation needs a numbered list; ${verdict}.`,
        `${premise}; I spent ${occasion} testing one common assumption with ${rival} and emerged with a simple framework that the mountain considers defamatory; ${verdict}.`,
        `${premise}; the beginner's guide I needed before ${rival} arrived ${occasion} has seven principles, one useful diagram, and considerably less certainty than the headline promised; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "youtube": {
      const frames = [
        `${premise}; in today's episode, ${occasion}, I give ${rival} three survival tips, one unnecessary close-up, and no final-cut privileges; ${verdict}.`,
        `${premise}; stay to the end as I follow ${rival} ${occasion}, explain the impossible anatomy, and let creation spend the entire effects budget; ${verdict}.`,
        `${premise}; ${occasion}, I invited ${rival} behind the scenes, answered the question everyone keeps asking, and discovered the reef has no front of house; ${verdict}.`,
        `${premise}; this week I attempt a calm introduction ${occasion} before ${rival} seizes the episode and the wide shot becomes nonnegotiable; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "saved": {
      const frames = [
        `${premise}; I saved the longer account of ${rival} ${occasion} for an afternoon spacious enough to hold both the evidence and the astonishment; ${verdict}.`,
        `${premise}; ${occasion}, I filed ${rival} under things worth revisiting when attention has recovered from the week; ${verdict}.`,
        `${premise}; I kept the patient explanation of ${rival} ${occasion} because significance does not become less urgent when it happens slowly; ${verdict}.`,
        `${premise}; saved after ${occasion}, when ${rival} accidentally proved that curiosity remains a practical virtue; ${verdict}.`,
      ];
      return frames[frame]!;
    }
    case "rss": {
      const frames = [
        `${premise}; this field report follows my dispute with ${rival} ${occasion}, where measurement remained useful right up to the point that wonder became unavoidable; ${verdict}.`,
        `${premise}; ${occasion}, I recorded what ${rival} missed about the patient forces beneath the visible spectacle; ${verdict}.`,
        `${premise}; my notes from ${occasion} begin with ${rival}, continue through the natural history, and end with a considerably larger set of questions; ${verdict}.`,
        `${premise}; I followed ${rival} ${occasion} into the longer story beneath the surface, where rigor and astonishment finally stopped quarreling; ${verdict}.`,
      ];
      return frames[frame]!;
    }
  }
}

export function sampleCorpusDisplayTitle(asset: Pick<SampleCorpusMediaAsset, "subject">, index: number): string {
  const first = IDENTITY_EPITHETS[index % IDENTITY_EPITHETS.length]!;
  const second = IDENTITY_EPITHETS[Math.floor(index / IDENTITY_EPITHETS.length) % IDENTITY_EPITHETS.length]!;
  const setting = first === second ? first : `${first} and ${second}`;
  return `${titleCase(displaySubject(asset))}: ${setting}`;
}

export const SAMPLE_CORPUS_MEDIA: readonly SampleCorpusMediaAsset[] = generatedCorpus.map((raw, index) => {
  const asset = raw as GeneratedAsset;
  return {
    ...asset,
    baseUrl: asset.imageUrl,
    alt: `Photograph of ${displaySubject(asset)} in its natural setting.`,
    fieldNote: renderNarrative(asset, "rss", index, 0),
    ...(asset.coordinates ? { placeId: asset.id } : {}),
  };
});

export const SAMPLE_CORPUS_PLACES: readonly SampleCorpusPlace[] = SAMPLE_CORPUS_MEDIA
  .filter((asset): asset is SampleCorpusMediaAsset & { coordinates: { lat: number; lng: number } } =>
    asset.coordinates !== undefined
  )
  .map((asset) => ({ id: asset.id, name: asset.detail, coordinates: asset.coordinates }));

export const SAMPLE_CORPUS_VERSION = 6;

export function sampleCorpusPlace(placeId: string | undefined): SampleCorpusPlace | undefined {
  return placeId ? SAMPLE_CORPUS_PLACES.find((candidate) => candidate.id === placeId) : undefined;
}

export function sampleCorpusMedia(index: number): SampleCorpusMediaAsset {
  const normalized = ((index % SAMPLE_CORPUS_MEDIA.length) + SAMPLE_CORPUS_MEDIA.length) % SAMPLE_CORPUS_MEDIA.length;
  return SAMPLE_CORPUS_MEDIA[normalized]!;
}

export function sampleCorpusMediaUrl(asset: SampleCorpusMediaAsset, _size?: { width?: number; height?: number }): string {
  return asset.imageUrl;
}

export function sampleCorpusSourceUrl(asset: SampleCorpusMediaAsset): string {
  return asset.sourceUrl;
}

export function sampleCorpusAttribution(asset: SampleCorpusMediaAsset): string {
  return `Photograph by ${asset.creator}, ${asset.license}, via Wikimedia Commons.`;
}

export function sampleCorpusIdentityName(asset: SampleCorpusMediaAsset, index: number): string {
  const first = IDENTITY_EPITHETS[index % IDENTITY_EPITHETS.length]!;
  const second = IDENTITY_EPITHETS[Math.floor(index / IDENTITY_EPITHETS.length) % IDENTITY_EPITHETS.length]!;
  return first === second
    ? `${asset.identityNameBase} of ${first}`
    : `${asset.identityNameBase} of ${first} and ${second}`;
}

export function sampleCorpusIdentityBio(asset: SampleCorpusMediaAsset): string {
  const subject = displaySubject(asset);
  return `Keeps watch over ${subject}, asks impertinent questions, and never interrupts creation doing something astonishing.`;
}

export function sampleCorpusAuthoredText(
  asset: SampleCorpusMediaAsset,
  platform: SampleCorpusPlatform,
  index: number,
  variant = 0,
): string {
  return renderNarrative(asset, platform, index, variant);
}
