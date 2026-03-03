# Desktop Component Index

**Before creating a new component, check this list.**
If what you need already exists, import it. If you create something new, add it here.

## Cloud Sync

| File | Purpose |
|---|---|
| `CloudProviderCard.tsx` | **Single source of truth** for the Dropbox/GDrive card UI: icon SVGs, labels, detail copy, connect/disconnect buttons. Used by both the onboarding dialog and the Settings tab. Never duplicate inline. |
| `CloudSyncSetupDialog.tsx` | Full-screen onboarding overlay. Thin wrapper over `CloudProviderCard` + `useCloudProviders`. |
| `CloudSyncNudge.tsx` | Bottom toast shown every launch while no provider is connected. Session-dismissable. |
| `hooks/useCloudProviders.ts` | **Single source of truth** for cloud connect/disconnect state machine. Used by both dialog and Settings tab. Never re-implement inline. |

## X / Twitter

| File | Purpose |
|---|---|
| `XAuthSection.tsx` | Sidebar widget: connect, sync now, disconnect. Rendered via `SidebarConnectionSection` in `PlatformConfig`. |
| `XFeedEmptyState.tsx` | Empty-state CTA shown in the X feed when not connected. |
| `XSourceIndicator.tsx` | Sidebar source row indicator for the X platform filter. |

## Sync / Pairing

| File | Purpose |
|---|---|
| `MobileSyncTab.tsx` | Settings section: Cloud Sync tab (uses `CloudProviderCard`), QR tab, Manual tab, connected-devices count, pairing token reset, mDNS status. |
| `DesktopSyncIndicator.tsx` | Header indicator showing sync state and connected client count. |

## App Shell

| File | Purpose |
|---|---|
| `UpdateNotification.tsx` | Background auto-update poller + download/relaunch UI. |
| `CloudSyncSetupDialog.tsx` | See above. |
