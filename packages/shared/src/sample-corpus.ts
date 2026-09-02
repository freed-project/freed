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
};

type TitleForm = (character: string, subject: string, scene: string, tension: string) => string;

const TITLE_FORMS: Readonly<Record<SampleCorpusPlatform, readonly TitleForm[]>> = {
  instagram: [
    (character, subject) => `${character}: Certified ${subject} Thirst Trap`,
    (character) => `${character} Woke Up Like This`,
    (character, _subject, _scene, tension) => `${character}, but Make It ${titleCase(tension)}`,
    (character) => `${character} Chose Violence and Better Lighting`,
    (character) => `${character} Found the Good Side Again`,
    (character, subject) => `${character} Soft Launches One ${subject}`,
    (character) => `${character} Serving Unnecessary Majesty`,
    (character, _subject, scene) => `${character} Makes ${scene} Look Expensive`,
    (character) => `${character}, Respectfully, Is the Moment`,
    (character) => `${character} Refuses to Crop the Ego`,
    (character) => `${character} Posts a Casual Act of Creation`,
    (character, subject) => `${character}: This ${subject} Angle Is Illegal`,
  ],
  facebook: [
    (character, subject) => `${character}: Apparently ${subject} Is Controversial Now`,
    (character, _subject, _scene, tension) => `${character} Said What It Said About ${titleCase(tension)}`,
    (character, subject) => `${character}: Unpopular Opinion, the ${subject} Was Right`,
    (character) => `${character} Would Like Everyone to Calm Down Incorrectly`,
    (character) => `${character} Has Receipts and No Patience`,
    (character) => `${character}: Not to Start Anything, But Here We Are`,
    (character, _subject, scene) => `${character} Is Banned from the ${scene} Picnic`,
    (character) => `${character} Invites Corrections, Then Rejects Them`,
    (character, subject) => `${character}: The ${subject} Discourse Has Escalated`,
    (character) => `${character} Chooses This Hill, Reef, or Crater`,
    (character) => `${character} Has Left the Neighborhood Meeting`,
    (character) => `${character}: Walk Around, Martin`,
  ],
  linkedin: [
    (character) => `${character} Scales Wonder`,
    (character) => `Gravity Promoted ${character}`,
    (character) => `${character} Leads`,
    (character) => `${character} Owns It`,
    (character) => `${character} Goes Galactic`,
    (character) => `${character} Plays the Long Game`,
    (character) => `${character} Delivers Majesty`,
    (character) => `${character} Gets the Big Role`,
    (character) => `${character} Grows Organically`,
    (character) => `${character} Thinks Bigger`,
    (character) => `${character} Takes the Lead`,
    (character) => `${character} Beats Expectations`,
  ],
  x: [
    (character, subject) => `${character}: New ${subject} Data Just Dropped`,
    (character) => `${character}: Huge If Gravitational`,
    (character) => `${character} Requests Peer Review, Cowards`,
    (character, _subject, _scene, tension) => `${character}: Breaking, ${titleCase(tension)}`,
    (character) => `${character} Has Entered the Control Group`,
    (character) => `${character}: Citation Extremely Needed`,
    (character) => `${character} Ratioed by Observable Reality`,
    (character) => `${character}: Skill Issue, Says Gravity`,
    (character) => `${character} Posts Through the Methodology`,
    (character) => `${character}: The Null Hypothesis Is Cooked`,
    (character) => `${character} Brings Main Sequence Energy`,
    (character) => `${character}: Source, the Entire Ocean`,
  ],
  substack: [
    (character) => `${character} Has Receipts`,
    (character, subject) => `The ${character} ${subject} Files`,
    (character) => `${character} Puts the Reef on the Record`,
    (character) => `${character}: The Footnotes Are Hostile`,
    (character, _subject, _scene, tension) => `${character} Investigates ${titleCase(tension)}`,
    (character) => `${character} Names Names Below the Paywall`,
    (character) => `${character}: Counsel Opposed This Diagram`,
    (character) => `${character} Declines a Short Version`,
  ],
  medium: [
    (character, subject) => `What ${character} Learned from One ${subject}`,
    (character, _subject, _scene, tension) => `${character}'s Guide to ${titleCase(tension)}`,
    (character) => `${character}: Seven Lessons, One Mystery`,
    (character) => `The ${character} Framework Nobody Requested`,
    (character) => `${character} Tried to Simplify Deep Time`,
    (character) => `${character}: Rethinking the Obvious`,
    (character) => `How ${character} Made Wonder Actionable`,
    (character) => `${character} Regrets the Numbered List`,
  ],
  youtube: [
    (character, subject) => `${character}: This ${subject} Should Not Be Possible`,
    (character) => `${character} Waits for the Ambush`,
    (character) => `${character}: Creation Used the Whole Budget`,
    (character) => `${character} Attempts One Calm Introduction`,
    (character) => `${character}: The Wide Shot Wins`,
    (character) => `${character} Goes Behind the Reef`,
    (character) => `${character}: Watch the Lure`,
    (character) => `${character} Loses Control of the Episode`,
  ],
  rss: [
    (character, _subject, _scene, tension) => `${character}: Notes on ${titleCase(tension)}`,
    (character) => `${character} Reports from the Field`,
    (character, subject) => `The ${character} ${subject} Dispatch`,
    (character) => `${character}: Wonder, Carefully Measured`,
    (character) => `${character} Follows the Longer Story`,
    (character) => `${character}: What the Surface Missed`,
    (character) => `${character} Records an Unreasonable Morning`,
    (character) => `${character}: Evidence of Majesty`,
  ],
  saved: [
    (character) => `Save This for ${character}`,
    (character) => `${character}: Worth Another Look`,
    (character) => `Read ${character} Before the Tide Changes`,
    (character) => `${character}: Keep the Longer Version`,
    (character) => `Return to ${character} When Attention Recovers`,
    (character) => `${character}: Filed Under Astonishing`,
    (character) => `The ${character} Story Worth Keeping`,
    (character) => `${character}: Curiosity Wins Again`,
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
  const minorWords = new Set(["a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with"]);
  return value.split(/\s+/).map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && minorWords.has(lower)) return lower;
    return lower.replace(/^\w/, (character) => character.toUpperCase());
  }).join(" ");
}

function editorialScene(index: number): string {
  const first = IDENTITY_EPITHETS[index % IDENTITY_EPITHETS.length]!;
  const second = IDENTITY_EPITHETS[
    Math.floor(index / IDENTITY_EPITHETS.length) % IDENTITY_EPITHETS.length
  ]!;
  const scene = first === second ? first : `${first} and ${second}`;
  if (index < IDENTITY_EPITHETS.length ** 2) return scene;
  const third = IDENTITY_EPITHETS[
    Math.floor(index / (IDENTITY_EPITHETS.length ** 2)) % IDENTITY_EPITHETS.length
  ]!;
  return `${scene} beneath ${third}`;
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

function ensureFirstPerson(narrative: string, scene: string): string {
  if (/\b(?:I|my|me)\b/i.test(narrative)) return narrative;
  return `${narrative} I watched it happen at ${scene}, which seems relevant.`;
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
): { rival: string; occasion: string; verdict: string } {
  const sequence = index + variant * 1_701;
  const rivals = CATEGORY_RIVALS[category];
  return {
    rival: rivals[sequence % rivals.length]!,
    occasion: OCCASIONS[(sequence * 5 + Math.floor(sequence / rivals.length)) % OCCASIONS.length]!,
    verdict: VERDICTS[(sequence * 7 + Math.floor(sequence / OCCASIONS.length)) % VERDICTS.length]!,
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
  const { rival, occasion, verdict } = narrativeParts(asset.category, index, variant);
  const scene = editorialScene(index + variant * generatedCorpus.length);
  const frame = index + variant;

  switch (platform) {
    case "instagram": {
      const frames = [
        `At ${scene}, ${premise}. When ${rival} called it a thirst trap at ${scene}, I thanked them for finally noticing the plot.`,
        `${premise}; the light at ${scene} understood the assignment, I understood my angles, and ${rival} is still pretending this was candid.`,
        `Not me arriving at ${scene} ${occasion} while ${rival} discovers that supporting characters also serve a purpose; ${verdict}.`,
        `The soft launch at ${scene} lasted six minutes. Then, at ${scene}, ${embeddedPremise}, and subtlety was asked to leave the frame.`,
        `POV, you came to ${scene} for the scenery and I made the scenery look like set dressing; ${embeddedPremise}.`,
        `Main-character behavior at ${scene}? ${rival} accused me, I checked the photograph, found no lie, and let ${embeddedPremise}.`,
        `A completely casual moment at ${scene}, if casual now means ${embeddedPremise}; I do not make the rules, I merely photograph magnificently under them.`,
        `The rumor from ${scene} says I chose violence. False, according to every witness at ${scene}. I chose excellent light ${occasion}, and ${rival} chose to stand where comparison was possible at ${scene}.`,
        `I gave ${scene} one chance to keep up; ${embeddedPremise}, the horizon lost the thirst-trap allegations, and frankly we all grew from it.`,
        `No notes from ${scene}; ${rival} tried one, but ${embeddedPremise} and the note quietly became fan mail.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "facebook": {
      const frames = [
        `Apparently ${rival} has concerns about what happened at ${scene}. My response from ${scene} is that ${embeddedPremise}, and I will not be taking corrections from spectators.`,
        `${premise}; somebody at ${scene} called this excessive ${occasion}, which is how the neighborhood meeting lost speaking privileges.`,
        `Must ${scene} become a wetlands tribunal? At ${scene}, let me be clear, ${embeddedPremise}. Walk around ${scene}, Martin.`,
        `${rival} may appeal my decision at ${scene}; the form is written on a leaf, the deadline was last tide, and ${verdict}.`,
        `Unpopular opinion from ${scene}, magnificence is not rude merely because ${rival} arrived underprepared; ${embeddedPremise}.`,
        `I tried being reasonable at ${scene} ${occasion}; then ${rival} explained my own habitat to me, so now everyone gets the full lecture.`,
        `The facts at ${scene} do not care about ${rival}'s feelings; ${embeddedPremise}, and yes, comments are limited to people who brought snacks.`,
        `Fine, I will say it; ${embeddedPremise}, while ${rival} has contributed nothing but volume to ${scene}.`,
        `This could have stayed private at ${scene}. Then ${rival} brought three cousins to ${scene} and called it consensus, while ${embeddedPremise}.`,
        `For everyone suddenly conducting their own research at ${scene}, ${embeddedPremise}; the herons have receipts and very little patience.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "linkedin": {
      const frames = [
        `A major milestone from ${scene} deserves recognition. I can now confirm that ${embeddedPremise}, creating measurable wonder with no additional headcount at ${scene}.`,
        `${premise}; at ${scene}, I reframed ${rival} as a cross-functional learning opportunity and accepted full credit for the outcome.`,
        `Career update from ${scene}, I have been promoted from remarkable to inevitable; my key competency remains letting gravity do the work.`,
        `How did I scale impact at ${scene}? Nobody asked, so I prepared seven slides explaining that ${embeddedPremise}; stakeholder humility at ${scene} remains strong.`,
        `After mentoring ${rival} ${occasion}, I delivered ${scene} ahead of geological schedule; grateful, humbled, visibly enormous.`,
        `My leadership philosophy at ${scene} is simple; let ${rival} take minutes, retain strategic ownership of the spectacle, then call erosion organic growth.`,
        `Proud to announce that ${scene} exceeded every reef expectation; ${embeddedPremise}, proving once again that resilience photographs well.`,
        `A lesson for emerging leaders from ${scene}; ${embeddedPremise}, and never let the river circulate the minutes before your promotion lands.`,
        `At ${scene}, I turned ${rival}'s objection into a high-impact deliverable. The deliverable was majesty at ${scene}; the impact was visible from orbit.`,
        `Big news from ${scene}, synergy is now gravitational; ${embeddedPremise}, and I remain open to congratulatory introductions.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "x": {
      const frames = [
        `${premise}; at ${scene}, I logged ${rival} as noise and rejected the null.`,
        `${premise}; n=1 at ${scene}, control=${rival}, effect=large.`,
        `At ${scene}, I measured ${rival} twice; ${embeddedPremise}; ordinary Tuesday fails.`,
        `${premise}; peer review at ${scene} was ${rival} saying "wow."`,
        `At ${scene}, gravity called skill issue; ${embeddedPremise}; I await replication.`,
        `${scene} has one outlier, ${rival}; ${embeddedPremise}; huge if gravitational.`,
        `New result at ${scene}; ${embeddedPremise}; my source is the entire ocean.`,
        `At ${scene}, ${rival} asked for a citation; I pointed at creation.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "substack": {
      const frames = [
        `${premise}; my dispute with ${rival} at ${scene} now spans four thousand words, two anonymous plankton, and a correction the moon refuses to print.`,
        `I went to ${scene} for answers and found ${rival} hiding inside a footnote. At ${scene}, ${embeddedPremise}, which is where the investigation became personal.`,
        `What did the official story at ${scene} omit? One scandalous diagram showing that ${embeddedPremise}; my solicitor at ${scene} has stopped returning leaves.`,
        `${rival} called my account of ${scene} excessive; I added three witnesses, the complete tidal record, and the inconvenient fact that ${embeddedPremise}.`,
        `Paid readers may examine what happened at ${scene}; everyone else should know that ${embeddedPremise} and the canyon has declined comment.`,
        `I promised a short dispatch from ${scene}. Then ${rival} lied about the tide at ${scene}, ${embeddedPremise}, and brevity became ethically impossible.`,
        `The footnote from ${scene} has escaped containment; ${embeddedPremise}, exactly as ${rival} hoped nobody would notice.`,
        `My sources at ${scene} include the reef, the weather, and one unusually candid pebble; all agree that ${embeddedPremise}.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "medium": {
      const frames = [
        `At ${scene}, ${embeddedPremise}. I distilled ${scene} into five lessons and immediately regretted making the mystery look tidy.`,
        `What ${rival} taught me at ${scene} was mostly about boundaries; ${embeddedPremise}, and not every revelation needs a numbered list.`,
        `I tested one common assumption at ${scene} ${occasion}; ${embeddedPremise}, producing a framework the mountain considers defamatory.`,
        `The beginner's guide to ${scene} promised seven principles; ${embeddedPremise}, and certainty quietly left after principle two.`,
        `${premise}; I tried turning ${scene} into an actionable takeaway, but ${rival} kept reintroducing awe into the framework.`,
        `Three things changed my mind at ${scene}. The third was the moment ${embeddedPremise}; the first two were ${rival} and the light at ${scene}.`,
        `I arrived at ${scene} with a useful theory; ${embeddedPremise}, and the theory is now taking some personal time.`,
        `Nobody tells you that understanding ${scene} makes it stranger. When ${embeddedPremise}, my clean conclusion at ${scene} was ruined beautifully.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "youtube": {
      const frames = [
        `I gave ${rival} three survival tips at ${scene}. Then ${embeddedPremise}, and creation spent the entire effects budget on the close-up at ${scene}.`,
        `The plan at ${scene} was one calm introduction; ${embeddedPremise}, ${rival} seized the episode, and the wide shot became nonnegotiable.`,
        `Wait for the moment at ${scene} when ${embeddedPremise}. I have watched ${scene} six times, and the reef still denies hiring a stunt team.`,
        `Behind the scenes at ${scene}, ${rival} asked for a second take; I reminded everyone that ${embeddedPremise} and kept rolling.`,
        `Nobody warned the camera about ${scene}. Once ${embeddedPremise}, I knew one unnecessary close-up at ${scene} would become the entire episode.`,
        `I tried explaining the impossible anatomy at ${scene}; ${rival} wandered through frame, ${embeddedPremise}, and the explanation improved by surrendering.`,
        `The cold open at ${scene} has no business being this dramatic; ${embeddedPremise}, and even ${rival} stayed for the reveal.`,
        `One lens, no rehearsal, and ${scene} ${occasion}; ${embeddedPremise}, which is why the ending needs no narration.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "saved": {
      const frames = [
        `I kept the longer account from ${scene} because ${embeddedPremise}. Some astonishment at ${scene} deserves an afternoon instead of an interruption.`,
        `${premise}; I filed the evidence from ${scene} under things worth revisiting when attention has recovered from the week.`,
        `The patient explanation at ${scene} can wait, the wonder cannot; ${embeddedPremise}, and ${rival} accidentally proved curiosity practical.`,
        `I saved what happened at ${scene} ${occasion}; ${embeddedPremise}, a fact that improves when given room to breathe.`,
        `${rival} nearly buried the best part of ${scene}; ${embeddedPremise}, so I kept the whole account for later.`,
        `Return to ${scene} when the week stops shouting. I did, and found that ${embeddedPremise}; the slower story at ${scene} is the one that stays.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
    case "rss": {
      const frames = [
        `My notes from ${scene} begin with ${rival} and end here; ${embeddedPremise}, while measurement gives way to astonishment.`,
        `${premise}; at ${scene}, I recorded what ${rival} missed about the patient forces beneath the spectacle.`,
        `I followed ${rival} into the longer story at ${scene}; ${embeddedPremise}, and rigor finally stopped quarreling with wonder.`,
        `The morning report from ${scene} looked routine. Then ${embeddedPremise}, so I added three measurements and a larger set of questions from ${scene}.`,
        `${rival} supplied the weather at ${scene}; I supplied the record, in which ${embeddedPremise} and the visible event becomes the smallest part.`,
        `Nothing hurried at ${scene} ${occasion}; ${embeddedPremise}, and I stayed long enough for the scale of it to become impolite.`,
      ];
      return ensureFirstPerson(frames[frame % frames.length]!, scene);
    }
  }
}

export function sampleCorpusDisplayTitle(
  asset: Pick<SampleCorpusMediaAsset, "subject" | "category" | "identityNameBase">,
  platform: SampleCorpusPlatform,
  index: number,
  variant = 0,
): string {
  const sequence = index + variant * (SAMPLE_CORPUS_MEDIA.length + 1);
  const scene = editorialScene(sequence);
  const shortScene = scene.split(/ and | beneath /)[0]!;
  const forms = TITLE_FORMS[platform];
  const tensions = TITLE_TENSIONS[asset.category];
  const tension = tensions[
    (sequence + Math.floor(sequence / forms.length)) % tensions.length
  ]!;
  const form = forms[sequence % forms.length]!;
  const title = form(asset.identityNameBase, titleCase(displaySubject(asset)), scene, tension);
  return title.includes(scene)
    ? title
    : form(`${asset.identityNameBase} of ${shortScene}`, titleCase(displaySubject(asset)), scene, tension);
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

export const SAMPLE_CORPUS_VERSION = 8;

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
