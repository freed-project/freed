# Agent Instructions

## Rules

- **After implementing ANY new features:** Update `docs/PHASE-*.md` immediately — do not wait to be asked. Check every phase whose success criteria or task table is affected and update checkboxes + status lines in the same commit as the feature work.
- **Roadmap sync:** When `docs/PHASE-*.md` changes, update `website/src/pages/Roadmap.tsx` to match (`✓ Complete` → `"complete"`, `🚧 In Progress` → `"current"`, else `"upcoming"`).
- **Time estimates:** Machine time only ("one conversation", "~10 min"). Never quote human hours/days.
- **IDs:** Display tail — `...${id.slice(-8)}`.
- **Number formatting:** All user-facing numbers must use `Number.toLocaleString()` (or `Intl.NumberFormat`) — never raw `.toString()` or string interpolation. This ensures locale-appropriate grouping separators (e.g. commas in `en-US`) for counts, totals, and stats.
- **Before creating any new component or hook:** `SemanticSearch` or `Grep` the package for existing code that does the same thing. Duplication is never acceptable — if two surfaces need the same UI or logic, extract a shared primitive and have both import it.
- **Before shipping any feature:** Verify that every exported function/class you added or touched is actually _called_ from an appropriate entry point. Exported-but-never-called code is a bug. Grep for each new export name to confirm it appears in a consumer.
- **Platform copy:** Never write "for Mac", "for Windows", or "for desktop" in user-facing strings. The correct product name is "Freed Desktop". Use that.
- **Async-before-await is synchronous:** Code before the first `await` in an `async` function runs synchronously in the caller's microtask even if the caller doesn't await. Never put O(n) work (e.g. `Array.from(largeUint8Array)`, `A.save()`, serialization) before an `await` in a `subscribe()` callback or any other fire-and-forget async call on a hot path.
- **Vercel deployments -- always use `--scope aubreyfs-projects`:** The only permitted Vercel team for this project is `aubreyfs-projects` (personal account). Never run `vercel deploy`, `vercel link`, or any Vercel CLI command without the `--scope aubreyfs-projects` flag. Never use the `deploy_to_vercel` MCP tool -- it accepts no arguments and silently deploys to whatever team the CLI defaults to. Never run `vercel` from the repo root. The correct deploy commands are:
  - Website: `vercel deploy website/ --scope aubreyfs-projects -y`
  - PWA: `vercel deploy packages/pwa/ --scope aubreyfs-projects -y`

## Versioning

CalVer `YY.M.DDBUILD` — patch segment encodes the day and build number:

- `patch = (day_of_month × 100) + build_number`
- March 1, first build → `26.3.100`; fifth build → `26.3.104`
- March 15, first build → `26.3.1500`

Run `./scripts/release.sh` with no args to auto-compute the next version.

## Package Boundaries

| Package      | Rule                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`    | Pure functions + types. Zero runtime deps. No React.                                                                                                                                         |
| `ui/`        | Platform-agnostic React UI layer. May import `@freed/shared`. No platform stores, no Tauri APIs, no service-worker logic, no `@freed/sync` imports. Ships raw `.tsx` source — no build step. |
| `sync/`      | Storage-agnostic. Works in browser (IndexedDB) and Node (filesystem).                                                                                                                        |
| `pwa/`       | PWA app shell only. Imports `@freed/ui` and `@freed/shared`. Never import Tauri APIs.                                                                                                        |
| `desktop/`   | Tauri shell. Imports `@freed/ui` and `@freed/shared`. Never import from `@freed/pwa`.                                                                                                        |
| `capture-*/` | Isolated. Never import between capture packages.                                                                                                                                             |

## URLs

| Property            | URL                     |
| ------------------- | ----------------------- |
| Marketing site      | `https://freed.wtf`     |
| PWA (mobile reader) | `https://app.freed.wtf` |
| Download page       | `https://freed.wtf/get` |

**Never write `freed.wtf/app`** — the PWA lives at the subdomain `app.freed.wtf`.

## Git Workflow

**Never work directly on `main`.** Always create a git worktree for feature work:

```bash
./scripts/worktree-add.sh ../freed-<slug> -b <branch>
# work in ../freed-<slug>/
# remove when done: git worktree remove ../freed-<slug>
```

`worktree-add.sh` is a drop-in replacement for `git worktree add` -- same args, same behavior, plus it runs `npm ci --prefer-offline` automatically so the new worktree has isolated `node_modules` and is ready to run immediately (~74s with a warm cache). Never use bare `git worktree add` directly.

**Branch naming:** `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/` prefix followed by a short kebab-case description.

**Commit messages** follow Conventional Commits:

| Prefix      | When to use                                       |
| ----------- | ------------------------------------------------- |
| `feat:`     | New user-facing feature                           |
| `fix:`      | Bug fix                                           |
| `chore:`    | Tooling, deps, config — no production code change |
| `docs:`     | Documentation only                                |
| `refactor:` | Code restructure with no behavior change          |
| `perf:`     | Performance improvement                           |
| `style:`    | Formatting, whitespace, CSS-only                  |

**Merge policy:** Squash merge only. One PR = one commit on `main`.

```bash
# From the primary worktree (not the feature worktree):
gh pr merge <n> --squash --delete-branch

# Immediately after merging, tear down the feature worktree:
git worktree remove --force ../freed-<slug>
git branch -D <branch>   # must use -D, not -d (squash leaves commits unreachable)
```

Or run the cleanup helper to sweep all merged worktrees at once:

```bash
./scripts/worktree-cleanup.sh        # interactive
./scripts/worktree-cleanup.sh --yes  # non-interactive
```

Branches are deleted after merge. The squash commit message is derived from the PR title — write PR titles as if they are commit messages.

**Never use `git log main..branch` to check whether a branch has been merged.** Squash merge creates a new commit hash on `main`, so the original branch commits are never reachable from `main`'s history. The branch always looks "ahead" even when its content is fully shipped. Use these instead:

```bash
gh pr list --state merged --head <branch>   # authoritative: did a PR for this branch land?
git branch -vv | grep '\[gone\]'            # remote branch deleted = PR merged + auto-deleted
```

---

## Writing Style (All User-Facing Copy)

Copy must read like a person wrote it. When in doubt, read it aloud. If it sounds like a press release, rewrite it.

- **No em dashes (—) or en dashes (–).** Standard hyphens and normal punctuation only. Em dashes are a near-universal AI tell.
- **No AI filler phrases:** "not just X but Y", "delve into", "it's worth noting", "leverage" (verb), "in today's world", "Furthermore,", "Moreover,", "Additionally,", "at the end of the day", "game-changer", "seamlessly".
- **No throat-clearing.** Cut the first sentence of any paragraph that just announces what the paragraph is about.
- **Short sentences.** If a sentence needs an em dash to hold together, split it in two.
- **Concrete over abstract.** "Stores posts on your hard drive" beats "enables local-first data persistence".
- **Contractions are fine.** "We don't" reads warmer than "We do not". Use them.

## Desktop E2E Testing

The Freed Desktop app has a Playwright test suite that runs in plain Chromium -- no Tauri binary, no
native build required. Use this to reproduce UI bugs, verify fixes, and write regression tests
without any manual clicking.

### How it works

`VITE_TEST_TAURI=1` swaps every `@tauri-apps/*` import for a thin mock module under
`packages/desktop/src/__mocks__/@tauri-apps/`. Each mock tracks calls in `window.__TAURI_MOCK_*`
globals. A self-contained init script (`tests/e2e/fixtures/tauri-init.ts`) is injected via
`page.addInitScript()` before any page JavaScript runs -- it installs `window.__TAURI_INTERNALS__`
with default IPC handlers for every command the app calls on startup.

### Running the tests

```bash
# Standard run (headless Chromium)
npm run test:e2e --workspace=packages/desktop

# Playwright UI mode (visual test runner, great for writing new tests)
npm run test:e2e:ui --workspace=packages/desktop

# Step-through debugger (pauses on each action, shows browser)
npm run test:e2e:debug --workspace=packages/desktop
```

All three commands start a Vite dev server automatically on port 1422 with `VITE_TEST_TAURI=1` and
tear it down after the run. No separate server startup needed.

### Writing a new test

1. Add a spec file under `packages/desktop/tests/e2e/`.
2. Import from `./fixtures/app` -- not from `@playwright/test` directly:

```ts
import { test, expect } from "./fixtures/app";

test("my new behaviour", async ({ app }) => {
  // app.page is a Playwright Page. The Tauri mock is already injected.
  // app.waitForReady() blocks until <main> is visible (app fully init'd).
  await expect(app.page.locator("button")).toBeVisible();
});
```

3. Use the `ipc` fixture to override handlers or read mock state:

```ts
test("invoke a command", async ({ app, ipc }) => {
  await ipc.setHandler("my_command", (_args) => ({ ok: true }));

  const result = await app.page.evaluate(async () =>
    (window as any).__TAURI_MOCK_INVOKE__("my_command", {})
  );
  expect(result).toEqual({ ok: true });
});
```

4. To assert on plugin-shell `open()` calls: `await ipc.openedUrls()`.
5. To assert on plugin-process calls: `await ipc.processCalls()`.
6. To pre-set the updater state before page load, inject a second `addInitScript`:

```ts
await page.addInitScript(tauriInitScript());  // always first
await page.addInitScript(() => {
  (window as any).__TAURI_MOCK_UPDATE__ = { version: "2.0.0", ... };
});
await page.goto("/");
```

### Adding a new IPC mock handler

If the app starts calling a new `invoke()` command and tests fail because the handler is missing,
add a default response in both places:

1. `packages/desktop/tests/e2e/fixtures/tauri-init.ts` -- add an entry to `_defaults` inside the
   IIFE. This covers the init-script path (plain Chromium / CI).
2. `packages/desktop/src/__mocks__/@tauri-apps/api/core.ts` -- add to the `handlers` map in the
   module-level mock (only hits when `VITE_TEST_TAURI=1` aliases are active, i.e. dev server runs
   the real Vite mock modules instead of the injected init script).

The two are complementary. `tauri-init.ts` is the reliable one for tests; the module mocks exist
for completeness and for any test that doesn't use `page.addInitScript`.

### Debugging a UI bug in the desktop app

1. Create a worktree as usual.
2. Write a failing test that reproduces the bug.
3. Run with `--debug` to step through the browser state at each assertion.
4. Fix the code, confirm the test goes green, then commit both together.

This replaces manual testing. Never ask the user to click through the app to verify a fix -- write
a test instead.

## Automerge

**Schema** (`packages/shared/src/schema.ts`): backward-compatible only. Add optional fields; never delete (mark `@deprecated`).

**Mutations** must use `A.change()` — direct mutation silently fails to sync:

```ts
A.change(doc, (d) => {
  d.items.push(item);
}); // ✅
doc.items.push(item); // ❌ silent failure
```

**Proxy constraints inside `A.change()`:**

- Never assign `undefined` — use `delete` instead
- Never replace an existing nested object — assign fields individually or use a `deepMergeInto` helper
