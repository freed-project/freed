export type BuildKind = "release" | "snapshot" | "preview" | "local";

export interface BuildMetadata {
  appVersion: string;
  buildKind: BuildKind;
  commitSha: string | null;
  commitRef: string | null;
  deployedAt: string;
}

export function getBuildMetadata(
  appVersion: string,
  env?: NodeJS.ProcessEnv,
): BuildMetadata;
