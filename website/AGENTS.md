# Website Instructions

These rules apply to `website/**`. Read the root `AGENTS.md` and use [freed-build-www](../.agents/skills/freed-build-www/SKILL.md) for implementation and review. Use [freed-ship-www](../.agents/skills/freed-ship-www/SKILL.md) for an authorized production merge or manual deployment fallback.

## Product and copy invariants

- The canonical marketing site is `https://freed.wtf`, the PWA is `https://app.freed.wtf`, and downloads are at `https://freed.wtf/get`. Do not use a marketing-site `/app` path for the PWA.
- Use "Freed Desktop" in user-facing strings. Never write "for Mac", "for Windows", or "for desktop" as the product name.
- Display opaque IDs as their last eight characters with a `...` prefix.
- Format user-facing counts and totals with `Number.toLocaleString()` or `Intl.NumberFormat`. Do not interpolate raw numbers or use `.toString()` for presentation.
- Preserve approved claims, uncertainty, terminology, casing, and legal meaning. Never invent customer claims, statistics, sources, release status, or product capability.
- Write like a person. Use direct verbs, concrete nouns, and natural sentence lengths. Cut press-release filler, throat-clearing, canned insight, and decorative conclusions. Do not use em dashes, en dashes, or double hyphens as prose punctuation.

## UI changes

- Before creating a component or hook, search `website/` and the imported shared packages for an existing equivalent. Reuse or extract a shared primitive instead of duplicating it.
- Before shipping, confirm every exported function or class you added or touched has an appropriate caller.
- Inspect the nearest mature website surface before changing visual design. Match its typography, spacing, radius, borders, shadows, motion, responsive behavior, and theme treatment unless the task requires a deliberate departure.
- Keep controls usable at supported mobile and desktop widths. Floating menus and overlays must remain within the viewport and scroll internally when their contents grow.
- Do not modify product packages from the `www` lane. If a website change needs a shared product primitive changed, stop and route that work through a separate `dev` task.

## Theme Selector contract

- The footer theme selector previews fonts and layout. Render its interactive preview in a fixed layer captured before the theme changes. An inline-only hover preview can reflow the page, move the control out from under the pointer, and create a preview loop.
- Keep exactly three themes per row in this order: Ember, Midas, Scriptorium, then Starship, Dark Star, Neon.
- The active swatch is taller than resting themes. Reserve fixed row height for the maximum active state so switching themes never moves either row.
- A change to `ThemeSelector.tsx`, `desktop-themes.css`, or compact theme-preview styles must run `npm run test:e2e` from `website/`. Keep regression assertions for a stable pointer target, fixed row centers, and a taller active swatch.

## Roadmap and changelog

- Roadmap presentation must come from canonical `docs/roadmap-status.json` at an approved product source commit. Record the file digest. Run `node scripts/validate-roadmap-status.mjs` inside that exact product checkout before transfer. Map statuses and descriptions from the validated source exactly. Do not infer state from phase prose, commit messages, or visual cues.
- Changelog presentation must remain bound to the approved published release, tag, channel, source commit, and release-note artifact.
- Record source identity in the task and pull request. Never merge `dev` into `www` to move roadmap or changelog content.

## Local proof and review

- Run `npm run dev`, `npm run build`, lint, and tests from `website/`. Prefix `PATH` with the worktree root `node_modules/.bin` when a hoisted binary is needed.
- Keep browser automation headless by default. Show a visible local preview in the task's built-in Browser. Do not open Chrome, headed Playwright, Playwright UI or debug mode, Computer Use, or another external browser unless the owner explicitly requests that surface.
- For a user-facing change, inspect the rendered page at relevant desktop and mobile widths and across affected themes. Hand the current preview back to the owner before treating a queued visual batch as ready to commit.
- Run focused tests for the behavior changed. Run `npm run build` before publication. Website E2E is unnecessary for instruction-only work that changes no rendered website code.
- Let the pull request's Vercel Git integration create the normal shareable preview. If the owner requests a manual fallback, stop and route a separate helper-repair task. The current helper scripts are not a supported website path until that repair is reviewed and verified.

Merging to `www` is a production deployment and requires Level 6 or 7 even when local proof, CI, and the Vercel preview are green.
