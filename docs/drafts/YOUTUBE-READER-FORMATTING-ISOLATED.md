# Isolated YouTube reader formatting

The fresh `origin/dev` base renders YouTube descriptions in a paragraph that
collapses whitespace. The isolated correction adds `whitespace-pre-wrap` and
`break-words` to that paragraph in
`packages/ui/src/components/feed/ReaderView.tsx`. Existing typography is
preserved. Narrative blank lines and credit line breaks can then survive
rendering, while long source URLs wrap within the reader.

The canonical classifier includes this path and infers Facebook, Instagram,
Medium, other, Substack, and X from its broad shared-reader scope. Behavioral
inspection finds only a text-style change in the YouTube branch. Requests,
playback, navigation, timing, retries, headers, cookies, extraction and
provider contact are unchanged. This is a behavior-neutral classified diff.

The owner's explicit request to fix the credit formatting authorizes this
local correction. No live provider test was performed. No machine automation
artifact was written because this task must remain independent of shared
controls, and publication is not authorized. A publication-ready
`diff_authorized` artifact remains required before
any eventual publication. Ask the owner before merging back.

Source assertions passed for all five current YouTube descriptions and
first-person titles. Full UI validation remains outstanding; the strict
machine preflight fails on existing missing automation guard files.

Additional isolated source check: the existing YouTube projection regression now
uses a two-paragraph first-person narrative. A dependency-free Node 24.14.1
assertion confirmed both narrative paragraphs survive exactly, followed by a
blank line before Original video and separate uploader/source lines. No network
requests were made. This does not constitute a Vitest run or rendered proof.


## Offline rendered verification, September 6

The actual ReaderView was rendered through its existing jsdom test harness with generated Giles content. Its emitted DOM was opened in task-owned headless Chromium with CSS compiled from the repository PWA stylesheet and Tailwind configuration. This verifies real component markup and stylesheet layout, not browser React hydration, database activation, playback or deployment. The temporary emission probe was removed.

Desktop at 1,280 by 720 shows I can swim and the narrative paragraphs. Computed white-space is pre-wrap and overflow-wrap is break-word. The gap from the last narrative line to Original video is 58.5 pixels, twice the 29.25-pixel line height. Five separate credit lines survive. Content width and scroll width are both 720 pixels.

Mobile at 390 by 844 shows the full paragraph gap and all five credit lines, with long URLs wrapping. Content width and scroll width are both 350 pixels. Root visually inspected both saved screenshots. Browser request inventory contains only the local document and stylesheet. CSP blocks remote assets and scripts. No player was activated.

Artifacts: output/playwright/editorial-reader/desktop-title-and-narrative.png, mobile-credit-paragraphs.png and layout-evidence.json.

All 45 focused tests across six existing suites pass, including the eight reader tests. Isolated validation packages were installed under /tmp/freed-editorial-validation-runtime; repository dependency manifests are unchanged. Full machine gates remain unclaimed because of the previously recorded shared automation guard failure.
