# Shared UI Instructions

Apply these rules to work under `packages/ui/` in addition to the repository instructions.

## Boundaries

- Keep this package platform-agnostic. It may import `@freed/shared`, but not platform stores, Tauri APIs, service-worker logic, or `@freed/sync`.
- Read the shared [visual contracts](../../.agents/skills/freed-ui-polish/references/visual-contracts.md) before changing UI.

For an iterative queue of small visual adjustments, use `freed-ui-polish` and keep the rendered preview at the user-review checkpoint.
