export type BuildKind = "release" | "snapshot" | "preview" | "local";

export interface BuildMetadata {
  appVersion: string;
  buildKind: BuildKind;
  commitSha: string | null;
  commitRef: string | null;
  deployedAt: string | null;
}

export interface InstalledBuildPresentation {
  badgeLabel: string;
  detail: string;
}

function formatBuildTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shortenCommitSha(commitSha: string | null): string | null {
  if (!commitSha) {
    return null;
  }

  return commitSha.slice(0, 7);
}

function joinDetailParts(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

export function readBuildMetadata(): BuildMetadata {
  return {
    appVersion: __APP_VERSION__,
    buildKind: __BUILD_KIND__,
    commitSha: __BUILD_COMMIT_SHA__,
    commitRef: __BUILD_COMMIT_REF__,
    deployedAt: __BUILD_DEPLOYED_AT__,
  };
}

export function describeInstalledBuild(
  metadata: BuildMetadata,
): InstalledBuildPresentation | null {
  const shortSha = shortenCommitSha(metadata.commitSha);
  const formattedTimestamp = formatBuildTimestamp(metadata.deployedAt);

  if (metadata.buildKind === "release") {
    if (metadata.commitRef !== "dev") {
      return null;
    }

    return {
      badgeLabel: "Dev release",
      detail: joinDetailParts([
        "Built from the latest dev release",
        shortSha,
        formattedTimestamp,
      ]),
    };
  }

  if (metadata.buildKind === "snapshot") {
    return {
      badgeLabel: "Dev snapshot",
      detail: joinDetailParts([
        "Built after the latest dev release",
        shortSha,
        formattedTimestamp,
      ]),
    };
  }

  if (metadata.buildKind === "preview") {
    return {
      badgeLabel: "Preview build",
      detail: joinDetailParts([
        metadata.commitRef ? `Branch ${metadata.commitRef}` : null,
        shortSha,
        formattedTimestamp,
      ]),
    };
  }

  return null;
}
