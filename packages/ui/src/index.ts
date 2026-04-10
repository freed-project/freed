/**
 * @freed/ui — Platform-agnostic UI layer for Freed
 *
 * Ships raw TypeScript source; consumers (pwa, desktop) compile and
 * tree-shake via their own Vite pipelines. Tailwind classes are processed
 * by each consumer's PostCSS pass — add `../ui/src/**` to your
 * tailwind.config.js `content` array.
 *
 * Package boundaries:
 *  - May import from @freed/shared
 *  - No PWA-specific libs (no service worker, no jsQR, no @freed/sync)
 *  - No platform store imports — consume state via PlatformContext only
 */

export * from "./context/index.js";
export * from "./components/feed/index.js";
export { AppShell } from "./components/layout/index.js";
export { BottomSheet } from "./components/BottomSheet.js";
export { PullToRefresh } from "./components/PullToRefresh.js";
export { ToastContainer, useToastStore, toast } from "./components/Toast.js";
export type { ToastType } from "./components/Toast.js";
export { SettingsToggle } from "./components/SettingsToggle.js";
export { AddFeedDialog } from "./components/AddFeedDialog.js";
export { SettingsDialog } from "./components/SettingsDialog.js";
export { BugReportBoundary } from "./components/BugReportBoundary.js";
export { FatalErrorScreen } from "./components/FatalErrorScreen.js";
export { LegalGate } from "./components/legal/LegalGate.js";
export { ProviderRiskDialog } from "./components/legal/ProviderRiskDialog.js";
export { useSettingsStore } from "./lib/settings-store.js";
export * from "./lib/bug-report.js";
