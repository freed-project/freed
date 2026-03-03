# Agent Instructions

## Rules

- **After implementing ANY new features:** Update `docs/PHASE-*.md` immediately — do not wait to be asked. Check every phase whose success criteria or task table is affected and update checkboxes + status lines in the same commit as the feature work.
- **Roadmap sync:** When `docs/PHASE-*.md` changes, update `website/src/pages/Roadmap.tsx` to match (`✓ Complete` → `"complete"`, `🚧 In Progress` → `"current"`, else `"upcoming"`).
- **Time estimates:** Machine time only ("one conversation", "~10 min"). Never quote human hours/days.
- **IDs:** Display tail — `...${id.slice(-8)}`.
- **Number formatting:** All user-facing numbers must use `Number.toLocaleString()` (or `Intl.NumberFormat`) — never raw `.toString()` or string interpolation. This ensures locale-appropriate grouping separators (e.g. commas in `en-US`) for counts, totals, and stats.

## Versioning

CalVer `YY.M.DDBUILD` — patch segment encodes the day and build number:
- `patch = (day_of_month × 100) + build_number`
- March 1, first build → `26.3.100`; fifth build → `26.3.104`
- March 15, first build → `26.3.1500`

Run `./scripts/release.sh` with no args to auto-compute the next version.

## Package Boundaries

| Package | Rule |
|---|---|
| `shared/` | Pure functions + types. Zero runtime deps. No React. |
| `ui/` | Platform-agnostic React UI layer. May import `@freed/shared`. No platform stores, no Tauri APIs, no service-worker logic, no `@freed/sync` imports. Ships raw `.tsx` source — no build step. |
| `sync/` | Storage-agnostic. Works in browser (IndexedDB) and Node (filesystem). |
| `pwa/` | PWA app shell only. Imports `@freed/ui` and `@freed/shared`. Never import Tauri APIs. |
| `desktop/` | Tauri shell. Imports `@freed/ui` and `@freed/shared`. Never import from `@freed/pwa`. |
| `capture-*/` | Isolated. Never import between capture packages. |

## Git Workflow

**Never work directly on `main`.** Always create a git worktree for feature work:

```bash
git worktree add ../freed-<slug> -b <branch>
# work in ../freed-<slug>/
# remove when done: git worktree remove ../freed-<slug>
```

**Branch naming:** `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/` prefix followed by a short kebab-case description.

**Commit messages** follow Conventional Commits:

| Prefix | When to use |
|---|---|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `chore:` | Tooling, deps, config — no production code change |
| `docs:` | Documentation only |
| `refactor:` | Code restructure with no behavior change |
| `perf:` | Performance improvement |
| `style:` | Formatting, whitespace, CSS-only |

**Merge policy:** Squash merge only. One PR = one commit on `main`.

```bash
# From the primary worktree (not the feature worktree):
gh pr merge <n> --squash --delete-branch
```

Branches are deleted after merge. The squash commit message is derived from the PR title — write PR titles as if they are commit messages.

---

## Automerge

**Schema** (`packages/shared/src/schema.ts`): backward-compatible only. Add optional fields; never delete (mark `@deprecated`).

**Mutations** must use `A.change()` — direct mutation silently fails to sync:
```ts
A.change(doc, d => { d.items.push(item) }) // ✅
doc.items.push(item)                        // ❌ silent failure
```

**Proxy constraints inside `A.change()`:**
- Never assign `undefined` — use `delete` instead
- Never replace an existing nested object — assign fields individually or use a `deepMergeInto` helper
