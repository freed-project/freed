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
