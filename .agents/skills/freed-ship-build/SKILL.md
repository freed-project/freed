---
name: freed-ship-build
description: Ship and verify a versioned Freed Desktop build through GitHub Actions. Use when asked to cut a dev or production release, publish a reviewed build, or repair a failed release pipeline. Preserve source and installed build identity, require exact-head validation including native tests, and create a governed post-install verification task.
---

# Ship Build

Publish from the correct release lane and prove which artifact was installed afterward.

This skill governs versioned Freed Desktop releases. A production PWA snapshot
does not create a version, tag, GitHub release, release-note artifact, or public
release card. After its immutable dev snapshot is promoted to `main`, deploy it
from an exact clean `origin/main` checkout with
`./scripts/deploy-pwa-production-snapshot.sh <promoted-dev-sha>`.

## Select the release workflow

Read the applicable references before the corresponding action:

- For every Desktop release, first read [candidate-proof.md](references/candidate-proof.md) and [source-and-activation.md](references/source-and-activation.md). They govern local proof, immutable source selection, provider approvals, and Library Core activation decisions.
- To prepare, validate, publish, or tag a dev or production release, read [prepare-and-publish.md](references/prepare-and-publish.md). Use its channel-specific commands. Production defaults must never silently select the dev lane.
- To repair a failed release pipeline, read the candidate, source, and publication references. Diagnose the failing step, repair it through the correct lane, and publish a new version when required. Never move or reuse a failed tag.
- Before installation and release closeout, read [installed-verification.md](references/installed-verification.md). It owns artifact identity, issue verification, soaks, reverse integration, and website handoff.

A release can need several references. Load each before its action; do not load installation detail merely to diagnose an early build failure.

## Authority stops

The root numbered authorization level applies throughout this workflow. Skill invocation does not grant release, installation, provider, or migration activation authority. Reuse the owner's existing approval when it covers the specific action.

Keep one immutable source product SHA. Require the provider decision and any Library Core activation decision applicable to that source. Never infer either from a green build, a release request, or code presence.

Use the repository scripts for versions, release notes, publication, and tags. Record the release and installed identities before claiming completion.
