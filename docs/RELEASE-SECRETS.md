# Release Secrets Setup

The desktop release workflow (`.github/workflows/release.yml`) requires
certain secrets to be configured in the GitHub repository settings.

## Required (for any release)

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/freed.key`. Used to sign update artifacts so the in-app updater can verify them. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key. Empty string if generated without one. |

The corresponding **public key** is already embedded in
`packages/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

## macOS Code Signing + Notarization (deferred)

Without these, macOS builds will run but produce unsigned DMGs. Users must
right-click -> Open or run `xattr -cr Freed.app` to bypass Gatekeeper.

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_PASSWORD` | App-specific password for notarization (generate at appleid.apple.com) |

### How to export the certificate

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click -> Export Items -> save as `.p12`
4. Base64-encode: `base64 -i certificate.p12 | pbcopy`
5. Paste into the `APPLE_CERTIFICATE` secret

## Windows Code Signing (deferred)

Without these, Windows builds produce unsigned NSIS installers. SmartScreen
will show a warning on first download until the binary builds reputation or
an EV certificate is used.

Options:
- **Azure Key Vault** with `relic` for EV code signing
- **SignPath** (free for open source)
- **SSL.com** cloud-hosted EV certificates

## Adding Secrets to GitHub

1. Go to `github.com/freed-project/freed/settings/secrets/actions`
2. Click "New repository secret"
3. Add each secret listed above

## How to trigger a release

```bash
./scripts/release.sh 0.2.0
git push origin main --follow-tags
```

This bumps versions, tags the commit, and pushes. The `v*` tag triggers the
release workflow which builds all platforms and creates a **draft** GitHub
Release. Review the draft, then click "Publish" to make it live. The in-app
updater will pick it up automatically.
