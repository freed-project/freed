# Manual website deployment fallback

Vercel Git integration remains the normal publication path. This repair is
implemented and covered by offline tests, but live qualification is blocked:
the permitted `aubreyfs-projects` scope returns "The specified scope does not
exist" with CLI 56.1.0 and 59.11.7. Do not treat offline tests as deployment
proof or bypass the root's manual-fallback stop until that live qualification
is complete.

## Contract

The website shell entrypoints delegate to `scripts/deploy-website.mjs`.
The `www` copies reject PWA deployment. Product-lane copies retain their
separate PWA implementation. This is an intentional lane difference.

The helper requires the pinned Node version and a clean committed checkout
based on fetched `origin/www`. Production requires the exact live `www` head,
checked before staging and again after the build. It archives tracked source
at one immutable commit into a private temporary directory. Ignored local
credentials, `.vercel` links, `node_modules`, and build output never enter the
archive. The source archive has a SHA-256 recorded in deployment metadata.

The stage preserves the monorepo, lockfile, release-note inputs, shared
packages, and website Next.js configuration. It does not manufacture a Vite
configuration or install an incomplete workspace graph. Vercel commands run
in that temporary stage, never in the user's repository root.

The project binding is explicit: `freed-www`, project
`prj_YkKRjNQXFDQ7YUU01VDc2dQZFbet`, team
`team_SOkY8Pdbb8c1sY0pKSzczMjW`, scope `aubreyfs-projects`.
These IDs match the existing local website link. The helper must confirm them
against the live API, including the `website` root and `nextjs` framework,
before pulling settings or deploying. It never creates or relinks a project.
If the project moved, resolve identity explicitly instead of substituting an
account or copying an unrelated ignored link.

The pinned CLI pulls the selected environment, builds through Vercel, and
deploys only the prebuilt result. It reads back READY state, project, source,
target, deployment ID, and URL. An ambiguous response is an inspection stop,
not permission to redeploy. Cleanup removes only the temporary stage created
by that invocation.

## Qualification and use

Run `node --test scripts/deploy-website.test.mjs` with the pinned Node toolchain.
The tests use synthetic repositories and mocked Vercel responses. They prove
staging, exclusion, lane fencing, command sequencing, identity rejection, and
cleanup. They do not prove credentials, provider build settings, or a live
deployment.

After access is restored, qualify a clean committed `www` task candidate with
`./scripts/vercel-deploy-preview.sh website`. Preserve the returned source SHA,
archive digest, deployment ID, and URL, then inspect the actual preview. Only
after successful live qualification and review should the temporary root and
skill fallback stops be replaced with routes to this contract.

An authorized production fallback uses
`./scripts/vercel-deploy-production.sh website` from exact clean `origin/www`.
Level 6 or 7 is required. Prefer `VERCEL_TOKEN` in the environment over a token
in shell history. Do not paste credentials into task evidence.
