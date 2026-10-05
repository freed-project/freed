import type { SampleCharacterArc } from "./sample-character-arcs.js";

/** Source and embodiment decisions: AQUATIC-REGULAR-41-ADMISSION.md. */
export const AQUATIC_FORTY_ONE_CHARACTER_ARCS: readonly SampleCharacterArc[] = [
  {
    "characterId": "edgar-prong",
    "identityNameBase": "Edgar Prong",
    "platform": "facebook",
    "bio": "An armored searobin. My visitors have their own ideas.",
    "location": {
      "name": "Deep seafloor near Mona Passage, northern Caribbean",
      "coordinates": {
        "lat": 18.5,
        "lng": -67.7
      }
    },
    "episodes": [
      {
        "subject": "Atlantic armored searobin",
        "platform": "facebook",
        "contentType": "post",
        "theme": "social",
        "title": "The third return",
        "body": "I thought he was stuck. Shook him off very carefully. He climbed back on. The third time I understood I was the place he was trying to get to.",
        "classification": "conversation",
        "mediaSha1": "07f2e91586f2ecb2fef8cce9068f0999d7018970"
      }
    ]
  },
  {
    "characterId": "nestor-clasp",
    "identityNameBase": "Nestor Clasp",
    "platform": "instagram",
    "bio": "A deep-sea king crab. Taking small changes personally.",
    "location": {
      "name": "Rocky deep slope in the Gulf of Alaska",
      "coordinates": {
        "lat": 57.5,
        "lng": -145
      }
    },
    "episodes": [
      {
        "subject": "Alaskan lithodid king crab",
        "platform": "instagram",
        "contentType": "post",
        "theme": "courtship",
        "title": "The next grip",
        "body": "Every time I loosened my claw, theirs moved with it. I thought we were about to let go. Then I felt the new grip. It took me several changes of position to stop treating each one as the end.",
        "classification": "personal",
        "mediaSha1": "49106f4e4f269ddf47dd35e521a5a45eef8728a5"
      }
    ]
  }
];
