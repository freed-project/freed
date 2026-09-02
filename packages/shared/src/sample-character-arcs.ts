export interface SampleCharacterEpisode {
  subject: string;
  title: string;
  body: string;
}

export interface SampleCharacterArc {
  characterId: string;
  identityNameBase: string;
  bio: string;
  platform: "facebook" | "instagram" | "linkedin" | "rss" | "x";
  episodes: readonly SampleCharacterEpisode[];
}

export const SAMPLE_CHARACTER_ARCS: readonly SampleCharacterArc[] = [
  {
    characterId: "manny-tis",
    identityNameBase: "Manny Tis",
    platform: "instagram",
    bio: "A praying mantis with excellent posture, a complicated relationship with birds, and revelations scheduled for unreasonable hours.",
    episodes: [
      {
        subject: "praying mantis",
        title: "New skin, same nerve",
        body: "I stepped out of my old skin before dawn. For twelve minutes I was soft, pale, and forced to trust the universe. Ghastly management style. Excellent wings.",
      },
      {
        subject: "praying mantis",
        title: "Violence, and better lighting.",
        body: "A bee mistook stillness for indecision. We resolved the ambiguity over breakfast.",
      },
      {
        subject: "praying mantis",
        title: "Rain has hands",
        body: "One drop struck the leaf hard enough to move my entire morning. I attacked the second drop. This improved nothing, but honor survived.",
      },
      {
        subject: "praying mantis",
        title: "The sky grew talons",
        body: "The leaf went dark. A bird's beak closed where my head had been, and I fell through three branches into a philosophy I had not requested.",
      },
      {
        subject: "praying mantis",
        title: "Temporary theology",
        body: "I saw God during the fall. She was green, enormous, and mostly concerned with whether I could still climb.",
      },
      {
        subject: "praying mantis",
        title: "Three a.m. doctrine",
        body: "At 3:07 I understood patience: hunger wearing ceremonial robes. I was so excited I told a moth. The moth has not responded.",
      },
      {
        subject: "praying mantis",
        title: "Honest relationship terms",
        body: "She is magnificent. She may also eat me. At last, romance without hidden fees.",
      },
      {
        subject: "praying mantis",
        title: "Dawn, reconsidered",
        body: "The bird returned at sunrise. I did not see God this time. I saw the underside of a leaf and found it entirely sufficient.",
      },
    ],
  },
  {
    characterId: "frogbert-angler",
    identityNameBase: "Frogbert Angler",
    platform: "x",
    bio: "A frogfish who walks instead of swimming, fishes with its forehead, and regards subtlety as a rumor spread by faster animals.",
    episodes: [
      {
        subject: "frogfish underwater",
        title: "Furniture with intentions",
        body: "I spent the morning impersonating a sponge. A shrimp complimented the upholstery and vanished halfway through the sentence.",
      },
      {
        subject: "frogfish underwater",
        title: "The forehead economy",
        body: "My lure performed one small dance. Lunch crossed the reef voluntarily. I remain astonished by marketing.",
      },
      {
        subject: "frogfish underwater",
        title: "Walking fish weather",
        body: "The current was rude, so I walked home on my fins. Swimming past me, everyone looked busy and arrived at the same coral.",
      },
      {
        subject: "frogfish underwater",
        title: "Camouflage breach",
        body: "A cleaner wrasse recognized me beneath the algae. We stared at each other until professional courtesy became blackmail.",
      },
      {
        subject: "frogfish underwater",
        title: "Crush beside the sponge",
        body: "Someone lumpy settled three corals away and pretended not to notice me. I changed color twice, casually, over forty minutes.",
      },
      {
        subject: "frogfish underwater",
        title: "A respectful distance",
        body: "Courtship went beautifully once we agreed that affection and being swallowable should never occupy the same radius.",
      },
      {
        subject: "frogfish underwater",
        title: "Upward, briefly",
        body: "We left the bottom together at dusk and released the future into open water. Then we returned to separate sponges like adults.",
      },
      {
        subject: "frogfish underwater",
        title: "Questionable little miracles",
        body: "Our young arrived transparent and drifting, not lumpy at all. Give them time. Dignity is an acquired texture.",
      },
    ],
  },
  {
    characterId: "nudi-branch-manager",
    identityNameBase: "Nudi Branch Manager",
    platform: "facebook",
    bio: "A shell-free nudibranch carrying stolen stinging cells, impossible colors, and a relationship structure the reef refuses to diagram correctly.",
    episodes: [
      {
        subject: "nudibranch underwater",
        title: "No shell, better posture",
        body: "Everyone asks where my shell went. I ask why they still carry architecture when confidence weighs nothing.",
      },
      {
        subject: "nudibranch underwater",
        title: "Borrowed weapons department",
        body: "I ate a hydroid and kept its stinging cells for later. The distinction between lunch and armory is mostly paperwork.",
      },
      {
        subject: "nudibranch underwater",
        title: "Color as warning",
        body: "These colors do not mean come closer. They mean I survived the last creature who misunderstood the colors.",
      },
      {
        subject: "nudibranch mating",
        title: "Mutual introductions",
        body: "We met head to tail, each of us both sexes, each pretending this arrangement required no rehearsal.",
      },
      {
        subject: "nudibranch mating",
        title: "The diagram resigns",
        body: "The reef tried to label our relationship. By sunset the chart had six arrows, no center, and a small apology.",
      },
      {
        subject: "nudibranch mating",
        title: "Everybody brings something",
        body: "We both arrived capable of giving and receiving. Fluid modernity has been seafloor policy for a very long time.",
      },
      {
        subject: "nudibranch mating",
        title: "Ribbon of futures",
        body: "I laid the eggs in a white spiral and left the current to read them. Parenthood, but with calligraphy.",
      },
      {
        subject: "nudibranch mating",
        title: "After the current",
        body: "By morning my lover had vanished behind the reef. Nobody was abandoned. We had simply completed the sentence.",
      },
    ],
  },
  {
    characterId: "cygnus-shy",
    identityNameBase: "Cygnus Shy",
    platform: "instagram",
    bio: "A swan whose neck knows exactly what it is doing while the rest of the bird remains catastrophically shy.",
    episodes: [
      {
        subject: "swan courtship",
        title: "Practicing alone",
        body: "I rehearsed the neck movement in empty water. A duck saw everything and has become unbearable.",
      },
      {
        subject: "swan courtship",
        title: "Across the pond",
        body: "They appeared through the reeds and I forgot how floating works. Fortunately, panic resembles grace at a distance.",
      },
      {
        subject: "swan courtship",
        title: "An accidental heart",
        body: "Our necks met in perfect symmetry. We both pretended the heart shape was a coincidence arranged by water.",
      },
      {
        subject: "swan courtship",
        title: "Elegance gets territorial",
        body: "A stranger approached the nest. I became six feet of white feathers and ancient profanity.",
      },
      {
        subject: "swan courtship",
        title: "Building the middle",
        body: "We carried reeds to the same quiet patch until a home appeared between our separate ideas.",
      },
      {
        subject: "swan courtship",
        title: "Small gray weather",
        body: "The cygnets climbed onto my back and slept beneath my wings. I have never been so tired or so accurately occupied.",
      },
      {
        subject: "swan courtship",
        title: "Still choosing this",
        body: "We crossed the pond together again today. Less choreography now. More mud, memory, and the same shoulder beside mine.",
      },
    ],
  },
  {
    characterId: "flora-mingo",
    identityNameBase: "Flora Mingo",
    platform: "linkedin",
    bio: "A flamingo shaped by salt, shrimp, group choreography, and the sincere belief that every complicated relationship needs a better dance.",
    episodes: [
      {
        subject: "flamingo courtship",
        title: "Before the pink",
        body: "I began gray. The color arrived meal by meal, as if the body could blush slowly enough to call it adulthood.",
      },
      {
        subject: "flamingo courtship",
        title: "Everyone turn left",
        body: "A thousand of us began the courtship march at once. Nobody led. Everyone corrected everyone.",
      },
      {
        subject: "flamingo courtship",
        title: "One bird in thousands",
        body: "I found them in the pink confusion because their head turn was half a beat late. Perfection is useless for falling in love.",
      },
      {
        subject: "flamingo courtship",
        title: "Relationship topology",
        body: "The flock asked whether we were exclusive. We asked which two birds they meant. The meeting dissolved into dancing.",
      },
      {
        subject: "flamingo courtship",
        title: "Mud architecture phase",
        body: "We built a nest from mud with our beaks. It looked improbable, then held an egg. This is also my review of commitment.",
      },
      {
        subject: "flamingo courtship",
        title: "Gray joins pink",
        body: "Our chick arrived soft, gray, and furious about gravity. The flock made room without interrupting the dance.",
      },
      {
        subject: "flamingo courtship",
        title: "Upside-down supper",
        body: "I filter lunch with my head inverted. Romance survives many things. It can survive this angle.",
      },
      {
        subject: "flamingo courtship",
        title: "Salt at dusk",
        body: "We stood on one leg while the lake turned gold. Nobody performed. That may be why it was beautiful.",
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
        title: "The long before",
        body: "I spent millions of years making heavier elements in the dark. Nobody applauded. Stars learn patience before drama.",
      },
      {
        subject: "supernova remnant NASA",
        title: "Gravity wins inward",
        body: "My core collapsed in less time than this sentence. Every layer above it discovered the terrible efficiency of falling.",
      },
      {
        subject: "supernova remnant NASA",
        title: "Then, everything outward",
        body: "I exploded once. The light crossed galaxies before I finished understanding what had happened.",
      },
      {
        subject: "supernova remnant NASA",
        title: "Aftermath learns color",
        body: "My shock wave keeps teaching old gas new colors. Ruin is only one name for material in motion.",
      },
      {
        subject: "supernova remnant NASA",
        title: "Iron leaves home",
        body: "I scattered iron into space. Somewhere ahead, a world will put it in blood and call the pulse its own.",
      },
      {
        subject: "supernova remnant NASA",
        title: "No longer singular",
        body: "I used to be one star. Now I am dust, light, pressure, memory, and several futures refusing to share a border.",
      },
    ],
  },
] as const;
