# SQLite performance baseline, 2026-08-29

## Identity and scope

This report records the first coherent performance baseline for Freed's
clean-slate SQLite architecture.

- Final benchmark commit: `5641f1b1c73c14da3b1c549fc80ec5be995d4339`
- Native preview product commit: `b6c46529d3fb3921f0a71e0dba64afe4092486d6`
- Native preview version: `26.8.2002`
- Native preview bundle identifier: `wtf.freed.desktop.sqlite-native-preview`
- Browser benchmark engine: Chromium 151, one worker
- Friends renderer: headless software WebGL2
- Comparison baseline: `packages/desktop/tests/e2e/perf-baselines.json`,
  generated on 2026-03-08 after the worker migration

The native preview product and final benchmark commit differ only by the
explicit 60-second ceiling for the hosted WebKit OPFS durability test. Product
code is identical.

The percentage changes below are valid only where the old and new browser
fixtures measure the same action and corpus size. They are regression evidence,
not a claim about every machine or an installed native workload.

## Comparable feed hot paths

| Hot path | Previous baseline | SQLite baseline | Change |
| --- | ---: | ---: | ---: |
| Cold load, 1,000 items | 1,200 ms | 509 ms | 57.6% faster |
| Cold load, 3,000 items | 2,500 ms | 487 ms | 80.5% faster |
| Cold load, 5,000 items | 5,000 ms | 546 ms | 89.1% faster |
| Fast scroll, 3,000 items | 700 ms | 564 ms | 19.4% faster |
| Scroll long tasks over 50 ms | 10 | 0 | Eliminated in this run |
| Read mark storm, average call | 320 ms | below 0.05 ms displayed precision | More than 99.9% lower |
| Read mark storm, worst call | 480 ms | 0.1 ms | 99.98% lower |
| Reader open, 3,000 items | 1,000 ms | 215 ms | 78.5% faster |
| Renderer heap growth, 5,000 items | 45 MB | 8.0 MB | 82.2% lower |
| Retained heap after 50 mutations | 3 MB | below displayed precision | No measurable retention |

The cold-load curve is now approximately flat from 1,000 through 5,000 stored
items. The visible feed retained nine cards in each run. SQLite owned the
corpus, and React retained the visible window.

Fast scrolling delivered 120 FPS at a 10.2 ms p95 frame time, with no dropped
frames and no long tasks. A five-character search across the 5,000-item SQLite
fixture completed in 663 ms with no long tasks. Clearing a heavy search retained
no measurable search-index heap.

## Bounded secondary surfaces

### Map

- 4,800 normalized location rows stored in SQLite
- 1,000 semantic markers returned by the bounded query
- 160 settled marker elements attached to the DOM
- 24 marker elements attached while moving
- 267 ms mount time
- 120 FPS during interaction
- 9.2 ms p95 frame time
- zero dropped frames
- zero long tasks
- 640 total DOM nodes

### RSS source sidebar

- 1,600 normalized RSS feed rows stored in SQLite
- 10 visible feed rows retained by React
- 28 ms page mount
- 213 ms search for feed 1,599
- one filtered feed row retained
- 120 FPS idle
- 97 FPS during search
- 16.7 ms search p95 frame time
- one dropped frame
- zero long tasks
- 606 initial DOM nodes and 495 filtered DOM nodes

### Settings

- 1,600 normalized RSS feed rows stored in SQLite
- 84 ms dialog mount
- 38 ms settings search
- 51 ms bounded feed search for feed 1,599
- 768 initial DOM nodes and 557 filtered DOM nodes
- zero long tasks during scroll, settings search, and feed search

Headless Chromium delivered only 23 FPS while the settings dialog was idle and
22 FPS during its synthetic scroll. The scroll p95 was 83.3 ms against a
matched 91.6 ms idle p95. This identifies compositor throughput in the headless
environment, not synchronous SQLite or JavaScript work. Native WebKit evidence
is still required before judging the installed settings animation path.

### Friends

- 1,600 people and 1,920 accounts stored in SQLite
- 1,000 associated feed items stored in SQLite
- zero feed items retained in the React store
- typed 128-row person and account pages
- 4,076 ms mount for 3,520 identities
- 27.9 ms graph layout
- scene rebuild count remained stable during zoom and pan
- visible-node and label budgets passed

The headless software WebGL2 run delivered 7 FPS and recorded many long tasks.
This result is not comparable to the native Metal-backed WebKit path and is not
a product regression verdict. It is a warning that the installed Friends scene
must be measured on the native candidate before release promotion.

## Native preview evidence

The isolated native app built and launched successfully from the product commit.
It created a dedicated preview data root and did not open the production Freed
Library.

- SQLite `quick_check`: `ok`
- SQLite schema version: 1
- Normalized tables: 98
- Failed boots: 0
- First successful boot recorded
- Native resident memory at the first-run legal gate: about 136 MB
- WebKit resident memory at the first-run legal gate: about 143 MB
- App resident memory at the first-run legal gate: about 279 MB

The native memory sample is a first-run legal-gate observation. It must not be
compared with a populated feed, Friends, map, or provider workload.

## Validation coverage

The exact product candidate passed the full local feature gate:

- 405 shared tests
- 108 sync tests
- 120 library service tests, with one intentional skip
- 308 PWA tests
- real WebKit OPFS reopen durability across three document lifecycles
- 784 Desktop tests
- nine Desktop smoke tests
- 168 Desktop native tests
- 177 Library Core native tests
- PWA and Desktop production builds
- retired Automerge runtime guards
- normalized release activation and authority guards

The cleaned performance lane passed all 20 tests. The obsolete graph stress
replay was removed from that lane because the current 3,520-identity Friends
test already protects bounded paging, visible-node caps, labels, zoom, pan, and
no-scene-rebuild behavior. A separate functional test already protects
selection without a scene rebuild.

## Remaining evidence before release promotion

1. Accept the isolated preview's first-run agreement through the product UI.
2. Measure Friends, map, feed, and settings on the running native app with an
   attributed process generation and matched fixture.
3. Resolve the pre-existing Desktop OAuth token persistence debt tracked in
   issue #1632 through its separate Google Drive provider approval and
   platform-secret migration delivery.
4. Obtain explicit authority for the Library Core activation and protected dev
   promotion, then cut and verify the signed dev release.
