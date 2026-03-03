# Agent Instructions

## Rules

- **After implementing ANY new features:** Update `docs/PHASE-*.md` immediately — do not wait to be asked. Check every phase whose success criteria or task table is affected and update checkboxes + status lines in the same commit as the feature work.
- **Roadmap sync:** When `docs/PHASE-*.md` changes, update `website/src/pages/Roadmap.tsx` to match (`✓ Complete` → `"complete"`, `🚧 In Progress` → `"current"`, else `"upcoming"`).
- **Time estimates:** Machine time only ("one conversation", "~10 min"). Never quote human hours/days.
- **IDs:** Display tail — `...${id.slice(-8)}`.

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
