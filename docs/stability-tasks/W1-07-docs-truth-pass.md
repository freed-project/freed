# W1-07: Docs truth pass: ARCHITECTURE.md, AGENTS.md roadmap rule, canonical soak doc

runner-safe: true | provider-visible: false | soak-gated: no

## Context

`docs/ARCHITECTURE.md` describes a system that was never shipped (browser-extension capture layer, WebRTC P2P sync, Bun workspaces, Dexie). Reality: Tauri 2 desktop with hidden-WebView scrapers + X GraphQL interception, Automerge worker + IndexedDB, WS relay to PWA, optional GDrive/Dropbox snapshot sync. Every agent that reads the doc for context starts wrong. Separately, the AGENTS.md roadmap-sync rule points at `website/src/pages/Roadmap.tsx`, which does not exist (the roadmap lives at `website/src/app/roadmap/`), and soak/trigger rules are quintuplicated across AGENTS.md, NIGHTLY-SELF-IMPROVE.md, and three skills.

## Change

1. Rewrite ARCHITECTURE.md from current code: package layout and boundaries (mirror AGENTS.md table), capture strategies per provider, Automerge worker + persistence + relay + cloud sync data flow (including known program-tracked limitations, linking docs/STABILITY-PROGRAM.md), watchdog/recovery overview, release lanes. Keep it accurate and dated; no aspirational content.
2. Fix the AGENTS.md roadmap rule to the real path and the real update procedure (or delete the rule if roadmap sync is now handled elsewhere; verify first).
3. Create `docs/SOAK-AND-TRIGGERS.md` as the single canonical statement of installed-soak rules, dev-sync-trigger usage, locked-machine behavior, and the 10-minute-timeout contract; replace the duplicated prose in AGENTS.md and the skills with a pointer plus a one-line summary each.

## Verify

- Grep: no references to WebRTC/Dexie/extensions remain in ARCHITECTURE.md; roadmap rule path exists.
- The skills and AGENTS.md reference the canonical soak doc instead of restating it (diff shows net prose deletion).
