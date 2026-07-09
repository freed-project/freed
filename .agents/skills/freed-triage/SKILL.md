---
name: freed-triage
description: Run the stability triage loop — fold invariant alarms, the latest soak verdict, canary regressions, and open CI-failure issues into ranked task files, then either execute the top candidate through its program task or leave the queue for the nightly runner. Use when asked to triage stability evidence, decide what to fix next, or after a soak/canary produced failures.
disable-model-invocation: true
---

# Triage

Evidence in, ranked tasks out. This skill drives `scripts/triage.mjs` (stability W2-02), which dedupes live evidence into root-cause buckets that map to EXISTING program tasks — the point is convergence on [docs/STABILITY-PROGRAM.md](../../../docs/STABILITY-PROGRAM.md), never a fork of it. Program rules bind: **watchdog freeze, one behavioral change per soak cycle, provider-visible approval lane, runner-safe:false means owner reviews the PR.**

## Workflow

1. Run the loop: `node scripts/triage.mjs` (add `--no-ci` offline; `--json` for the full evidence). It reads rotated runtime-health alarms (last 48h), the latest `soak-verdict.json` via the automation pointer, the newest `canary-ledger/` record's regressions, and open `automation-triage` GitHub issues, then writes ranked `T-<rank>-<bucket>.md` files into `~/.freed/automation/triage/candidates/`.
2. Present the ranked candidates with their evidence pointers (file:line into runtime-health, verdict entries, canary records, issue links). Every claim must trace to a pointer — no vibes.
3. Decide the handoff:
   - **Execute now:** open the top candidate's mapped program task (e.g. `docs/stability-tasks/P1-04-preflight-recycle-guard.md`) and run it through `freed-build-feature`, obeying that task's own `runner-safe` / `provider-visible` / `soak-gated` header. A `runner-safe: false` task ends at an owner-review PR, never an autonomous merge. A `soak-gated` task must not batch with another behavioral change.
   - **Queue for the nightly runner:** do nothing further — the candidate directory is already a first-class source in `scripts/nightly-self-improve.mjs`, ranked above roadmap work while the evidence is fresh (<48h).
4. If the top candidate is `ci-red`: fix CI first; nothing ships over a red pipeline. Close the `automation-triage` issue when the fix merges so the bucket drains.
5. Re-run after the next soak/canary window and confirm executed buckets STOP appearing — a bucket that persists after its fix merged means the fix didn't move the counter; say so loudly.

## Success criteria (counters, not vibes)

- `~/.freed/automation/triage/candidates/` contains freshly ranked `T-*.md` files whose evidence pointers resolve.
- Each surfaced bucket either becomes an executed program task (PR opened under its own governance) or is explicitly left for the nightly runner — never silently dropped.
- After the mapped fix lands, the next triage run shows that bucket gone or falling; the program scorecard row it maps to moves toward target.
