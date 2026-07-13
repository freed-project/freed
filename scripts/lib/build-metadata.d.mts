export type BuildKind = "release" | "snapshot" | "preview" | "local";
export type BuildChannel = "dev" | "production";

export interface BuildMetadata {
  appVersion: string;
  buildKind: BuildKind;
  channel: BuildChannel;
  commitSha: string | null;
  commitRef: string | null;
  deployedAt: string;
}

export function getBuildMetadata(
  appVersion: string,
  env?: NodeJS.ProcessEnv,
): BuildMetadata;
