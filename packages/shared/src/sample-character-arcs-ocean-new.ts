import type { SampleCharacterArc } from "./sample-character-arcs.js";

/** Four admitted image-led entries from docs/drafts/ocean-narratives-05.json.
 * Mina is the pictured squat lobster, not her feather-star host. Her episode
 * subject retains the catalog grouping required by the media resolver.
 * Dialogue and relationships are fiction, not observed animal conversations.
 */
export const NEW_OCEAN_CHARACTER_ARCS: readonly SampleCharacterArc[] = [
  {
    "characterId": "mina-tangle",
    "identityNameBase": "Mina Tangle",
    "platform": "instagram",
    "bio": "A crinoid squat lobster, Allogalathea elegans. Happily attached. Ask fewer questions.",
    "location": {
      "name": "Anilao reef, Philippines",
      "coordinates": {
        "lat": 13.76,
        "lng": 120.93
      }
    },
    "episodes": [
      {
        "subject": "feather star underwater",
        "platform": "instagram",
        "mediaSha1": "6a7f48a0dc62505cae9b8074fbebada1322a3aa5",
        "theme": "feeding",
        "title": "Our lunch",
        "body": "She caught it. I ate it. She curled the arm away. I said I thought we shared everything. She has since become very specific about what everything means."
      },
      {
        "subject": "feather star underwater",
        "platform": "x",
        "mediaSha1": "b1df4fa47ce47bb07926f27c65347de5cc8d88c6",
        "theme": "courtship",
        "title": "Attached",
        "body": "He asked if I came here often. I said I lived on her. He went very quiet. I had meant the feather star. I let him remain impressed."
      },
      {
        "subject": "feather star underwater",
        "platform": "instagram",
        "contentType": "story",
        "theme": "movement",
        "title": "A little less still",
        "body": "I asked her to stop moving.\n\nShe curled the arm under me. I caught the next one, then stretched across another. By the time she stopped, I had feet on both sides and no comfortable way to bring them together.\n\nAsked her to move a little.\n\nShe asked which way.",
        "mediaSha1": "f29c75d10e98aa43758b3396e03cbae88c9a64ba"
      }
    ]
  },
  {
    "characterId": "ada-spine",
    "identityNameBase": "Ada Spine",
    "platform": "facebook",
    "bio": "A spiny starfish, Marthasterias glacialis. I understood you the first time.",
    "location": {
      "name": "Arrábida rocky coast, Portugal",
      "coordinates": {
        "lat": 38.43,
        "lng": -9
      }
    },
    "episodes": [
      {
        "subject": "starfish underwater",
        "platform": "facebook",
        "mediaSha1": "415234706fa3c535ec8b8dedcd0d750e7e6782cb",
        "theme": "courtship",
        "title": "A type",
        "body": "He said he wasn't good at being vulnerable. Every inch of him was a spike. I said I'd gathered."
      },
      {
        "subject": "starfish underwater",
        "platform": "facebook",
        "contentType": "story",
        "mediaSha1": "fec3f03a08b7c4e45240eeed98d0cfcb6629be1b",
        "theme": "movement",
        "title": "Worse after washing",
        "body": "I pushed through the weed to rub something off my back. Came out with a sprig caught on an arm. Reached around for it with another arm.\n\nTwo sprigs now.\n\nI have three arms left and am beginning to understand why everyone else just stays dirty."
      },
      {
        "platform": "facebook",
        "contentType": "story",
        "theme": "social",
        "title": "A small hello",
        "body": "An anemone brushed my arm. I touched it back, very carefully. Then the others reached across me. I had meant hello, not come over.",
        "subject": "starfish underwater",
        "mediaSha1": "e424873ed88757f40bea550f9c8d8c92fb893193"
      },
      {
        "subject": "spiny starfish",
        "platform": "instagram",
        "contentType": "story",
        "theme": "social",
        "title": "I still meant it",
        "body": "He touched my back and pulled away. I had forgotten the little pincers around my spines.\n\nI said I hadn't meant it.\n\nHe asked whether I still wanted him close.\n\nI said yes.\n\nHe is waiting for the rest of me to agree.",
        "mediaSha1": "04291adc10ca9f9b80b1779bf55c0a7cda454a63"
      }
    ]
  },
  {
    "characterId": "orin-clear",
    "identityNameBase": "Orin Clear",
    "platform": "x",
    "bio": "A comb jelly, Beroe cucumis. Perfectly substantial, thank you.",
    "location": {
      "name": "Water off San José del Cabo, Mexico",
      "coordinates": {
        "lat": 22.99,
        "lng": -109.58
      }
    },
    "episodes": [
      {
        "subject": "comb jelly underwater",
        "platform": "x",
        "mediaSha1": "62c3eb852eb1b7393e2eb13fff034b9abe009387",
        "theme": "social",
        "title": "Mostly water",
        "body": "He called me mostly water. Then he ran out of air and had to leave."
      }
    ]
  }
];
