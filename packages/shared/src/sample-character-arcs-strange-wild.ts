import type { SampleCharacterArc } from "./sample-character-arcs.js";

/** Root-approved image-led entries from strange draft07.
 * Rudi and Pippa are separate colugo identities because the source photographs
 * show distinct coat colors. Yuri's early memory is ordered from fearful
 * hiding to the later, overconfident claim of invisibility.
 */
export const STRANGE_WILD_CHARACTER_ARCS: readonly SampleCharacterArc[] = [
  {
    "characterId": "pippa-fold",
    "identityNameBase": "Pippa Fold",
    "bio": "Usually attached to something. Occasionally not.",
    "platform": "instagram",
    "location": {
      "name": "Bukit Timah forest, Singapore",
      "coordinates": {
        "lat": 1.354,
        "lng": 103.776
      }
    },
    "episodes": [
      {
        "subject": "Galeopterus variegatus",
        "platform": "instagram",
        "classification": "conversation",
        "mediaSha1": "66f413e28dcd1fc172084d8128ae086916b5c47d",
        "theme": "social",
        "title": "A small wave",
        "body": "I tried to give a discreet little wave. Opened an entire side of myself. The neighbor thought I was leaving."
      },
      {
        "subject": "Galeopterus variegatus",
        "platform": "facebook",
        "contentType": "story",
        "classification": "event",
        "mediaSha1": "7ed862b12de0299b5ba39d095c0f1d7ac5cfecef",
        "theme": "movement",
        "title": "The others disagreed",
        "body": "I let go with one foot to prove I wasn't scared. The remaining feet are being unnecessarily sincere."
      },
      {
        "subject": "Galeopterus variegatus",
        "platform": "instagram",
        "contentType": "story",
        "theme": "family",
        "title": "The part in between",
        "body": "When I was small, I leaned out from Mother's fur to watch the trees. The moment she let go, I hid my face. When I looked again we had arrived. I wanted her to go back.",
        "classification": "personal",
        "mediaSha1": "93a1216858e9f3456b728dbaa7152d0fa722c1b0"
      }
    ]
  },
  {
    "characterId": "rudi-glide",
    "identityNameBase": "Rudi Glide",
    "bio": "A Sunda colugo, Galeopterus variegatus.",
    "platform": "rss",
    "location": {
      "name": "Bukit Timah forest, Singapore",
      "coordinates": {
        "lat": 1.354,
        "lng": 103.776
      }
    },
    "episodes": [
      {
        "subject": "Galeopterus variegatus",
        "platform": "rss",
        "classification": "event",
        "mediaSha1": "55ffd1d7f455bf3169a24ceef7e4dbc88f355915",
        "theme": "movement",
        "title": "The extra journey",
        "body": "There was no reason to cross back. I had eaten. The bark was good. Nobody was bothering me.\n\nI climbed anyway.\n\nAt the top I spread myself and left. The air pulled tight beneath me. For a little while I had no weight against my feet and no leaf in my mouth and nothing to hold.\n\nI reached the other trunk much too pleased with myself. Clung there, pretending I had come to inspect something.\n\nThere was a leaf. I inspected it. Entirely ordinary.\n\nThen I climbed that tree and went back.\n\nI used to think all the gaps in the forest were an inconvenience. Tonight I crossed the same one six times. Ate the leaf on the fifth trip so that I would have an explanation."
      }
    ]
  },
  {
    "characterId": "mireille-tap",
    "identityNameBase": "Mireille Tap",
    "bio": "Listening. One finger in something.",
    "platform": "instagram",
    "location": {
      "name": "Forest edge near Mananara, Madagascar",
      "coordinates": {
        "lat": -16.25,
        "lng": 49.73
      }
    },
    "episodes": [
      {
        "subject": "Daubentonia madagascariensis",
        "platform": "instagram",
        "classification": "inspiring",
        "mediaSha1": "7da4a4206ac49800bd46353893b059b839b6ca29",
        "theme": "feeding",
        "title": "Reach",
        "body": "Someone asked why I needed such a long finger. I was halfway inside a flower. I let them work it out."
      },
      {
        "subject": "Daubentonia madagascariensis",
        "platform": "rss",
        "classification": "conversation",
        "mediaSha1": "49907b5b38094f7b79791abdf17cea305094243d",
        "theme": "social",
        "title": "The other tapping",
        "body": "Something was tapping farther along the branch. I stopped. It stopped.\n\nI tapped twice. Two taps came back. I went around the trunk. Nobody there. Returned to my branch. Three taps this time. Three back.\n\nI was beginning to feel rather good about having invented a conversation.\n\nThen the other aye-aye came into view. He had been going around the tree the other way.\n\nWe stared at each other. He tapped once. I tapped once.\n\nHe climbed down. I stayed.\n\nA little later the tapping started below me. Not an answer this time. His own uneven rhythm. I could hear him getting farther away.\n\nI did not follow. But I stopped eating until I couldn't hear it anymore."
      },
      {
        "subject": "Daubentonia madagascariensis",
        "platform": "instagram",
        "classification": "inspiring",
        "mediaSha1": "06385ff2c5463afc8b270f872917b448f0ff8b75",
        "theme": "wonder",
        "title": "The forest at night",
        "body": "I was trying to listen to the forest. My own chewing was in the way. I stopped. The forest turned out to be mostly other people chewing."
      }
    ]
  },
  {
    "characterId": "yuri-thaw",
    "identityNameBase": "Yuri Thaw",
    "bio": "The nose grew in. Still adjusting.",
    "platform": "instagram",
    "location": {
      "name": "Stepnoi Sanctuary steppe, Russia",
      "coordinates": {
        "lat": 46.15,
        "lng": 46.7
      }
    },
    "episodes": [
      {
        "subject": "Saiga tatarica tatarica",
        "platform": "rss",
        "classification": "personal",
        "mediaSha1": "2afe33f36ad8c104bbe503e123512af517df9a45",
        "theme": "family",
        "title": "The waiting",
        "body": "Mother told me to stay down. I put my legs under me. There seemed to be too many, but eventually they fitted.\n\nShe went away through the grass. I kept my head low. An insect climbed over my foot. I let it. I was doing this properly.\n\nI could hear the others moving. Then only the grass.\n\nI had several questions. Whether she knew which patch I was in. Whether I would know her when she came back. Whether the insect had gone or was now somewhere more important.\n\nI waited until I could not possibly wait any longer.\n\nWhen I opened my eyes, her nose was against my ear. I had slept through being brave.\n\nI stood up too quickly and had to find my legs again. She waited."
      },
      {
        "subject": "Saiga tatarica tatarica",
        "platform": "instagram",
        "classification": "personal",
        "mediaSha1": "53ec7831697a3718c9997e03d364575127b51f09",
        "theme": "family",
        "title": "Excellent concealment",
        "body": "Mother walked straight past me. I had never hidden so well. For one glorious moment I was invisible. Then I squeaked."
      },
      {
        "subject": "Saiga tatarica tatarica",
        "platform": "instagram",
        "contentType": "story",
        "classification": "conversation",
        "mediaSha1": "f58bdc57b1ad250c6c480a91e6608065e5fc52ab",
        "theme": "social",
        "title": "A wet attachment",
        "body": "The mud made a kissing noise when I pulled my hoof out. I took another step. It seems we are seeing each other now."
      }
    ]
  }
];
