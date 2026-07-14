import { execFileSync } from "node:child_process";

export const CARGO_LOCK_PATH = "packages/desktop/src-tauri/Cargo.lock";
const DESKTOP_CARGO_PACKAGE = "freed-desktop";

function readGitFile(ref, filePath, { cwd } = {}) {
  return execFileSync("git", ["show", `${ref}:${filePath}`], {
    cwd,
    encoding: "utf8",
  });
}

function normalizeCargoLockPackageVersion(contents, packageName) {
  const lines = contents.replace(/\r\n?/g, "\n").split("\n");
  const packages = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "[[package]]") continue;

    let end = index + 1;
    while (
      end < lines.length &&
      !/^\s*\[\[?[^\]]+\]\]?\s*$/.test(lines[end])
    ) {
      end += 1;
    }

    let name = null;
    let version = null;
    let versionLine = -1;
    for (let lineIndex = index + 1; lineIndex < end; lineIndex += 1) {
      const nameMatch = lines[lineIndex].match(
        /^\s*name\s*=\s*"([^"]+)"\s*$/,
      );
      if (nameMatch) name = nameMatch[1];

      const versionMatch = lines[lineIndex].match(
        /^\s*version\s*=\s*"([^"]+)"\s*$/,
      );
      if (versionMatch) {
        version = versionMatch[1];
        versionLine = lineIndex;
      }
    }

    if (name === packageName) {
      packages.push({ version, versionLine });
    }
    index = end - 1;
  }

  if (packages.length !== 1 || packages[0].versionLine < 0) {
    throw new Error(
      `Cargo.lock must contain exactly one ${packageName} package with a version.`,
    );
  }

  const [entry] = packages;
  lines[entry.versionLine] = 'version = "<release-version>"';
  return {
    version: entry.version,
    normalizedContents: lines.join("\n"),
  };
}

export function inspectCargoLockReleaseChange({
  fromRef,
  toRef,
  cwd,
  expectedVersion = null,
}) {
  try {
    const before = normalizeCargoLockPackageVersion(
      readGitFile(fromRef, CARGO_LOCK_PATH, { cwd }),
      DESKTOP_CARGO_PACKAGE,
    );
    const after = normalizeCargoLockPackageVersion(
      readGitFile(toRef, CARGO_LOCK_PATH, { cwd }),
      DESKTOP_CARGO_PACKAGE,
    );
    const versionMatches =
      expectedVersion === null || after.version === expectedVersion;
    const contentMatches =
      before.normalizedContents === after.normalizedContents;

    return {
      ok: versionMatches && contentMatches,
      beforeVersion: before.version,
      afterVersion: after.version,
      versionMatches,
      contentMatches,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      beforeVersion: null,
      afterVersion: null,
      versionMatches: false,
      contentMatches: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
