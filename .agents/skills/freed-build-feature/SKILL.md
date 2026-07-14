---
name: freed-build-feature
description: Build governed Freed product work in a worktree based on origin/dev, verify the runnable slice, and publish a correctly staged pull request to dev. Use for Desktop, PWA, shared packages, sync, capture, release tooling, product behavior, and product documentation. Also use for stability tasks that require a stable task identity, a measurable counter, native validation, or an installed-build verification handoff. Do not use for public website work targeting www.
disable-model-invocation: true
---

# Build Feature

Build one attributable product change from the latest `origin/dev`. Keep the change connected to its task, evidence, authority, and post-merge verification.

## Establish the contract

1. Confirm the destination is `dev`. Route public website work to `freed-build-www`.
2. Record a stable task ID. For stability work, use the existing program task ID. Do not invent a second task for the same root cause.
3. Record canonical task authority as `observe-only`, `plan-only`, `pr-only`, or `merge-safe`. Record provider authority separately as `forbidden`, `approval-required`, or `approved`. Also record which external actions the user explicitly granted, such as publishing a PR, merging, releasing, or deploying. None of these fields substitutes for another.
4. For sync, capture, memory, or recovery work, name the metric-registry entry that will judge the change. Record its event predicate, denominator, target, baseline window, minimum coverage, and expected direction.
5. Treat missing build identity, mixed-build evidence, insufficient coverage, or broken sources as `inconclusive`. Do not turn absence of evidence into a passing result.
6. Record the source build identity for every baseline: app version, channel, git SHA, native boot ID, app session ID, and exact start and end timestamps when available.
7. Read [docs/STABILITY-PROGRAM.md](../../../docs/STABILITY-PROGRAM.md). Preserve the watchdog freeze and one global behavioral product change until its installed-build soak outcome completes.
8. If the change can alter provider-visible behavior, stop and use `freed-provider-risk-review`. Preparation is not approval. A materially changed provider-visible diff requires renewed approval.

## Build the slice

1. Run `git fetch --all --prune` and `node scripts/validate-main-backflow.mjs --dev-ref=origin/dev --main-ref=origin/main`.
2. Create the worktree with `./scripts/worktree-add.sh ../freed-<slug> -b <branch> origin/dev --install full --target <desktop|pwa|shared>`. Use `--swarm` only for deliberately deferred speculative work.
3. Before creating a component or hook, search the relevant package for an existing primitive. Before closeout, search for every new or changed export and confirm a real entry point consumes it.
4. Implement one runnable slice. Keep instrumentation changes separate from the behavior they are intended to judge unless the metric cannot exist independently.
5. Launch the lightest useful preview on a fresh port with `scripts/lib/find-free-port.mjs` and `scripts/worktree-preview.sh`. Use a native Desktop preview only when Tauri behavior matters.
6. Iterate with the cheapest proof that answers the current question. Preserve useful previews until the user is finished reviewing them.

## Validate

1. Run focused tests during implementation, then run `npm run validate:feature` at the publish checkpoint.
2. Run workspace commands from the workspace directory. Do not dispatch workspace scripts from the repository root.
3. If Rust or native orchestration changed, run the repository native validation lane. Until that lane is available, run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` from `packages/desktop/src-tauri`.
4. Test the failure semantics, not only the success path. Cover task ownership, timeout settlement, retry bounds, telemetry fields, and recovery transitions when relevant.
5. Record the candidate git SHA and focused test results. An installed-build claim is valid only after the installed version, channel, and git SHA match the candidate artifact.
6. For stability changes, create a verification handoff containing task ID, metric ID, candidate SHA, release build identity, required scenario, exact window, and success threshold.

## Keep roadmap lanes separate

When product work changes any `docs/PHASE-*.md` file:

1. Update the affected phase document in the product PR.
2. Reconcile [docs/roadmap-status.json](../../../docs/roadmap-status.json) in the same product PR, even when the phase status remains unchanged.
3. Run `node scripts/validate-roadmap-status.mjs`.
4. Create a separate `www` handoff containing the source commit SHA, manifest digest, and the public phase copy that must be reconciled.
5. Do not edit `website/src/app/roadmap/RoadmapContent.tsx` from the `dev` worktree.

## Publish and close out

1. Publish with `./scripts/worktree-publish.sh --title "<conventional title>" --summary "<change>" --test "<focused check>"` using the caller's existing GitHub authentication. When provider-visible paths changed, publish the draft first. The helper posts a review comment bound to the provider-only diff. After a CODEOWNER adds a GitHub thumbs-up reaction to that comment, rerun the helper with `--ready`. A valid signed control-task approval may authorize an unattended ready transition.
   A host that deliberately provisions `FREED_TRUSTED_PUBLISHER` may invoke the
   same helper through its capability and lease handoff for unattended work.
   Missing optional broker provisioning does not block the normal publication
   path. A partial trusted handoff still fails closed.
2. Confirm the PR targets `dev`, required checks passed for the exact head SHA, and the PR state matches the granted authority.
3. Do not merge owner-review or provider-visible work autonomously.
4. For governed stability or control-plane work, record the canonical task ID
   through the outcome helper after merge while the task is in `validated`,
   using the live actor lease and exact merged-head evidence. The helper must
   perform the `validated` to `merged` transition. General product work without
   a canonical control task does not invent an outcome record. A completed task
   stays closed unless fresh post-build evidence from a later window proves
   regression.
5. Stop only this worktree's preview when the PR merges, the worktree is removed, or the task is archived.
