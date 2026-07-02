# P1-02: Break the PWA cloud upload loop

runner-safe: false | provider-visible: false | soak-gated: YES (after P1-01 has soaked)
Findings: F01 (PWA leg), F22. Prereq: P1-01 merged and verified.

## Defect

Same cycle on the PWA (`packages/pwa/src/lib/sync.ts` ~634-636 subscriber, ~693-695 merge-back), but the PWA worker's STATE_UPDATE carries no mutation tag, so the desktop's filter approach needs the tag added first.

## Change

1. Add the mutation tag to the PWA worker's STATE_UPDATE (mirror the desktop shape in `packages/pwa/src/lib/automerge.worker.ts`).
2. Apply the same two guards as P1-01: skip on MERGE_DOC/REPLACE_DOC source; skip on unchanged heads.

## Blast radius

PWA cloud scheduling. Worst failure: missed upload until next genuine mutation.

## Verify

- Unit tests mirroring P1-01.
- Phone idle soak: PWA upload counter → ~0; cross-check desktop download-merge count also falls (the two loops cross-amplified via the relay/cloud).
