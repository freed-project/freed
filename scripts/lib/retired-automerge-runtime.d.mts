export interface RetiredAutomergeArtifactSummary {
  readonly files: number;
  readonly bytes: number;
}

export declare const RETIRED_LIBRARY_CORE_PUBLIC_MODULES: readonly string[];

export declare function assertNoRetiredAutomergeRollupBundle(
  bundle: unknown,
  surface: "desktop" | "pwa",
): void;

export declare function assertNoRetiredAutomergeArtifactDirectory(
  rootDirectory: string,
  surface: "desktop" | "pwa",
): RetiredAutomergeArtifactSummary;

export declare function assertNoRetiredLibraryCorePublicExports(
  repoRoot: string,
): void;
