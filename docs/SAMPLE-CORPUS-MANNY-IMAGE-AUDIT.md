# Manny image-fit review

This review is separate from the original 70-entry text audit. A text pass does not approve its photograph. In the current local integration, Manny has one reviewed photo entry and eight intentional text-only entries, verified against `sample-character-arcs.ts`. The owner approved this mixed presentation. Null image bindings are deliberate choices, not unresolved images awaiting an automatic fallback. Publication and final owner review remain separate gates.

| Episode | Image requirement | Status |
| --- | --- | --- |
| New skin, same nerve | Mantis beside its shed skin, preferably hanging during hardening | Text-only (`mediaSha1: null`). Removed generic portrait because it does not show molting. |
| Violence, and better lighting. | Visible mantis holding a bee in vegetation | Replaced with hash `27b7ebe285129ff07853aa2d19185414fffd682c`. Visually reviewed the actual photograph; bee, forelegs, leaves, and feeding scene are legible. Text unchanged. |
| Rain has hands | Wet foliage, droplets, and a mantis bracing or reaching | Text-only (`mediaSha1: null`). Removed camouflage photo because it does not establish rain. |
| The sky grew talons | A precarious mantis in branches, preferably with a visible predator or disturbed posture | Text-only (`mediaSha1: null`). Removed generic species match because it does not support the encounter. |
| Inventory after death | A live mantis hanging precariously or recovering its grip | Text-only (`mediaSha1: null`). Removed the unverified MHNT-titled file rather than assuming it shows a living animal in this situation. No specimen classification is claimed without inspection. |
| Moth at midnight | Mantis holding a torn wing or a closely matching nocturnal hunting scene | Text-only (`mediaSha1: null`). Removed juvenile portrait. Bidgee's alternative remains rejected: visible mesh and intact prey contradict the incident. |
| Tomorrow, definitely | Two separated mantids, with approach or hesitation plausible | Text-only (`mediaSha1: null`). Removed the mating photograph because it contradicts the unconsummated approach; preserved the joke. |
| Dawn, reconsidered | Mantis concealed beneath foliage, ideally with predator context | Text-only (`mediaSha1: null`). Removed generic resting portrait because it does not establish concealment. |
| The ant took the long way | Ant on or beside a mantis limb | Text-only (`mediaSha1: null`). Removed lone-mantis image because the ant is the visual premise. |

The accepted [bee photograph](https://commons.wikimedia.org/wiki/File:Chinese-mantis-bee.JPG) is credited to Jot Powers under CC BY-SA 2.0. Its exact species identification is inconsistent across the filename and page description; the corpus claims only a praying mantis. Character-wide species and life-stage continuity still needs review.

The local demo integration contains exactly 500 episodes. The combined source catalogs contain 1,772 metadata records, not 1,772 feed items. No image binaries were added. Removed pairings may remain as unused source records; catalog retention never authorizes their return to an episode. A future illustrated replacement needs a fresh scene-fit review and deliberate hash binding.
