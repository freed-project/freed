# @freed/desktop

Native macOS/Windows/Linux desktop application built with Tauri.

## Prerequisites

- **Node.js** 18+
- **Rust** 1.70+ (install via `curl https://sh.rustup.rs -sSf | sh`)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)

## Development

```bash
# Install dependencies in the current worktree
../../scripts/worktree-bootstrap.sh ../.. --target desktop

# Start the default mocked desktop preview
../../scripts/worktree-preview.sh desktop

# Start native Tauri only when native behavior matters
../../scripts/worktree-preview.sh desktop --native

# Build for production
npm run tauri:build
```

### Installed sync soaks without focus theft

Use the file trigger when an installed development build needs a provider sync soak from the terminal. This avoids System Events clicks and keeps the user's current app focus alone.

```bash
# Build a development soak build with the terminal trigger enabled
VITE_ENABLE_DEV_SYNC_TRIGGERS=1 npm run tauri:build

# After installing and launching that build, trigger the normal in-app path
node ../../scripts/dev-sync-trigger.mjs facebook
node ../../scripts/dev-sync-trigger.mjs instagram
node ../../scripts/dev-sync-trigger.mjs linkedin

# Watch local runtime evidence while the app runs
tail -f "$HOME/Library/Application Support/wtf.freed.desktop/runtime-health.jsonl"
```

The trigger is intentionally dev-only. Local soak builds can enable it with `VITE_ENABLE_DEV_SYNC_TRIGGERS=1`, and GitHub dev-channel prereleases compile it in automatically for installed-build soaks. It still uses the same social refresh path as the UI, including auth checks, provider pause state, cooldowns, and rate limits. Production builds keep the reliability and memory recovery behavior, but should not expose a raw app-data file that lets another local process start authenticated Facebook, Instagram, or LinkedIn traffic without a user-facing permission model.

For long-running background validation, do not block the run until morning because the next step needs a UI button. Add a dev-only trigger when the action will be reused. If a one-off foreground click is still the fastest correct test, ask with a 10 minute window and continue if no response arrives.

## Building

### Debug build (faster, larger)

```bash
npm run tauri:build -- --no-bundle
```

The binary will be at `src-tauri/target/release/freed-desktop`

### Release build (bundled app)

```bash
npm run tauri:build
```

The macOS app bundle will be at `src-tauri/target/release/bundle/macos/Freed.app`

## Architecture

This desktop app:

1. **Embeds the PWA** - React UI shared with `@freed/pwa`
2. **Hosts the sync relay** - WebSocket server for LAN sync
3. **Runs ranking** - Computes `priority` scores for feed items
4. **Executes capture** - TypeScript capture layers via subprocess

## Configuration

Edit `src-tauri/tauri.conf.json` to customize:

- Window appearance (transparent, decorations)
- App metadata (name, version, identifier)
- macOS private API (vibrancy effects)

## Features

- **Liquid Glass UI** - macOS vibrancy effect for native look
- **Frameless window** - Custom title bar with traffic lights
- **Local-first** - All data stored on device
- **Cross-device sync** - Via WebSocket relay on LAN
