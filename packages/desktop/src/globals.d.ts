/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GDRIVE_DESKTOP_CLIENT_ID: string;
  readonly VITE_DROPBOX_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_VERSION__: string;
}
export {};
