declare global {
  const __APP_VERSION__: string;
  const __BUILD_KIND__: "release" | "snapshot" | "preview" | "local";
  const __BUILD_COMMIT_SHA__: string | null;
  const __BUILD_COMMIT_REF__: string | null;
  const __BUILD_DEPLOYED_AT__: string | null;
}

declare module "*.css";

export {};
