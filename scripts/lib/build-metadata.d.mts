export interface BuildMetadata {
  appVersion: string;
  buildKind: "release" | "snapshot" | "preview" | "local";
  commitSha: string | null;
  commitRef: string | null;
  deployedAt: string | null;
}

export function getBuildMetadata(
  appVersion: string,
  env?: NodeJS.ProcessEnv,
): BuildMetadata;
