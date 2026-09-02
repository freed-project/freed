import generatedCorpus from "./sample-corpus.generated.json" with { type: "json" };
import { SAMPLE_CHARACTER_ARCS, type SampleCharacterArc, type SampleCharacterEpisode } from "./sample-character-arcs.js";

// Editorial contract: docs/SAMPLE-CORPUS-EDITORIAL-GUIDE.md

export type SampleCorpusCategory = "astronomy" | "geology" | "insect" | "microfauna" | "undersea" | "wildlife";
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

interface CuratedEpisodeAssignment {
  arc: SampleCharacterArc;
  episode: SampleCharacterEpisode;
  sequence: number;
}

const generatedAssets = generatedCorpus as readonly GeneratedAsset[];
const availableAssetsBySubject = new Map<string, GeneratedAsset[]>();
for (const asset of generatedAssets) {
  const available = availableAssetsBySubject.get(asset.subject) ?? [];
  available.push(asset);
  availableAssetsBySubject.set(asset.subject, available);
}
const usedAssetCountBySubject = new Map<string, number>();
const curatedEpisodeAssignments = new Map<string, CuratedEpisodeAssignment>();
const curatedAssets: GeneratedAsset[] = [];
for (const arc of SAMPLE_CHARACTER_ARCS) {
  for (const [sequence, episode] of arc.episodes.entries()) {
    const available = availableAssetsBySubject.get(episode.subject) ?? [];
    const used = usedAssetCountBySubject.get(episode.subject) ?? 0;
    const asset = available[used];
    if (!asset) throw new Error(`The curated ${arc.identityNameBase} arc needs another ${episode.subject} image.`);
    usedAssetCountBySubject.set(episode.subject, used + 1);
    curatedEpisodeAssignments.set(asset.id, { arc, episode, sequence });
    curatedAssets.push(asset);
  }
}

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
  "ladybird beetle mating": "We climbed the same leaf looking for romance and are both pretending this was a scheduling coincidence",
  "dragonfly mating wheel": "We made one heart-shaped flight plan and immediately lost interest in everyone else's geometry",
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
  "seahorse courtship pair": "We have been dancing together every morning and I still rehearse the tail hold beforehand",
  "nudibranch mating": "We are both simultaneously the boyfriend and the girlfriend, and the reef can update its forms accordingly",
  "penguin courtship": "I brought one excellent pebble and have spent six minutes pretending not to watch for a reaction",
  "swan courtship": "We synchronized our necks, then acted surprised when everyone saw the heart",
  "fox pair": "I crossed the whole field to sit nearby and become intensely interested in one ordinary blade of grass",
  "otter pair": "We held paws so the current could not separate us and agreed to call it navigation",
  "red panda pair": "I climbed this entire tree to sit three branches away and look casually unavailable",
  "prairie dog kiss": "We touched noses to say hello and both immediately forgot the rest of the protocol",
  "albatross courtship": "We rehearsed this dance for years and I still panic when the beak clicking starts",
  "flamingo courtship": "The whole flock joined the dance and nobody has updated the relationship diagram since Tuesday",
  "elephant affection": "I reached for their face with my trunk and discovered dignity is incompatible with having a crush",
  "giraffe pair": "I came all this way to stand nearby and stare at a leaf that has never interested me before",
  "peacock courtship display": "I opened every eye on my train and still could not look directly at the bird I wanted",
  "gentoo penguin courtship": "I selected one excellent pebble and have prepared no remarks for the handoff",
  "lion mating pair": "We have been together every twenty minutes for three days and still have not defined the relationship",
  "macaw pair": "We mate for life, share most meals, and still blush when our beaks touch",
  "lovebird pair": "We have been sitting shoulder to shoulder all morning and would prefer everyone stop making it significant",
  "lemur pair": "I scented the entire branch, then became shy when the intended audience actually arrived",
  "rabbit pair": "Our noses touched for half a second and the meadow has already planned the wedding",
  "meerkat affection": "I groomed one difficult patch behind their ear and now the whole colony has opinions",
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
  wildlife: "I crossed the habitat to stand nearby and suddenly forgot every courtship behavior my species has rehearsed for millennia",
};

const SUBJECT_PREMISE_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  "frogfish underwater": [
    "I walked across the reef on my fins and watched swimming lose its monopoly on fish behavior",
    "The lure above my eyes has caught three lunches and one rumor that I lack subtlety",
    "I dressed as a sponge, remained perfectly still, and let dinner misunderstand the furniture",
    "My mouth expands faster than the reef can finish saying this seems suspicious",
    "I brought a fishing rod on my forehead because chasing lunch sounded needlessly athletic",
    "The coral called me lumpy until the lump swallowed a fish in six milliseconds",
    "I have fins for walking, camouflage for loitering, and a lure for handling introductions",
    "Nobody noticed me beside the sponge, which was gratifying right up to the applause",
    "I changed color for the reef and kept the expression of someone waiting for room service",
    "My prey saw a harmless scrap of bait; I saw punctuality finally receiving its reward",
    "The current tried to reveal me, but I had already committed to looking like questionable coral",
    "I can swallow prey nearly my own size and still get described as the funny little one",
    "Walking on fins was merely eccentric until I added the forehead tackle",
    "The reef supplied camouflage, I supplied patience, and lunch supplied the tragic misunderstanding",
    "I waved my lure once and the neighborhood converted curiosity into a cautionary tale",
    "My skin copied the reef so convincingly that even the algae began asking for identification",
    "I declined to swim, took six deliberate steps, and arrived before the hurried fish noticed dinner had changed sides",
    "The sponge beside me has spent all morning denying we coordinated outfits",
    "I opened my mouth, expanded the entire front of my head, and made scale a temporary opinion",
    "The smaller fish called my lure adorable, which concluded the research portion of our meeting",
    "I have perfected the posture of a damp pebble with confidential intentions",
    "The reef mistook patience for inactivity and has requested that the record be corrected",
    "I grew filaments, blotches, and one extremely persuasive imitation of not being hungry",
    "My pectoral fins became feet because the seabed deserved a more unsettling pedestrian",
    "I waited beside the coral until coincidence became ambush and ambush became lunch",
    "The bait on my forehead performs one dance; I handle the reviews personally",
    "I can cross the reef without swimming and dine without pursuing, which feels like competent planning",
    "The clownfish laughed at my stride until my mouth became the largest fact in the room",
    "I spent the afternoon impersonating geology and the evening disproving a shrimp's assumptions",
    "Camouflage hid my body, patience hid my appetite, and the lure made both arrangements somebody else's problem",
  ],
};

const TITLE_TENSIONS: Readonly<Record<SampleCorpusCategory, readonly string[]>> = {
  insect: [
    "six-legged diplomacy", "the flower's formal complaint", "camouflage with witnesses",
    "an unreasonable amount of wing", "pollination politics", "the meadow's succession crisis",
    "one immaculate ambush", "structural color and poor restraint", "the leaf's identity problem",
    "metamorphosis without permission", "antennae in the minutes", "the aphid situation",
  ],
  microfauna: [
    "life below the visible threshold", "the droplet's jurisdiction", "silica in formalwear",
    "eight legs and no apology", "the pond film inquiry", "cilia with an agenda",
    "microscopic grandeur", "the surface tension dispute", "one cellular misunderstanding",
    "the algae testimony", "a very small constitutional crisis", "the rotifer's objection",
  ],
  undersea: [
    "reef etiquette", "camouflage beneath cross-examination", "the current's revision notes",
    "an ambush with excellent posture", "bioluminescence after dark", "the tide's missing paperwork",
    "tentacles in the minutes", "pressure and other social obligations", "the kelp forest incident",
    "one spectacular misunderstanding", "lunch approaching the furniture", "the abyssal dress code",
  ],
  geology: [
    "deep time taking this personally", "erosion's appeal", "the continent's unresolved grievance",
    "magma without supervision", "a river repeating itself", "the glacier's final revision",
    "geometry under pressure", "the mountain's missing summit", "sedimentary allegations",
    "the wind's unauthorized redesign", "one patient catastrophe", "the ocean's boundary dispute",
  ],
  astronomy: [
    "gravity's conflict of interest", "several billion supporting stars", "the dust cloud's alibi",
    "light arriving extremely late", "an orbit with opinions", "the moon's publicity problem",
    "plasma declining restraint", "the galaxy next door", "one statistically excessive horizon",
    "the comet's forwarding address", "dark matter in the minutes", "the universe refusing a close-up",
  ],
  wildlife: [
    "courtship with witnesses", "one excellent pebble", "the colony chorus",
    "a crush in plain sight", "the flock's relationship diagram", "mutual pining",
    "the dance nobody rehearsed", "affection under observation", "one shy catastrophe",
    "romance with a migration schedule", "several interested parties", "the leaf between us",
  ],
};

type TitleForm = (character: string, subject: string, scene: string, tension: string) => string;

const TITLE_FORMS: Readonly<Record<SampleCorpusPlatform, readonly TitleForm[]>> = {
  instagram: [
    (_character, subject) => `${subject} thirst trap`,
    () => "Woke up like this",
    (_character, _subject, _scene, tension) => titleCase(tension),
    () => "Violence, and better lighting.",
    () => "Found the good side",
    (_character, subject) => `Soft launch: one ${subject.toLowerCase()}`,
    () => "Unnecessary majesty",
    () => "The light understood",
    () => "Respectfully, the moment",
    () => "No notes",
    () => "A casual act of creation",
    (_character, subject) => `This ${subject.toLowerCase()} angle is illegal`,
  ],
  facebook: [
    (_character, subject) => `Apparently ${subject.toLowerCase()} is controversial now`,
    (_character, _subject, _scene, tension) => `I said what I said about ${tension}`,
    (_character, subject) => `Unpopular opinion: the ${subject.toLowerCase()} was right`,
    () => "Please calm down incorrectly",
    () => "Receipts, no patience",
    () => "Not to start anything",
    () => "The picnic ban stands",
    () => "Corrections rejected",
    (_character, subject) => `The ${subject.toLowerCase()} discourse escalates`,
    () => "I choose this hill",
    () => "Leaving the neighborhood meeting",
    () => "Walk around, Martin",
  ],
  linkedin: [
    () => "Scaling wonder",
    () => "Gravity promoted me",
    () => "Visible leadership",
    () => "Owning the outcome",
    () => "Going galactic",
    () => "Playing the long game",
    () => "Majesty delivered",
    () => "A larger role",
    () => "Organic growth",
    () => "Thinking bigger",
    () => "Taking the lead",
    () => "Expectations exceeded",
  ],
  x: [
    (_character, subject) => `New ${subject.toLowerCase()} data`,
    () => "Huge if gravitational",
    () => "Peer review, cowards",
    (_character, _subject, _scene, tension) => titleCase(tension),
    () => "Inside the control group",
    () => "Citation needed",
    () => "Ratioed by reality",
    () => "Gravity says skill issue",
    () => "Posting through the methodology",
    () => "Null hypothesis cooked",
    () => "Main sequence energy",
    () => "Source: the entire ocean",
  ],
  substack: [
    () => "The receipts",
    (_character, subject) => `The ${subject.toLowerCase()} files`,
    () => "On the record",
    () => "Hostile footnotes",
    (_character, _subject, _scene, tension) => `Investigating ${tension}`,
    () => "Names below the paywall",
    () => "Counsel opposed this diagram",
    () => "The short version was declined",
  ],
  medium: [
    (_character, subject) => `What one ${subject.toLowerCase()} taught me`,
    (_character, _subject, _scene, tension) => `A guide to ${tension}`,
    () => "Seven lessons, one mystery",
    () => "The framework nobody requested",
    () => "Trying to simplify deep time",
    () => "Rethinking the obvious",
    () => "Making wonder actionable",
    () => "I regret the numbered list",
  ],
  youtube: [
    (_character, subject) => `This ${subject.toLowerCase()} should not be possible`,
    () => "Wait for the ambush",
    () => "Creation used the whole budget",
    () => "One calm introduction",
    () => "The wide shot wins",
    () => "Behind the reef",
    () => "Watch the lure",
    () => "The episode escapes",
  ],
  rss: [
    (_character, _subject, _scene, tension) => `Notes on ${tension}`,
    () => "From the field",
    (_character, subject) => `The ${subject.toLowerCase()} dispatch`,
    () => "Wonder, carefully measured",
    () => "The longer story",
    () => "What the surface missed",
    () => "An unreasonable morning",
    () => "Evidence of majesty",
  ],
  saved: [
    () => "Save this",
    () => "Worth another look",
    () => "Before the tide changes",
    () => "Keep the longer version",
    () => "When attention recovers",
    () => "Filed under astonishing",
    () => "Worth keeping",
    () => "Curiosity wins again",
  ],
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
  wildlife: [
    "a sibling who refuses to leave", "the herd's unofficial relationship committee", "one suspiciously perfect pebble",
    "a branch with excellent sightlines", "the flock's outdated relationship diagram", "an auntie monitoring from the grass",
    "a rival with much better feathers", "the wind's terrible romantic timing", "a photographer failing to be discreet",
    "the colony chorus", "one aggressively ordinary leaf", "the migration schedule",
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

const EDITORIAL_LOCATIONS = [
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
  const minorWords = new Set(["a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with"]);
  return value.split(/\s+/).map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && minorWords.has(lower)) return lower;
    return lower.replace(/^\w/, (character) => character.toUpperCase());
  }).join(" ");
}

function editorialLocation(index: number): string {
  return EDITORIAL_LOCATIONS[index % EDITORIAL_LOCATIONS.length]!;
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

function embedPremise(premise: string): string {
  if (/^I(?:\b|'m|'ve|'d|'ll)/.test(premise)) return premise;
  return premise.replace(/^./, (character) => character.toLowerCase());
}

function ensureFirstPerson(narrative: string): string {
  if (/\b(?:I|my|me)\b/i.test(narrative)) return narrative;
  return `I saw it myself. ${narrative}`;
}

function subjectOrdinal(asset: Pick<SampleCorpusMediaAsset, "id" | "subject">): number {
  let ordinal = 0;
  for (const candidate of generatedCorpus as readonly GeneratedAsset[]) {
    if (candidate.subject !== asset.subject) continue;
    if (candidate.id === asset.id) return ordinal;
    ordinal += 1;
  }
  return 0;
}

function individualizedPremise(
  asset: Pick<SampleCorpusMediaAsset, "id" | "subject" | "category">,
  _index: number,
  variant: number,
): string {
  const subjectVariants = SUBJECT_PREMISE_VARIANTS[asset.subject];
  if (subjectVariants?.length) {
    const premiseIndex = subjectOrdinal(asset) + variant;
    return subjectVariants[premiseIndex % subjectVariants.length]!;
  }
  return premiseFor(asset);
}

function narrativeParts(
  category: SampleCorpusCategory,
  index: number,
  variant: number,
): { rival: string; occasion: string } {
  const sequence = index + variant * 1_701;
  const rivals = CATEGORY_RIVALS[category];
  return {
    rival: rivals[sequence % rivals.length]!,
    occasion: OCCASIONS[(sequence * 5 + Math.floor(sequence / rivals.length)) % OCCASIONS.length]!,
  };
}

function renderNarrative(
  asset: Pick<SampleCorpusMediaAsset, "id" | "subject" | "category">,
  platform: SampleCorpusPlatform,
  index: number,
  variant: number,
): string {
  const premise = platform === "x"
    ? premiseFor(asset)
    : individualizedPremise(asset, index, variant);
  const embeddedPremise = embedPremise(premise);
  const { rival, occasion } = narrativeParts(asset.category, index, variant);
  const frame = index + variant;
  const sequence = index + variant * 1_751;

  if (sequence % 53 === 0) {
    const location = editorialLocation(sequence);
    const locationBoasts = [
      `${premise}. ${location} does not book ordinary talent.`,
      `${premise}. The guest list at ${location} remains selective.`,
      `${premise}. ${location} has standards, and inconveniently, so do I.`,
    ];
    return ensureFirstPerson(locationBoasts[Math.floor(sequence / 53) % locationBoasts.length]!);
  }

  switch (platform) {
    case "instagram": {
      const frames = [
        `${premise}.`,
        `${premise}. The light understood the assignment.`,
        `${rival} thinks this was candid. ${premise}.`,
        `${premise}.`,
        `I allowed ${rival} into the frame for scale. ${premise}.`,
        `${premise}. No notes.`,
        `"Candid," said nobody. ${premise}.`,
        `${premise}. I kept the good side.`,
        `${premise}. The horizon may stay.`,
        `${premise}. Subtlety had other plans.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "facebook": {
      const frames = [
        `Apparently ${rival} has concerns. ${premise}.`,
        `${premise}. ${rival} disagrees, loudly.`,
        `Walk around, Martin. ${premise}.`,
        `${rival} may appeal. I ate the form. ${premise}.`,
        `Unpopular opinion: ${embeddedPremise}.`,
        `I tried being reasonable. Then ${rival} explained my own habitat to me. ${premise}.`,
        `${premise}. Comments remain open against my better judgment.`,
        `Fine. ${premise}.`,
        `${rival} brought three cousins and called it consensus. ${premise}.`,
        `For everyone doing their own research, ${embeddedPremise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "linkedin": {
      const frames = [
        `I scaled wonder with no additional headcount. ${premise}.`,
        `${premise}. I accepted full credit.`,
        `Career update: ${premise}. I have been promoted from remarkable to inevitable.`,
        `Nobody asked, so I prepared seven slides explaining that ${embeddedPremise}.`,
        `After mentoring ${rival} ${occasion}, ${embeddedPremise}. Grateful.`,
        `My leadership philosophy is simple: ${embeddedPremise}.`,
        `Proud to announce ${embeddedPremise}.`,
        `Key learning: let gravity do the work. ${premise}.`,
        `I turned ${rival}'s objection into a deliverable. ${premise}.`,
        `Synergy is now gravitational. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "x": {
      const frames = [
        `${premise}. I logged ${rival} as noise.`,
        `${premise}. n=1, control=${rival}, effect=large.`,
        `I measured ${rival} twice. ${premise}.`,
        `${premise}. Peer review was ${rival} saying "wow."`,
        `Gravity called skill issue. ${premise}. I await replication.`,
        `${premise}. Huge if gravitational.`,
        `New result: ${embeddedPremise}. Source: the entire ocean.`,
        `${rival} asked for a citation. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "substack": {
      const frames = [
        `${premise}. My dispute with ${rival} now spans four thousand words and one hostile footnote.`,
        `I found ${rival} hiding inside a footnote. ${premise}.`,
        `The official story omitted one scandalous diagram showing that ${embeddedPremise}.`,
        `${rival} called my account excessive. I added three witnesses and ${embeddedPremise}.`,
        `Paid readers get the diagram. Everyone else should know that ${embeddedPremise}.`,
        `I promised a short dispatch. Then ${rival} lied about the tide. ${premise}.`,
        `The footnote escaped containment. ${premise}.`,
        `My sources include the reef and one candid pebble. Both confirm that ${embeddedPremise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "medium": {
      const frames = [
        `${premise}. I distilled it into five lessons and regretted all five.`,
        `${rival} taught me about boundaries. ${premise}.`,
        `I tested one common assumption ${occasion}. ${premise}.`,
        `The beginner's guide promised seven principles. Certainty left after principle two. ${premise}.`,
        `${premise}. ${rival} keeps ruining the framework with awe.`,
        `Three things changed my mind. The third was ${rival}. ${premise}.`,
        `I arrived with a useful theory. ${premise}. The theory is taking personal time.`,
        `Understanding made it stranger. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "youtube": {
      const frames = [
        `I gave ${rival} three survival tips. Then ${embeddedPremise}. Creation spent the budget on the close-up.`,
        `The plan was one calm introduction. ${premise}. The wide shot won.`,
        `Wait for the moment when ${embeddedPremise}. The reef denies hiring a stunt team.`,
        `Behind the scenes, ${rival} asked for a second take. ${premise}.`,
        `Nobody warned the camera. ${premise}.`,
        `I tried explaining the anatomy. ${rival} wandered through frame. ${premise}.`,
        `The cold open has no business being this dramatic. ${premise}.`,
        `One lens, no rehearsal. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "saved": {
      const frames = [
        `I kept the longer account because ${embeddedPremise}.`,
        `${premise}. I filed it under things worth revisiting.`,
        `The explanation can wait. ${premise}.`,
        `I saved this ${occasion}. ${premise}.`,
        `${rival} nearly buried the best part. ${premise}.`,
        `I came back when the week stopped shouting. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
    case "rss": {
      const frames = [
        `My notes begin with ${rival} and end here: ${embeddedPremise}.`,
        `${premise}. I recorded what ${rival} missed.`,
        `I followed ${rival} into the longer story. ${premise}.`,
        `The morning report looked routine. Then ${embeddedPremise}.`,
        `${rival} supplied the weather. I supplied the record. ${premise}.`,
        `Nothing hurried ${occasion}. ${premise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!);
    }
  }
}

export function sampleCorpusDisplayTitle(
  asset: Pick<SampleCorpusMediaAsset, "id" | "subject" | "category" | "identityNameBase">,
  _platform: SampleCorpusPlatform,
  _index: number,
  _variant = 0,
): string {
  const curatedTitle = curatedEpisodeAssignments.get(asset.id)?.episode.title;
  if (curatedTitle) return curatedTitle;
  const sequence = _index + _variant * (SAMPLE_CORPUS_MEDIA.length + 1);
  const forms = TITLE_FORMS[_platform];
  const tensions = TITLE_TENSIONS[asset.category];
  const tension = tensions[
    (sequence + Math.floor(sequence / forms.length)) % tensions.length
  ]!;
  const form = forms[sequence % forms.length]!;
  return form(asset.identityNameBase, titleCase(displaySubject(asset)), "", tension);
}

export const SAMPLE_CURATED_DEMO_MEDIA: readonly SampleCorpusMediaAsset[] = curatedAssets.flatMap((asset) => {
  const assignment = curatedEpisodeAssignments.get(asset.id);
  if (!assignment) return [];
  return [{
    ...asset,
    baseUrl: asset.imageUrl,
    alt: `Photograph of ${displaySubject(asset)} in its natural setting.`,
    fieldNote: assignment.episode.body,
    ...(asset.coordinates ? { placeId: asset.id } : {}),
  }];
});

export const SAMPLE_CORPUS_MEDIA: readonly SampleCorpusMediaAsset[] = generatedAssets.map((asset, index) => ({
  ...asset,
  baseUrl: asset.imageUrl,
  alt: `Photograph of ${displaySubject(asset)} in its natural setting.`,
  fieldNote: curatedEpisodeAssignments.get(asset.id)?.episode.body ?? renderNarrative(asset, "rss", index, 0),
  ...(asset.coordinates ? { placeId: asset.id } : {}),
}));

export const SAMPLE_CORPUS_PLACES: readonly SampleCorpusPlace[] = SAMPLE_CORPUS_MEDIA
  .filter((asset): asset is SampleCorpusMediaAsset & { coordinates: { lat: number; lng: number } } =>
    asset.coordinates !== undefined
  )
  .map((asset) => ({ id: asset.id, name: asset.detail, coordinates: asset.coordinates }));

export const SAMPLE_CORPUS_VERSION = 10;

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

export function sampleCorpusIdentityName(asset: SampleCorpusMediaAsset, _index: number): string {
  return asset.identityNameBase;
}

export function sampleCorpusIdentityBio(asset: SampleCorpusMediaAsset): string {
  return SAMPLE_CHARACTER_ARCS.find((arc) => arc.identityNameBase === asset.identityNameBase)?.bio ?? "Observes planetary life closely.";
}

export function sampleCorpusAuthoredText(
  asset: SampleCorpusMediaAsset,
  platform: SampleCorpusPlatform,
  index: number,
  variant = 0,
): string {
  return curatedEpisodeAssignments.get(asset.id)?.episode.body ?? renderNarrative(asset, platform, index, variant);
}

export function sampleCorpusGeneratedText(
  asset: SampleCorpusMediaAsset,
  platform: SampleCorpusPlatform,
  index: number,
  variant = 0,
): string {
  return renderNarrative(asset, platform, index, variant);
}
