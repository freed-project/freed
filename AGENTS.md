# Agent Instructions

Guidelines for AI agents working on this codebase.

---

## Auto-Update: Public Roadmap

When modifying any of the following files, **you must also update the public roadmap** at `website/src/pages/Roadmap.tsx`:

### Trigger Files

- `README.md`
- `docs/PHASE-*.md` (any phase implementation document)
- `docs/ROADMAP.md`

### What to Sync

The `phases` array in `Roadmap.tsx` must reflect the current state of the phase docs:

| Phase Doc Field               | Roadmap.tsx Field                               |
| ----------------------------- | ----------------------------------------------- |
| Status line (`> **Status:**`) | `status: "complete" \| "current" \| "upcoming"` |
| Overview/description          | `description`                                   |
| Title                         | `title`                                         |

### Status Mapping

| Doc Status                             | Roadmap Status |
| -------------------------------------- | -------------- |
| `✓ Complete`                           | `"complete"`   |
| `🚧 In Progress`, `🚧 Nearly Complete` | `"current"`    |
| Everything else                        | `"upcoming"`   |

### Priority Flag

If a phase is marked as highest priority or currently active, set `priority: true` on the phase object.

### Example

If `docs/PHASE-1-FOUNDATION.md` changes from:

```markdown
> **Status:** ✓ Complete
```

to:

```markdown
> **Status:** 🚧 Nearly Complete
```

Then update `Roadmap.tsx`:

```typescript
{
  number: 1,
  title: "Foundation",
  description: "Marketing site, monorepo, Automerge schema, CI/CD.",
  status: "current",  // Changed from "complete"
  // ...
}
```

---

## Commit Guidelines

- Keep phase doc updates and roadmap updates in the same commit
- Use descriptive commit messages that reference both the doc and UI change
