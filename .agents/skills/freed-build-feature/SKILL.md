---
name: freed-build-feature
description: Scaffold a feature branch in a worktree, plan the implementation, build it, and launch a live preview. Use when starting work on a new feature.
disable-model-invocation: true
---

# Build Feature

Create a new worktree branch from main, plan the feature, implement it, and launch a live preview.

## Workflow

1. Create a new worktree branch from `main` using `./scripts/worktree-add.sh`.
2. Activate planning mode and prepare an implementation plan for the feature described by the user.
3. Implement the feature according to the plan.
4. Launch a live preview so the user can test it:
   - For web/PWA features: start a PWA dev server. If the standard preview port is in use (likely another agent in another worktree), find an available port instead of killing the existing one.
   - For desktop-specific features: launch a Tauri dev preview instead.
