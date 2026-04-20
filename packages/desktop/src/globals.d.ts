/// <reference types="vite/client" />

/**
 * Global type augmentations for the Freed Desktop app.
 *
 * This file is a module (export {} below) so all augmentations must live
 * inside declare global {}. The triple-slash reference above pulls in the
 * vite/client types when Vite is installed; the declare global block below
 * ensures the same surface is present in plain tsc runs (e.g. IDE or CI
 * without Vite in the resolution path).
 */

declare global {
  interface ImportMetaEnv {
    /** Google Drive OAuth client ID for the desktop app. */
    readonly VITE_GDRIVE_DESKTOP_CLIENT_ID: string;
    /** Dropbox OAuth app key for the desktop app. */
    readonly VITE_DROPBOX_CLIENT_ID: string;
    /**
     * Catch-all index signature matching vite/client's ImportMetaEnv.
     * Required so that VITE_TEST_TAURI, DEV, MODE, etc. are accessible
     * without triggering TS2339 when vite/client is not in the resolution
     * path (e.g. plain tsc, or IDE before bun install has run).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly [key: string]: any;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  const __APP_VERSION__: string;
  const __BUILD_KIND__: "release" | "snapshot" | "preview" | "local";
  const __BUILD_COMMIT_SHA__: string | null;
  const __BUILD_COMMIT_REF__: string | null;
  const __BUILD_DEPLOYED_AT__: string | null;
}

export {};
