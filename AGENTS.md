# Agent Instructions

## CRITICAL

### Automerge Mutations

Mutations require `change()` wrapper—direct mutation silently fails to sync:

```typescript
doc.change((d) => {
  d.items.push(item);
}); // ✅ syncs
doc.items.push(item); // ❌ silent failure
```

### Package Boundaries

```
packages/
├── shared/       → @freed/shared   │ Types + pure functions. Zero runtime dependencies.
├── sync/         → @freed/sync     │ Storage-agnostic. Works in browser (IndexedDB) AND Node (filesystem).
├── pwa/          → @freed/pwa      │ Primary UI. Must never import Tauri APIs.
├── desktop/      → @freed/desktop  │ Tauri shell. Imports from @freed/pwa.
├── capture-*/    →                 │ Isolated. Never import between capture packages.
```

## Automerge Schema

Location: `packages/shared/src/schema.ts`

**Schema changes must be backward-compatible.** Add optional fields with defaults. Never delete fields—mark `@deprecated`.

## Conventions

**Time estimates:** Express in machine time (how long the agent will take), not human hours. Examples: "one focused conversation," "~10 minutes of edits," "a quick refactor." Never quote hours/days as if a human were doing the work.

**ID fragments:** Display tail, not head—`...${id.slice(-8)}` (better entropy).

## Triggered Updates

When modifying `README.md`, `docs/PHASE-*.md`, or `docs/ROADMAP.md`:

→ Update `website/src/pages/Roadmap.tsx` in the same commit.

| Doc Status       | Roadmap `status` |
| ---------------- | ---------------- |
| `✓ Complete`     | `"complete"`     |
| `🚧 In Progress` | `"current"`      |
| Otherwise        | `"upcoming"`     |

**After implementing ANY new features:** Update `docs/PHASE-*.md` immediately — do not wait to be asked. Check every phase whose success criteria or task table is affected and update checkboxes + status lines in the same commit as the feature work.
