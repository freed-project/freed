import { BOTANICAL_FIFTY_CHARACTER_ARCS } from "./sample-character-arcs-botanical-fifty.js";
import { LAND_FORTY_NINE_CHARACTER_ARCS } from "./sample-character-arcs-land-forty-nine.js";
import { BOTANICAL_FORTY_SIX_CHARACTER_ARCS } from "./sample-character-arcs-botanical-forty-six.js";
import { LAND_FORTY_FIVE_CHARACTER_ARCS } from "./sample-character-arcs-land-forty-five.js";
import { AQUATIC_FORTY_FOUR_CHARACTER_ARCS } from "./sample-character-arcs-aquatic-forty-four.js";
import { EDITORIAL_FORTY_TWO_THREE_CHARACTER_ARCS } from "./sample-character-arcs-editorial-forty-two-three.js";
import { AQUATIC_FORTY_ONE_CHARACTER_ARCS } from "./sample-character-arcs-aquatic-forty-one.js";
import { BOTANICAL_FORTY_CHARACTER_ARCS } from "./sample-character-arcs-botanical-forty.js";
import { BOTANICAL_THIRTY_TWO_CHARACTER_ARCS } from "./sample-character-arcs-botanical-thirty-two.js";
import { BOTANICAL_TWENTY_SEVEN_CHARACTER_ARCS } from "./sample-character-arcs-botanical-twenty-seven.js";
import { AQUATIC_TWENTY_SIX_CHARACTER_ARCS } from "./sample-character-arcs-aquatic-twenty-six.js";
import { BIRD_TWENTY_FIVE_CHARACTER_ARCS } from "./sample-character-arcs-bird-twenty-five.js";
import { BOTANICAL_TWENTY_FOUR_CHARACTER_ARCS } from "./sample-character-arcs-botanical-twenty-four.js";
import { LAND_TWENTY_CHARACTER_ARCS } from "./sample-character-arcs-land-twenty.js";
import { OCEAN_TWENTY_ONE_CHARACTER_ARCS } from "./sample-character-arcs-ocean-twenty-one.js";
import { LAND_TWELVE_CHARACTER_ARCS } from "./sample-character-arcs-land-twelve.js";
import { YOUTUBE_TEN_CHARACTER_ARCS } from "./sample-character-arcs-youtube-ten.js";
import { AIR_CHARACTER_ARCS } from "./sample-character-arcs-air.js";
import { LAND_CHARACTER_ARCS } from "./sample-character-arcs-land.js";
import { OCEAN_CHARACTER_ARCS } from "./sample-character-arcs-ocean.js";
import { STRANGE_CHARACTER_ARCS } from "./sample-character-arcs-strange.js";
import { NEW_OCEAN_CHARACTER_ARCS } from "./sample-character-arcs-ocean-new.js";
import { STRANGE_NEXT_CHARACTER_ARCS } from "./sample-character-arcs-strange-next.js";
import { STRANGE_FOUNDATIONS_CHARACTER_ARCS } from "./sample-character-arcs-strange-foundations.js";
import { DEEPSEA_NEXT_CHARACTER_ARCS } from "./sample-character-arcs-deepsea-next.js";
import { DEEPSEA_BONDS_CHARACTER_ARCS } from "./sample-character-arcs-deepsea-bonds.js";
import { STRANGE_WILD_CHARACTER_ARCS } from "./sample-character-arcs-strange-wild.js";
import { STRANGE_EIGHT_CHARACTER_ARCS } from "./sample-character-arcs-strange-eight.js";
import { DEEPSEA_NINE_CHARACTER_ARCS } from "./sample-character-arcs-deepsea-nine.js";
import type { SampleYouTubeVideo } from "./sample-youtube.js";

export interface SampleCharacterEpisode {
  subject: string;
  /** A character may use several platforms without becoming separate identities. */
  platform?: SampleCharacterArc["platform"];
  /** Visual Stories are distinct from long-form articles; absent preserves legacy defaults. */
  contentType?: "post" | "story" | "article" | "video";
  /** Independently reviewed footage and actual creator, separate from fictional narration. */
  video?: SampleYouTubeVideo;
  /** Null marks legacy draft prose awaiting image-led replacement, never final admission. */
  mediaSha1: string | null;
  theme: "transformation" | "feeding" | "weather" | "danger" | "wonder" | "social" | "courtship" | "family" | "movement" | "cosmic";
  title: string;
  body: string;
}

export interface SampleCharacterArc {
  characterId: string;
  identityNameBase: string;
  bio: string;
  platform: "facebook" | "instagram" | "linkedin" | "rss" | "x" | "youtube" | "medium" | "substack";
  /** Approximate fictional home, kept separate from photograph provenance. */
  location?: { name: string; coordinates: { lat: number; lng: number } };
  episodes: readonly SampleCharacterEpisode[];
}

export const SAMPLE_CHARACTER_ARCS: readonly SampleCharacterArc[] = [
  {
    characterId: "manny-tis",
    location: { name: "Mediterranean scrub near Hyères", coordinates: { lat: 43.12, lng: 6.15 } },
    identityNameBase: "Manny Tis",
    platform: "instagram",
    bio: "A praying mantis with excellent posture, a complicated relationship with birds, and several recent reasons to distrust the sky.",
    episodes: [
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "transformation",
        title: "New skin, same nerve",
        body: "I crawled out of my old skin and hung beside it, waiting to harden. A fly landed on the empty face. I had to watch my previous body get away with having breakfast on it.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "feeding",
        title: "Violence, and better lighting.",
        body: "Caught a bee where the light was good. Then a bird landed above me. I carried breakfast under a leaf and ate in the dark, where I am considerably less impressive and still alive.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "weather",
        title: "Rain has hands",
        body: "One drop struck the leaf hard enough to move my entire morning. I caught the second drop with both forelegs. It went everywhere. I was still holding the shape of it when the third one hit.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "danger",
        title: "The sky grew talons",
        body: "The leaf went dark. A bird's beak closed where my head had been, and I fell through three branches. Somewhere below the second branch I left my body. Every fly I had ever eaten was waiting. Then I hit a twig, came back, and blamed the bird.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "danger",
        title: "Inventory after death",
        body: "I came to hanging by one hind leg. Antennae: two. Forelegs: both. Bird: furious. I climbed until the screaming moved elsewhere.",
      },
      {
        subject: "praying mantis",
        mediaSha1: "d67cc98af34b60d6e8b2e7aa586aa9e05de4d3fd",
        theme: "social",
        title: "Quite different",
        body: "She called me a walking stick. I took three very deliberate steps. That settled absolutely nothing.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "courtship",
        title: "Tomorrow, definitely",
        body: "She turned toward me and I forgot the beautiful approach I had rehearsed. Took one step forward. Took it back. She caught a fly without looking away. I have decided to approach tomorrow.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "danger",
        title: "Dawn, reconsidered",
        body: "The bird returned at sunrise. I flattened beneath a leaf while it tore apart a grasshopper above me. One leg bounced past. I caught it before I remembered I was hiding.",
      },
      {
        subject: "praying mantis",
        mediaSha1: null,
        theme: "wonder",
        title: "The ant took the long way",
        body: "An ant climbed my leg carrying a crumb. I lifted the leg. It waited until I lowered it again. I have eaten things a hundred times its size and somehow I am the one holding the door.",
      },
    ],
  },
  {
    characterId: "frogbert-angler",
    identityNameBase: "Frogbert Angler",
    platform: "x",
    location: { name: "Lembeh Strait seabed", coordinates: { lat: 1.46, lng: 125.235 } },
    bio: "A frogfish who walks instead of swimming, fishes with its forehead, and regards subtlety as a rumor spread by faster animals.",
    episodes: [
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "feeding",
        title: "Furniture with intentions",
        body: "I spent the morning impersonating a sponge. A shrimp complimented the upholstery and vanished halfway through the sentence.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: "3c0d019158c7d78248e12b1151b0a462cea627b3",
        theme: "feeding",
        title: "Do the little dance",
        body: "Waggled my lure at a shrimp. Nothing. Waggled harder. It went around me and ate a real worm. I kept waggling for a moment after it left.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "movement",
        title: "Overtaken by debris",
        body: "Walked uphill against the current. A loose bit of sponge passed me, caught on a rock, came free, and passed me again. I bit it the second time.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "social",
        title: "Camouflage breach",
        body: "A cleaner wrasse picked something off my cheek. I stayed perfectly still. It came back for another bit. Somewhere behind it, a shrimp was watching my camouflage get eaten.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: "4fac2f792ffba0fc2240e5e6cb792decd3596f65",
        theme: "courtship",
        title: "Crush beside the sponge",
        body: "Someone lumpy settled three corals away and pretended not to notice me. I changed color twice, casually, over forty minutes.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: "215028f2956ac61b9567ca0ac7d45450cf451bae",
        theme: "feeding",
        title: "A mouthful of consequences",
        body: "I lunged at a fish larger than prudence. For one bright second we were both certain this was the other's mistake.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "danger",
        title: "Crossing open sand",
        body: "There was no coral for six body lengths. I walked the whole distance dressed as nothing. The grouper noticed at five.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "social",
        title: "Back to being furniture",
        body: "The grouper passed. A shrimp settled on my head and began picking at me. I could have eaten it if it had been anywhere else on the entire reef.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "feeding",
        title: "Hunting without the trick",
        body: "My lure snapped. I walked toward a fish with my mouth open. It moved one fin-length away. I walked again. It moved again. We are both still here.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: "708922c5bacfa31a2ed33f2b068c1837fe027b8b",
        theme: "feeding",
        title: "grey.",
        body: "the wrasse was right there and i went for it the wrong way and now i have a square of the bottom in my cheek. grey. grainy. i keep pushing it around. it is the least dignified thing i have ever swallowed, and i have swallowed a lot.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "social",
        title: "Not that side",
        body: "The wrasse came back. Looked at my mouth. Looked at the small hole I had made in the sand. I turned slowly away, which gave it plenty of time to understand everything.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "feeding",
        title: "Sideways worked",
        body: "The gap was tight. I turned sideways and eased my face in. A shrimp shot straight into my mouth. I stayed in that position for another twenty minutes, just in case.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "weather",
        title: "The gap is gone",
        body: "Woke under a different arrangement of rubble. The current had moved my breakfast gap half a body length uphill. I can see through it. I cannot get my face there.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "movement",
        title: "The last foot",
        body: "Got three fins onto the new rock. The fourth was still on the old rock. I spent a while like that, getting hungrier at both addresses.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "wonder",
        title: "Something inside",
        body: "The sponge beside me eats things too small for me to see. I tried a mouthful of its water. No taste. Tried a larger mouthful. It carried on eating without once opening a face.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "danger",
        title: "All the small fish left",
        body: "Every little fish disappeared into a hole. I tried to follow one. My face fitted. The rest of me was still outside when the shadow passed. I spent the whole time hoping it was a face-eating thing.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "social",
        title: "You can come out now",
        body: "Pulled my face out of the hole. The wrasse inside waited for me to move farther away. I had been protecting it with my entire mouth.",
      },
      {
        subject: "frogfish underwater",
        mediaSha1: null,
        theme: "wonder",
        title: "Too far away to eat",
        body: "Silver fish crossed overhead until the light flickered on my feet. I opened my mouth once, out of habit. Then I watched the rest go by.",
      },
    ],
  },
  {
    characterId: "nudi-branch-manager",
    location: { name: "Anilao reef", coordinates: { lat: 13.76, lng: 120.9 } },
    identityNameBase: "Nudi Branch Manager",
    platform: "facebook",
    bio: "An Anilao nudibranch carrying borrowed chemical defenses, green stripes, and no patience for creatures impressed by shells.",
    episodes: [
      {
        subject: "nudibranch underwater",
        mediaSha1: null,
        theme: "social",
        title: "Already dressed",
        body: "A hermit crab dragged a shell toward me and waited. I crawled over it. He turned it around and tried showing me the opening.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: "78cee6949fb8cd5308c53c9725de02cea1c64a62",
        theme: "feeding",
        title: "Breakfast is fastened down",
        body: "Finished the blue clump and raised my head to leave. There was another blue clump underneath. I have been leaving for quite a while.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: null,
        theme: "danger",
        title: "The fish came closer",
        body: "The fish circled me twice. I turned my brightest side toward it. It came closer for a better look. I am beginning to see a flaw in being spectacular.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: "3dbe7e0c03e5de95816b0cec07171d1915c27199",
        theme: "movement",
        title: "All of me must turn",
        body: "I took the corner headfirst. My gills are still on the old side of the rock. We are both insisting this is forward.",
      },
      {
        subject: "nudibranch mating",
        mediaSha1: "129c619a92dfef320bf5e9fb98b05742b3e36a7b",
        theme: "courtship",
        title: "We both brought everything",
        body: "We both arrived with eggs and sperm. Neither of us arrived facing the useful direction. We spent the beginning of the encounter reversing past each other.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: null,
        theme: "danger",
        title: "Stolen fire",
        body: "The fish put me in its mouth and spat me straight back out. I landed facing the other way. After all that, I still had to turn around to see its expression.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: "d47c50dd9dc91166939340307b3560a3ea9d032e",
        theme: "social",
        title: "Separate mouths",
        body: "We agreed to eat from different sides. Every mouthful brought us closer. I am trying to leave them a polite amount of dinner without having to stop eating mine.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: null,
        theme: "danger",
        title: "Already chewed",
        body: "A shadow passed. I flattened against the rock and tried to look unpleasant to swallow. Then I remembered the fish had already spat me out. I stayed flat, but less anxiously.",
      },
      {
        subject: "nudibranch underwater",
        mediaSha1: "628d8aba303ab7799dd78292023cdddb8194baf7",
        theme: "movement",
        title: "One foot, several problems",
        body: "I left my tail on one side of the lump and stretched my face toward the other. For a creature with one foot, I have made this unnecessarily complicated.",
      },
    ],
  },
  {
    characterId: "cygnus-shy",
    location: { name: "River Thames backwater", coordinates: { lat: 51.48, lng: -0.61 } },
    identityNameBase: "Cygnus Shy",
    platform: "instagram",
    bio: "A mute swan who hisses first and checks what it was afterward. Nine cygnets, very little sleep.",
    episodes: [
      {
        subject: "swan",
        mediaSha1: "a28cb915c46d2dcb4966227b7b34b475cc5cdfdc",
        theme: "social",
        title: "Threatening my own armpit",
        body: "A goose woke me. I hissed before taking my head out from under my wing. Nobody heard except me, and I frightened myself awake.",
      },
      {
        subject: "swan",
        mediaSha1: "cd185b8e433a0179c4ffea8bd75db0ecd252c90c",
        theme: "movement",
        title: "Too late to stay",
        body: "Halfway through my takeoff I remembered I had nowhere to go. By then my feet were going so fast I had to leave.",
      },
      {
        subject: "swan",
        mediaSha1: "ce1ef641230b414aeb30ce82ce63b418334d53a9",
        theme: "courtship",
        title: "A mouthful of romance",
        body: "He lowered his head. I lowered mine. We touched faces and stayed there until I swallowed the weed I had been hiding in my mouth.",
      },
      {
        subject: "swan",
        mediaSha1: null,
        theme: "danger",
        title: "Possibly a stick",
        body: "Something long and brown drifted toward me. I bit it. It tasted of stick. I bit it again in case it was pretending.",
      },
      {
        subject: "swan",
        mediaSha1: null,
        theme: "feeding",
        title: "Get off",
        body: "Tipped up for pondweed. Came back to the surface with a duck standing on me. It had both feet settled. This had been a decision.",
      },
      {
        subject: "swan",
        mediaSha1: null,
        theme: "family",
        title: "The missing one",
        body: "Counted eight cygnets. Heard the ninth behind me. Turned around. Still behind me. I swam two circles before a small head came out from under my wing to complain about the ride.",
      },
      {
        subject: "swan",
        mediaSha1: "a2a57edb7708d629231c15bc1ff5fa6af728f513",
        theme: "transformation",
        title: "Still attached",
        body: "I gave a loose feather a firm tug. It was not loose. The duck fled at the noise, so I let it believe that had been the purpose.",
      },
    ],
  },
  {
    characterId: "flora-mingo",
    location: { name: "Camargue salt lagoon", coordinates: { lat: 43.43, lng: 4.64 } },
    identityNameBase: "Flora Mingo",
    platform: "linkedin",
    bio: "A flamingo made pink by shrimp, at home in salt water, mud, long flights, and very large crowds.",
    episodes: [
      {
        subject: "flamingo",
        mediaSha1: null,
        theme: "transformation",
        title: "Before the pink",
        body: "I began gray. The pink arrived one mouthful at a time. Adults kept checking as if I were late.",
      },
      {
        subject: "flamingo",
        mediaSha1: null,
        theme: "courtship",
        title: "One bird in thousands",
        body: "I found them in the pink confusion because their head turn was half a beat late.",
      },
      {
        subject: "flamingo",
        mediaSha1: "d7db5d3f032ac43eb40c19d527e79ea12e4a6ac8",
        theme: "feeding",
        title: "Upside-down supper",
        body: "I was explaining how I achieved this pink when a shrimp went past. Put my head between my ankles to get it. Continued the explanation from there.",
      },
      {
        subject: "flamingo",
        mediaSha1: null,
        theme: "weather",
        title: "Night on one leg",
        body: "Woke to a thousand neighbors facing the wrong direction. Turned around to correct the example I was setting. Everyone turned with me. We are back where we started.",
      },
    ],
  },
  {
    characterId: "nova-remains",
    identityNameBase: "Nova Remains",
    platform: "rss",
    bio: "A supernova remnant processing one spectacular death across millennia while its scattered elements begin entirely different lives.",
    episodes: [
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "The long before",
        body: "I spent millions of years making heavier elements. The iron stayed in my center, where no eye could reach it. You will see that part of me later. I will have to come apart first.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "Gravity wins inward",
        body: "My core collapsed in less time than this sentence. Every layer above it discovered the terrible efficiency of falling.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "Then, everything outward",
        body: "I exploded once. The light crossed galaxies before I finished understanding what had happened.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "What was in the dark",
        body: "I reached gas that had been cold and dark long before I exploded. It began to glow where I struck it. From far away, that bright edge is my shape. Much of what you see was never inside me.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: "c447255ad8fe6aab3c24c59dde232234cce6c490",
        theme: "cosmic",
        title: "Iron leaves home",
        body: "I scattered iron into space. Somewhere ahead, a world will put it in blood and call the pulse its own.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "No longer singular",
        body: "Part of me is still racing outward. Part has cooled into grains small enough to settle on your skin. Try drawing a line around what I am now.",
      },
      {
        subject: "supernova remnant NASA",
        mediaSha1: null,
        theme: "cosmic",
        title: "Dust crosses the front",
        body: "A grain of dust entered my shock wave cold and left stripped to atoms. It had been intact longer than your planet.",
      },
    ],
  },
  {
    characterId: "alma-eight",
    identityNameBase: "Alma Eight",
    platform: "rss",
    bio: "A common octopus keeping notes on a den, its troublesome entrance, and the things her arms bring home.",
    location: { name: "Rocky seabed off Mouro", coordinates: { lat: 43.473, lng: -3.753 } },
    episodes: [
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "movement",
        title: "The room behind the stone",
        body: "I found the entrance with an arm. Sand, a lip of rock, then space. I put another arm in. Those two began exploring while I was still outside deciding whether to live there.\n\nGetting my head through required a fold I had not tried before. For a moment one eye was outside and nearly everything else was inside. I had an excellent view of the thing I was stuck in.\n\nWhen I finally squeezed through, an arm brought me a smooth shell from under the lip. Empty, I thought. I settled into the back with it. Two arms were still outside. I pulled them in and discovered they had brought a stone. Apparently we were moving in whether I liked it or not.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "feeding",
        title: "It had hold of me too",
        body: "The crab was behind a stone with its back legs showing. I reached over it, reached under it, and got pinched in a place I had only just put there.\n\nI pulled. It held on. Another arm found its way around the stone and caught the crab from behind. That made it release the first arm and pinch the new one. We went through quite a few arms.\n\nAt last I lifted the stone enough to get underneath. I carried the crab home with it still holding on. At the entrance I had to turn us both sideways. The claw scraped the roof. I stopped to protect the roof. Even now I cannot explain why that was more important than the bit of me in the claw.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "social",
        title: "Not empty",
        body: "The smooth shell moved during the night. I returned it to its corner. Later it moved farther. I put a stone beside it so it would stop rolling.\n\nA hermit crab came out, climbed over the stone, and started dragging the shell toward the entrance. I had been moving him around my room for two days. He had waited until I was asleep to leave, and I had caught him twice.\n\nI moved the stone. He went out very slowly. I wanted to help him over the lip, but I could not think of a way to touch him that would not look like the beginning of a third day.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "danger",
        title: "I kept the stone",
        body: "I wanted a stone for the entrance. This one was flat on one side and heavy enough that the current would have to mean it. I dragged it home in little lifts.\n\nHalfway across the sand, a fish turned toward me. I stopped. My skin roughened. I became a lump beside another lump, except that I was still holding the second lump with far too much enthusiasm.\n\nThe fish came closer. I could have dropped the stone. I knew exactly how to drop a stone. Instead I lowered myself around it until sand pressed against my eye.\n\nThe fish passed. I waited until I could no longer see its tail, then dragged the stone the remaining distance. It did not fit the entrance. I sat behind it anyway.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "weather",
        title: "The water came backward",
        body: "The water shoved into the den hard enough to roll my flat stone against the roof. I held the back wall and reached out to catch it. The next surge took the stone and nearly took the arm.\n\nI let go of the stone. It came back by itself and hit the entrance. I grabbed it again. The water pulled the other way. We repeated this until I understood that owning the stone was now a full-time activity.\n\nAt dawn it was gone. The den was full of weed. I found a crab tangled in the weed and ate it without getting out of bed. I am reluctant to say anything nice about the storm, but it did bring breakfast.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "wonder",
        title: "Premature condolences",
        body: "I found his shell under the weed. The smooth edge, the chipped lip. I turned it over and waited for the small legs. Empty.\n\nI sat with it for a while. Remembered carrying him against my face. Remembered blocking his escape with a stone. I had not been an easy person to live with.\n\nI was arranging a few pebbles around the shell when he walked past in a larger one. Stopped. Picked something off one of the pebbles. Went on.\n\nI took the pebbles home. It seemed wasteful to have been that sad for nothing.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "movement",
        title: "A way out",
        body: "Cold water was coming through a crack beside my den. I put two arms through from outside and found the place where I sleep. I had been dragging everything through the narrow entrance when there was a second one beside it.\n\nI moved the loose stones. Twice I pulled rubble onto my own head. By afternoon I could squeeze through. I went out the old entrance and in the new one to be certain.\n\nOn the third circuit I found a shrimp and ate it. Went around again. No shrimp. Again, a little slower. Still none. I built an escape route and spent the evening checking whether it made shrimp.",
      },
      {
        subject: "octopus underwater",
        mediaSha1: null,
        theme: "wonder",
        title: "Nothing to carry",
        body: "Went over the ridge with every intention of leaving things where they were. Found a lovely shell. A foot withdrew inside it. I put it back.\n\nFarther down, a smooth stone fitted beautifully into the curl of an arm. I held it, turned it, put it down. Kept moving. I went all the way home without a shell, a stone, or anyone else's house.\n\nAt the entrance an arm uncurled and produced a second stone. I do not know when it picked that up. I moved aside to let it bring the stone in.",
      },
    ],
  },
  {
    characterId: "mora-grey",
    identityNameBase: "Mora Grey",
    platform: "facebook",
    bio: "A greyface moray who knows the reef by its narrow places. Usually at home, though more of her is home than you can see.",
    location: { name: "Anilao reef slope", coordinates: { lat: 13.758, lng: 120.909 } },
    episodes: [
      {
        subject: "moray eel underwater",
        mediaSha1: "591383436276e3a2ce2539a8d71b2ed7bab14c6d",
        theme: "social",
        title: "I was breathing",
        body: "A little fish froze every time I opened my mouth. Swam when I closed it. Froze when I opened it. We made very slow progress through the morning.",
      },
      {
        subject: "moray eel underwater",
        mediaSha1: null,
        theme: "weather",
        title: "Grit at the back",
        body: "Sand came into my hole from somewhere behind me. I moved forward. More sand. I moved forward again. Eventually I was all outside, which was a great deal more outside than I had intended.",
      },
      {
        subject: "moray eel underwater",
        mediaSha1: null,
        theme: "movement",
        title: "Lovely from the front",
        body: "New hole. Good shade, clean water, room to turn my head. Unfortunately the back half of me was in somebody else's hole. I found this out from the back half.",
      },
      {
        subject: "moray eel underwater",
        mediaSha1: null,
        theme: "feeding",
        title: "The smell went left",
        body: "I followed supper through two cracks and under a ledge. Lost it. Found it again. By the time I caught the fish, my tail was still coming around the first corner.",
      },
      {
        subject: "moray eel underwater",
        mediaSha1: null,
        theme: "wonder",
        title: "Room for the rest of me",
        body: "My old hole cleared. I went in, came out, and went in again. A fish paused outside. I opened my mouth and it fled. At the new hole everyone had ignored me. It is good to be home.",
      },
      {"platform": "facebook", "contentType": "post", "theme": "social", "title": "Still listening", "body": "I went round the corner before he had finished talking. He followed my tail. I stopped so he could finish. Neither of us has mentioned which end he is addressing.", "subject": "moray eel underwater", "mediaSha1": "07937bdc8f0afca1203c479dab4e63e15d21922f"},
      {"platform": "facebook", "contentType": "post", "theme": "social", "title": "A better angle", "body": "The wrasse said he wanted to show me something. Then he stopped broadside in front of my face. I waited. He turned a little in the light. I said yes, very nice, and he turned the other way.", "subject": "moray eel underwater", "mediaSha1": "f153543d44150bd03fb04a49c9419ad6d02737c2"},
    ],
  },
  {
    characterId: "colm-still",
    location: { name: "Meany Crest basalt columns, Mount Rainier", coordinates: { lat: 46.86, lng: -121.65 } },
    identityNameBase: "Colm Still",
    platform: "x",
    bio: "Columnar volcanic rock. Remembers being too hot for anything to touch. Has since become rather crowded.",
    episodes: [
      {
        subject: "basalt columns geology",
        mediaSha1: "e79a752849690cedabe3da27bb875d7e8072fe36",
        theme: "transformation",
        title: "When we cooled",
        body: "We were touching everywhere. Then we cooled and pulled apart along the cracks. I have stood beside the same piece of rock ever since, with rain between us.",
      },
      {
        subject: "basalt columns geology",
        mediaSha1: "4bfa89fc6b9b8721976b3cfdb59ce7b0b9493d06",
        theme: "weather",
        title: "A small departure",
        body: "Water froze in a crack and broke a piece off me. It bounced all the way down the slope. I spent an age becoming a column, and the first piece to go anywhere did it lying down.",
      },
      {
        subject: "basalt columns geology",
        mediaSha1: null,
        theme: "wonder",
        title: "Something with feet",
        body: "A beetle stopped in the gap where I broke. Cleaned one antenna. Cleaned the other. For a while I thought it was settling in. By the time I had got used to having it, it had gone and done the rest of its life.",
      },
    ],
  },
  ...AIR_CHARACTER_ARCS,
  ...LAND_CHARACTER_ARCS,
  ...OCEAN_CHARACTER_ARCS,
  ...STRANGE_CHARACTER_ARCS,
  ...NEW_OCEAN_CHARACTER_ARCS,
  ...STRANGE_NEXT_CHARACTER_ARCS,
  ...STRANGE_FOUNDATIONS_CHARACTER_ARCS,
  ...DEEPSEA_NEXT_CHARACTER_ARCS,
  ...DEEPSEA_BONDS_CHARACTER_ARCS,
  ...STRANGE_WILD_CHARACTER_ARCS,
  ...STRANGE_EIGHT_CHARACTER_ARCS,
  ...DEEPSEA_NINE_CHARACTER_ARCS,
  ...YOUTUBE_TEN_CHARACTER_ARCS,
  ...LAND_TWELVE_CHARACTER_ARCS,
  ...OCEAN_TWENTY_ONE_CHARACTER_ARCS,
  ...LAND_TWENTY_CHARACTER_ARCS,
  ...BOTANICAL_TWENTY_FOUR_CHARACTER_ARCS,
  ...BIRD_TWENTY_FIVE_CHARACTER_ARCS,
  ...AQUATIC_TWENTY_SIX_CHARACTER_ARCS,
  ...BOTANICAL_TWENTY_SEVEN_CHARACTER_ARCS,
  ...BOTANICAL_THIRTY_TWO_CHARACTER_ARCS,
  ...BOTANICAL_FORTY_CHARACTER_ARCS,
  ...AQUATIC_FORTY_ONE_CHARACTER_ARCS,
  ...EDITORIAL_FORTY_TWO_THREE_CHARACTER_ARCS,
  ...AQUATIC_FORTY_FOUR_CHARACTER_ARCS,
  ...LAND_FORTY_FIVE_CHARACTER_ARCS,
  ...BOTANICAL_FORTY_SIX_CHARACTER_ARCS,
  ...LAND_FORTY_NINE_CHARACTER_ARCS,
  ...BOTANICAL_FIFTY_CHARACTER_ARCS,
] as const;
