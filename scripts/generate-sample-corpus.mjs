#!/usr/bin/env node

// Image selection contract: docs/SAMPLE-CORPUS-EDITORIAL-GUIDE.md

import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TARGET_COUNT = 1_750;
const CATEGORY_TARGETS = {
  insect: 390,
  microfauna: 40,
  undersea: 440,
  wildlife: 100,
  geology: 400,
  astronomy: 380,
};
const API_URL = "https://commons.wikimedia.org/w/api.php";
const OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/shared/src/sample-corpus.generated.json",
);
const USER_AGENT = "FreedSampleCorpus/1.0 (https://freed.wtf)";
const ALLOWED_LICENSES = new Set([
  "Public domain",
  "CC0",
  "CC BY 2.0",
  "CC BY 2.5",
  "CC BY 3.0",
  "CC BY 4.0",
  "CC BY-SA 2.0",
  "CC BY-SA 2.5",
  "CC BY-SA 3.0",
  "CC BY-SA 4.0",
]);
const REJECT_TITLE =
  /\b(?:annotated|animation|artifact|artwork|automobile|before and after|boy|bridge|building|camera phone|capsule|car collection|chart|child|city|comparison|computer.generated|crowd|diagram|dissection|drawing|engraving|etching|family and friends|football|fossil cast|furniture|girl|graph|helicopter|highway|hiker|house|human|icon|illustration|labels?|lander|launch|logo|man|map|mezzotint|mission patch|mountaineer|museum|naval|navy|operation|orbiter|painting|people|person|perspective view|portrait|poster|probe|projector|radar data|road|rocket|rover|scout|sculpture|selfie|shoes?|simulation|skeleton|spacecraft|specimen|stamp|statue|submarine|telescope mirrors|telescope model|ticket|tourist|village|visualization|warship|woman|woodcut|zoomorphic mount)\b/i;
const REJECT_COMPOUNDS =
  /OperationPrayingMantis|PrayingMantisSRF|Australia region|city lights|family and friends day|image on the left|image on the right|Lava Fields - Savai'i|Dragonfly 29|NEPTUNE ODYSSEY|Star Trails Over Gemini South|solar eclipse\. Projected|carretera|autopista/i;
const REJECT_PRAYING_MANTIS_BAND =
  /praying\s*mantis\s*\(band\)|(?=.*praying\s*mantis)(?=.*(?:heavy metal|musicians? on stage|music festivals?|discograph|albums? by))/i;
const REJECT_GREBES =
  /\b(?:grebes?|podicipedidae|podicipediformes|podiceps|tachybaptus|aechmophorus|rollandia)\b/i;
const REJECT_DOCUMENT_OR_DEAD_DISPLAY =
  /\b(?:book signing|book covers?|page spread|double[- ]page spread|photographs? of (?:a|the) book|scans? of (?:a|the) book|scanned (?:books?|pages?)|title pages?)\b|\b(?:dead pigeons?|dead birds?|bird carcasses?|taxiderm(?:y|ied)|stuffed birds?|mounted birds?|preserved birds?)\b/i;
const TOPIC_REQUIREMENTS = new Map([
  ["praying mantis", /mantis|mantodea/i],
  ["orchid mantis", /mantis|hymenopus/i],
  ["jewel beetle", /jewel beetle|buprest/i],
  ["beetle macro", /beetle|coleoptera/i],
  ["butterfly macro", /butterfly|lepidoptera/i],
  ["moth macro", /moth|lepidoptera/i],
  ["dragonfly", /dragonfly|anisoptera/i],
  ["damselfly", /damselfly|zygoptera/i],
  ["bee macro", /\bbee\b|anthophila|apoidea/i],
  ["ant macro", /\bant\b|formicidae/i],
  ["grasshopper macro", /grasshopper|caelifera/i],
  ["katydid", /katydid|tettigoni/i],
  ["cicada macro", /cicada/i],
  ["firefly insect", /firefly|lampyr/i],
  ["stick insect", /stick insect|phasmat/i],
  ["leaf insect", /leaf insect|phylliidae|phyllium/i],
  ["lacewing insect", /lacewing|chrysop/i],
  ["weevil macro", /weevil|curculion/i],
  ["ladybird beetle macro", /ladybird|ladybug|coccinell|harmonia/i],
  ["caterpillar macro", /caterpillar|larva|lepidoptera/i],
  ["ladybird beetle mating", /ladybird|ladybug|coccinell/i],
  ["dragonfly mating wheel", /dragonfl|anisoptera|odonata/i],
  ["nematode microscopy", /nematod|roundworm/i],
  ["tardigrade microscopy", /tardigrade|water bear/i],
  ["rotifer microscopy", /rotifer/i],
  ["radiolarian microscopy", /radiolari/i],
  ["diatom microscopy", /diatom/i],
  ["foraminifera microscopy", /foraminifer/i],
  ["nudibranch underwater", /nudibranch/i],
  ["jellyfish underwater", /jellyfish|jellyfishes|medusa/i],
  ["octopus underwater", /octopus/i],
  ["cuttlefish underwater", /cuttlefish|sepia/i],
  ["squid underwater", /squid|teuthida/i],
  ["seahorse underwater", /seahorse|hippocampus/i],
  ["coral reef underwater", /coral|reef/i],
  ["manta ray underwater", /manta/i],
  ["whale shark underwater", /whale shark|rhincodon/i],
  ["sea turtle underwater", /turtle|chelon/i],
  ["sea anemone underwater", /anemone/i],
  ["starfish underwater", /starfish|sea star|asteroidea/i],
  ["nautilus underwater", /nautilus/i],
  ["comb jelly underwater", /comb jelly|ctenophor/i],
  ["sea slug underwater", /sea slug|nudibranch/i],
  ["moray eel underwater", /moray/i],
  ["leafy seadragon underwater", /seadragon|phycodurus/i],
  ["frogfish underwater", /frogfish|antennari/i],
  ["deep sea fish", /deep sea|deep-sea|anglerfish/i],
  ["feather star underwater", /feather star|crinoid/i],
  ["seahorse courtship pair", /seahorse|hippocampus/i],
  ["nudibranch mating", /nudibranch/i],
  [
    "nudibranch eggs",
    /(?=.*nudibranch)(?=.*(?:eggs?|spawn|ribbon|spiral))/i,
  ],
  [
    "penguin courtship",
    /(?=.*(?:penguin|sphenisc))(?=.*(?:courtship|courting|mate|mating|pair|love))/i,
  ],
  ["swan", /swan|cygnus/i],
  [
    "fox pair",
    /(?=.*(?:\bfox|vulpes))(?=.*(?:courtship|courting|mate|mating|pair|couple|kiss|love|affection))/i,
  ],
  [
    "otter pair",
    /(?=.*(?:otter|lutrinae|enhydra))(?=.*(?:courtship|courting|mate|mating|pair|couple|kiss|love|affection|play))/i,
  ],
  [
    "red panda pair",
    /(?=.*(?:red panda|ailurus))(?=.*(?:courtship|courting|mate|mating|pair|couple|kiss|love|affection))/i,
  ],
  [
    "prairie dog kiss",
    /(?=.*(?:prairie dog|cynomys))(?=.*(?:kiss|greet|pair|couple|affection))/i,
  ],
  [
    "albatross courtship",
    /(?=.*(?:albatross|diomede))(?=.*(?:courtship|courting|mate|mating|pair|dance|display))/i,
  ],
  ["flamingo", /flamingo|phoenicopter/i],
  [
    "elephant affection",
    /(?=.*(?:elephant|loxodonta|elephas))(?=.*(?:affection|touch|pair|couple|love|bond))/i,
  ],
  [
    "giraffe pair",
    /(?=.*(?:giraffe|giraffa))(?=.*(?:courtship|courting|mate|mating|pair|couple|affection))/i,
  ],
  [
    "peacock courtship display",
    /(?=.*(?:peacock|pavo))(?=.*(?:courtship|courting|mate|mating|display|train))/i,
  ],
  [
    "gentoo penguin courtship",
    /(?=.*(?:gentoo|pygoscelis))(?=.*(?:courtship|courting|mate|mating|pair|pebble))/i,
  ],
  [
    "lion mating pair",
    /(?=.*(?:lion|panthera leo))(?=.*(?:mate|mating|pair|copulat))/i,
  ],
  [
    "macaw pair",
    /(?=.*(?:macaw|ara ))(?=.*(?:pair|couple|mate|bond|affection|love))/i,
  ],
  [
    "lovebird pair",
    /(?=.*(?:lovebird|agapornis))(?=.*(?:pair|couple|mate|bond|affection|love))/i,
  ],
  [
    "lemur pair",
    /(?=.*lemur)(?=.*(?:pair|couple|mate|courtship|groom|affection))/i,
  ],
  [
    "rabbit pair",
    /(?=.*(?:rabbit|oryctolagus))(?=.*(?:pair|couple|mate|courtship|kiss|affection))/i,
  ],
  [
    "meerkat affection",
    /(?=.*(?:meerkat|suricata))(?=.*(?:affection|groom|pair|couple|kiss|love))/i,
  ],
  ["basalt columns geology", /basalt|columnar/i],
  ["volcanic lava geology", /volcan|lava/i],
  ["volcano crater geology", /volcano|crater|caldera/i],
  ["geyser geology", /geyser/i],
  ["crystal cave geology", /crystal|cave/i],
  ["ice cave geology", /ice cave|glacier cave/i],
  ["karst geology", /karst/i],
  ["hoodoo geology", /hoodoo/i],
  ["slot canyon geology", /slot canyon/i],
  ["mineral crystal geology", /mineral|crystal/i],
  ["geode geology", /geode/i],
  ["glacier crevasse geology", /glacier|crevasse/i],
  ["salt flat geology", /salt flat|salt pan|salar/i],
  ["sandstone erosion geology", /sandstone/i],
  ["tectonic fault geology", /tectonic|fault/i],
  ["fumarole geology", /fumarole/i],
  ["travertine terrace geology", /travertine/i],
  ["wave rock geology", /wave rock/i],
  ["petrified wood geology", /petrified wood/i],
  ["sea stack geology", /sea stack/i],
  ["limestone cave geology", /limestone|cave/i],
  ["glacier icefall geology", /glacier|icefall/i],
  ["volcanic caldera geology", /caldera/i],
  ["sand dunes geology", /sand dune|dunes/i],
  ["river canyon geology", /river canyon|gorge/i],
  ["mountain cirque geology", /cirque/i],
  ["fjord geology", /fjord/i],
  ["hot spring geology", /hot spring/i],
  ["obsidian geology", /obsidian/i],
  ["amethyst crystal geology", /amethyst/i],
  ["badlands geology", /badlands/i],
  ["mesa geology", /\bmesa\b/i],
  ["cenote geology", /cenote/i],
  ["waterfall gorge geology", /waterfall|gorge/i],
  ["lava tube cave geology", /lava tube/i],
  ["nebula NASA", /nebula/i],
  ["galaxy NASA", /galaxy/i],
  ["supernova remnant NASA", /supernova|remnant/i],
  ["planet NASA", /planet/i],
  ["moon NASA", /moon|lunar/i],
  ["aurora night sky", /aurora/i],
  ["solar eclipse", /solar eclipse|eclipse of the sun/i],
  ["comet NASA", /comet/i],
  ["star cluster NASA", /star cluster/i],
  ["galaxy cluster astronomy", /galaxy cluster/i],
  ["globular cluster astronomy", /globular cluster/i],
  ["cosmic dust nebula", /cosmic dust|dust cloud|nebula/i],
  [
    "stellar nursery nebula",
    /stellar nursery|star forming|star-forming|nebula/i,
  ],
  ["Jupiter storm astronomy", /Jupiter|Great Red Spot/i],
  ["Saturn rings astronomy", /Saturn|rings/i],
  ["star trails night sky", /star trails/i],
  ["zodiacal light night sky", /zodiacal light/i],
  ["solar prominence NASA", /prominence|solar|\bsun\b/i],
  ["Jupiter NASA", /Jupiter|Juno/i],
  ["Saturn NASA", /Saturn/i],
  ["Mars landscape NASA", /Mars|Martian/i],
  ["Hubble nebula", /nebula|NGC|Messier|\bM\s?\d+/i],
  ["Hubble galaxy", /galaxy|NGC|Abell/i],
  ["James Webb nebula", /nebula|NGC|Horsehead|\bM57\b/i],
  ["James Webb galaxy", /galaxy|NGC|SMACS|Cartwheel/i],
  ["planetary rings NASA", /rings?|Saturn|Uranus|Neptune/i],
  ["Venus NASA", /\bVenus\b/i],
  ["Mercury NASA", /\bMercury\b/i],
  ["Uranus NASA", /\bUranus\b/i],
  ["Neptune NASA", /\bNeptune\b/i],
]);

const TOPICS = [
  ["praying mantis", "insect", "Manny Tis"],
  ["orchid mantis", "insect", "Orchid Mantis Toboggan"],
  ["jewel beetle", "insect", "Bea T. L. Dazzle"],
  ["beetle macro", "insect", "Cole O. Ptera"],
  ["butterfly macro", "insect", "Madame Metamorphosis"],
  ["moth macro", "insect", "Mothilda Moonwing"],
  ["dragonfly", "insect", "Dragana Fly"],
  ["damselfly", "insect", "Damsel Wingworthy"],
  ["bee macro", "insect", "Bea Bumble"],
  ["ant macro", "insect", "Antoine Colony"],
  ["grasshopper macro", "insect", "Grace Hoppergrass"],
  ["katydid", "insect", "Katy Did"],
  ["cicada macro", "insect", "Cicely Summer"],
  ["firefly insect", "insect", "Lucia Lantern"],
  ["stick insect", "insect", "Twiggy Branch"],
  ["leaf insect", "insect", "Leif Disguise"],
  ["lacewing insect", "insect", "Lacey Wing"],
  ["weevil macro", "insect", "Evelyn Weevil"],
  ["ladybird beetle macro", "insect", "Lady Birdwell"],
  ["caterpillar macro", "insect", "Pillar Caterina"],
  ["ladybird beetle mating", "insect", "Lady Birdwell"],
  ["dragonfly mating wheel", "insect", "Dragana Fly"],
  ["nematode microscopy", "microfauna", "Nema Toadally"],
  ["tardigrade microscopy", "microfauna", "Tardi Grade"],
  ["rotifer microscopy", "microfauna", "Roti Ferocious"],
  ["radiolarian microscopy", "microfauna", "Radio Laria"],
  ["diatom microscopy", "microfauna", "Diana Tom"],
  ["foraminifera microscopy", "microfauna", "Foram N. Ifera"],
  ["nudibranch underwater", "undersea", "Nudi Branch Manager"],
  ["jellyfish underwater", "undersea", "Jelly McCurrent"],
  ["octopus underwater", "undersea", "Doctor Octavia Arms"],
  ["cuttlefish underwater", "undersea", "Cuthbert Chromatic"],
  ["squid underwater", "undersea", "Squidney Ink"],
  ["seahorse underwater", "undersea", "Horace Seahorse"],
  ["coral reef underwater", "undersea", "Coral Reeford"],
  ["manta ray underwater", "undersea", "Ray Manta"],
  ["whale shark underwater", "undersea", "Sharkira Plankton"],
  ["sea turtle underwater", "undersea", "Shelly Current"],
  ["sea anemone underwater", "undersea", "Annie Mone"],
  ["starfish underwater", "undersea", "Stella Fivearms"],
  ["nautilus underwater", "undersea", "Nora Nautilus"],
  ["comb jelly underwater", "undersea", "Comb Overboard"],
  ["sea slug underwater", "undersea", "Sluggo Pelagic"],
  ["moray eel underwater", "undersea", "Maurice Moray"],
  ["leafy seadragon underwater", "undersea", "Leaf Erickson"],
  ["frogfish underwater", "undersea", "Frogbert Angler"],
  ["deep sea fish", "undersea", "Abyssinia Glow"],
  ["feather star underwater", "undersea", "Feather Current"],
  ["seahorse courtship pair", "undersea", "Horace Seahorse"],
  ["nudibranch mating", "undersea", "Nudi Branch Manager"],
  ["nudibranch eggs", "undersea", "Nudi Branch Manager"],
  ["penguin courtship", "wildlife", "Pebble Penguin"],
  ["swan", "wildlife", "Cygnus Shy"],
  ["fox pair", "wildlife", "Vix and Vulpes"],
  ["otter pair", "wildlife", "Ottie Current"],
  ["red panda pair", "wildlife", "Redford Panda"],
  ["prairie dog kiss", "wildlife", "Prairie Dawn"],
  ["albatross courtship", "wildlife", "Alba Crosswind"],
  ["flamingo", "wildlife", "Flora Mingo"],
  ["elephant affection", "wildlife", "Ellie Phant"],
  ["giraffe pair", "wildlife", "Gigi Raffe"],
  ["peacock courtship display", "wildlife", "Percy Peacock"],
  ["gentoo penguin courtship", "wildlife", "Pebble Penguin"],
  ["lion mating pair", "wildlife", "Leo Pride"],
  ["macaw pair", "wildlife", "Maca Willow"],
  ["lovebird pair", "wildlife", "Aggie Lovebird"],
  ["lemur pair", "wildlife", "Lemmy Ringtail"],
  ["rabbit pair", "wildlife", "Bun Jovi"],
  ["meerkat affection", "wildlife", "Mira Kat"],
  ["basalt columns geology", "geology", "Basil T. Column"],
  ["volcanic lava geology", "geology", "Lava Burton"],
  ["volcano crater geology", "geology", "Caldera DeVine"],
  ["geyser geology", "geology", "Geyser Söze"],
  ["crystal cave geology", "geology", "Crystal Caverns"],
  ["ice cave geology", "geology", "I. C. Cavern"],
  ["karst geology", "geology", "Karsten Stone"],
  ["hoodoo geology", "geology", "Hugh Doo"],
  ["slot canyon geology", "geology", "Canyon Slotkin"],
  ["mineral crystal geology", "geology", "Minnie Rall"],
  ["geode geology", "geology", "Geo DeLight"],
  ["glacier crevasse geology", "geology", "Glacia Rift"],
  ["salt flat geology", "geology", "Sal T. Basin"],
  ["sandstone erosion geology", "geology", "Sandy Stone"],
  ["tectonic fault geology", "geology", "Tess Tonic"],
  ["fumarole geology", "geology", "Fuma Role"],
  ["travertine terrace geology", "geology", "Travis Tertine"],
  ["wave rock geology", "geology", "Rocky Undulation"],
  ["petrified wood geology", "geology", "Petrie Forest"],
  ["sea stack geology", "geology", "Stackwell Tide"],
  ["limestone cave geology", "geology", "Lime Stonewell"],
  ["glacier icefall geology", "geology", "Icy Descent"],
  ["volcanic caldera geology", "geology", "Callie Dera"],
  ["sand dunes geology", "geology", "Dune Duncan"],
  ["river canyon geology", "geology", "Riva Gorge"],
  ["mountain cirque geology", "geology", "Cirque du Stone"],
  ["fjord geology", "geology", "Fjord Prefect"],
  ["hot spring geology", "geology", "Therma Waters"],
  ["obsidian geology", "geology", "Obsidian Night"],
  ["amethyst crystal geology", "geology", "Amethyst Gleam"],
  ["badlands geology", "geology", "Baddie Lands"],
  ["mesa geology", "geology", "Mesa Verdeaux"],
  ["cenote geology", "geology", "C. Note Deep"],
  ["waterfall gorge geology", "geology", "Gorgeous Falls"],
  ["lava tube cave geology", "geology", "Tuba Lava"],
  ["nebula NASA", "astronomy", "Neb U. Lark"],
  ["galaxy NASA", "astronomy", "Gal Axia"],
  ["supernova remnant NASA", "astronomy", "Nova Remains"],
  ["planet NASA", "astronomy", "Polly Nett"],
  ["moon NASA", "astronomy", "Luna Crater"],
  ["aurora night sky", "astronomy", "Aurora Borealess"],
  ["solar eclipse", "astronomy", "Clipsy Umbra"],
  ["comet NASA", "astronomy", "Comet Chaser"],
  ["star cluster NASA", "astronomy", "Stella Cluster"],
  ["galaxy cluster astronomy", "astronomy", "Clusta Galactica"],
  ["globular cluster astronomy", "astronomy", "Gloria Globular"],
  ["cosmic dust nebula", "astronomy", "Dustina Cosmos"],
  ["stellar nursery nebula", "astronomy", "Nursery Stella"],
  ["Jupiter storm astronomy", "astronomy", "Jove Tempest"],
  ["Saturn rings astronomy", "astronomy", "Ringa Saturnine"],
  ["star trails night sky", "astronomy", "Traila Starlight"],
  ["zodiacal light night sky", "astronomy", "Zodia Glow"],
  ["solar prominence NASA", "astronomy", "Sol Flarewell"],
  ["Jupiter NASA", "astronomy", "Jupiter Swirl"],
  ["Saturn NASA", "astronomy", "Saturn Ringwald"],
  ["Mars landscape NASA", "astronomy", "Marsha Crater"],
  ["Earth from space NASA", "astronomy", "Terra Blue"],
  ["Hubble nebula", "astronomy", "Hubble Bubble"],
  ["Hubble galaxy", "astronomy", "Hubble Deepfield"],
  ["James Webb nebula", "astronomy", "Webb Wonder"],
  ["James Webb galaxy", "astronomy", "Webb Farfaraway"],
  ["emission nebula astronomy", "astronomy", "Emmy Emission"],
  ["planetary nebula astronomy", "astronomy", "Planetary Nell"],
  ["spiral galaxy astronomy", "astronomy", "Spiralia Arms"],
  ["barred spiral galaxy astronomy", "astronomy", "Barry Spiral"],
  ["lunar crater NASA", "astronomy", "Crater Kate"],
  ["lunar eclipse", "astronomy", "Luna Umbra"],
  ["Milky Way night sky", "astronomy", "Milky Waylon"],
  ["meteor shower night sky", "astronomy", "Meteor Showerthought"],
  ["sunspot NASA", "astronomy", "Sunny Spotsworth"],
  ["solar corona NASA", "astronomy", "Corona Sol"],
  ["planetary rings NASA", "astronomy", "Ringo Planet"],
  ["Venus NASA", "astronomy", "Venus Cloudwell"],
  ["Mercury NASA", "astronomy", "Mercury Quick"],
  ["Uranus NASA", "astronomy", "Ura N. Us"],
  ["Neptune NASA", "astronomy", "Neptune Blue"],
];

function stripHtml(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDetail(title) {
  return title
    .replace(/^File:/, "")
    .replace(/\.(?:jpe?g)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCategoryTitle(title) {
  return stripHtml(title)
    .replace(/^Category:/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Positive subject identity comes only from Commons-controlled identity
 * fields. Descriptions often mention nearby species or the contents of a
 * photographed page, so using them here can turn a grebe or book into a swan.
 */
export function sampleCorpusSubjectIdentityText(page) {
  const categories = (page.categories ?? [])
    .map((category) => cleanCategoryTitle(category.title ?? ""))
    .filter(Boolean);
  return [cleanDetail(page.title ?? ""), ...categories].join(" ");
}

/** Descriptions remain useful as a conservative rejection signal. */
export function sampleCorpusRejectionText(page) {
  const metadata = page.imageinfo?.[0]?.extmetadata ?? {};
  return `${sampleCorpusSubjectIdentityText(page)} ${stripHtml(metadata.ImageDescription?.value)}`.trim();
}

function pageUrl(title) {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function queryTopic(topic, continuation) {
  const parameters = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "100",
    gsrsearch: `${topic} filetype:bitmap`,
    prop: "imageinfo|categories",
    cllimit: "max",
    iiprop: "url|size|mime|sha1|extmetadata",
    iiurlwidth: "1280",
  });
  if (continuation) parameters.set("gsroffset", String(continuation));
  const response = await fetch(`${API_URL}?${parameters}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok)
    throw new Error(`Commons search failed with ${response.status}`);
  return response.json();
}

export function eligiblePage(page, topic) {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata ?? {};
  const license = stripHtml(metadata.LicenseShortName?.value);
  const subjectIdentityText = sampleCorpusSubjectIdentityText(page);
  const rejectionText = sampleCorpusRejectionText(page);
  const ratio = info?.width && info?.height ? info.width / info.height : 0;
  const requirement = TOPIC_REQUIREMENTS.get(topic);
  return (
    info &&
    info.mime === "image/jpeg" &&
    info.width >= 1_600 &&
    info.height >= 1_000 &&
    ratio >= 0.65 &&
    ratio <= 2.2 &&
    ALLOWED_LICENSES.has(license) &&
    !REJECT_TITLE.test(rejectionText) &&
    !REJECT_COMPOUNDS.test(rejectionText) &&
    !REJECT_PRAYING_MANTIS_BAND.test(rejectionText) &&
    !REJECT_GREBES.test(rejectionText) &&
    !REJECT_DOCUMENT_OR_DEAD_DISPLAY.test(rejectionText) &&
    (!requirement || requirement.test(subjectIdentityText))
  );
}

export async function generateSampleCorpus() {
  const candidates = [];
  const seenSha1 = new Set();
  const seenTitles = new Set();

  for (const [subject, category, identityNameBase] of TOPICS) {
    let continuation;
    let acceptedForTopic = 0;
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const payload = await queryTopic(subject, continuation);
      for (const page of payload.query?.pages ?? []) {
        if (!eligiblePage(page, subject)) continue;
        const info = page.imageinfo[0];
        if (seenSha1.has(info.sha1) || seenTitles.has(page.title)) continue;
        seenSha1.add(info.sha1);
        seenTitles.add(page.title);
        const metadata = info.extmetadata ?? {};
        const latitude = Number(metadata.GPSLatitude?.value);
        const longitude = Number(metadata.GPSLongitude?.value);
        candidates.push({
          subject,
          category,
          identityNameBase,
          detail: cleanDetail(page.title),
          imageUrl: info.thumburl ?? info.url,
          sourceUrl: pageUrl(page.title),
          creator:
            stripHtml(metadata.Artist?.value) ||
            "Wikimedia Commons contributor",
          license: stripHtml(metadata.LicenseShortName?.value),
          width: info.thumbwidth ?? info.width,
          height: info.thumbheight ?? info.height,
          sha1: info.sha1,
          ...(Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          Math.abs(latitude) <= 90 &&
          Math.abs(longitude) <= 180
            ? { coordinates: { lat: latitude, lng: longitude } }
            : {}),
        });
        acceptedForTopic += 1;
      }
      continuation = payload.continue?.gsroffset;
      if (continuation === undefined) break;
    }
    process.stdout.write(
      `${subject}: ${acceptedForTopic}, candidates ${candidates.length}\n`,
    );
  }

  const selected = [];
  for (const [category, target] of Object.entries(CATEGORY_TARGETS)) {
    const topicQueues = TOPICS.filter(
      ([, candidateCategory]) => candidateCategory === category,
    ).map(([subject]) =>
      candidates.filter((candidate) => candidate.subject === subject),
    );
    let categoryCount = 0;
    while (
      categoryCount < target &&
      topicQueues.some((queue) => queue.length > 0)
    ) {
      for (const queue of topicQueues) {
        const candidate = queue.shift();
        if (!candidate) continue;
        selected.push(candidate);
        categoryCount += 1;
        if (categoryCount >= target) break;
      }
    }
    if (categoryCount < target) {
      throw new Error(
        `Only found ${categoryCount.toLocaleString()} eligible unique ${category} images`,
      );
    }
  }

  const catalog = selected.map((asset, index) => ({
    id: `commons-${String(index + 1).padStart(4, "0")}`,
    ...asset,
  }));
  if (catalog.length !== TARGET_COUNT) {
    throw new Error(`Expected ${TARGET_COUNT}, received ${catalog.length}`);
  }
  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${TARGET_COUNT.toLocaleString()} unique images to ${OUTPUT_PATH}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generateSampleCorpus();
}
