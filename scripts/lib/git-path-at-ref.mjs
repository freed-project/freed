import { spawnSync } from "node:child_process";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const TREE_ENTRY_PATTERN =
  /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40,64})\t([^\0]+)\0$/;

function commandFailure(result) {
  return (
    result.stderr?.trim() ||
    result.error?.message ||
    (result.signal ? `terminated by ${result.signal}` : "git failed")
  );
}

function runGit(spawn, cwd, args) {
  return spawn("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function readGitPathAtRef({ cwd, ref, filePath, spawn = spawnSync }) {
  const normalizedRef = String(ref ?? "").trim();
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedRef) {
    throw new Error("Git path inspection requires a ref.");
  }
  if (
    !normalizedPath ||
    normalizedPath.startsWith("/") ||
    normalizedPath.includes("\0")
  ) {
    throw new Error("Git path inspection requires a repository-relative path.");
  }

  const resolved = runGit(spawn, cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${normalizedRef}^{commit}`,
  ]);
  const commitSha = String(resolved.stdout ?? "").trim();
  if (resolved.status !== 0 || !FULL_COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(
      `Could not resolve Git ref ${normalizedRef}: ${commandFailure(resolved)}.`,
    );
  }

  const treeResult = runGit(spawn, cwd, [
    "ls-tree",
    "-z",
    "--full-tree",
    commitSha,
    "--",
    normalizedPath,
  ]);
  if (treeResult.status !== 0) {
    throw new Error(
      `Could not inspect ${normalizedPath} at ${normalizedRef}: ${commandFailure(treeResult)}.`,
    );
  }
  if (treeResult.stdout === "") {
    return {
      state: "absent",
      commitSha,
      filePath: normalizedPath,
    };
  }

  const entry = TREE_ENTRY_PATTERN.exec(String(treeResult.stdout ?? ""));
  if (!entry || entry[4] !== normalizedPath) {
    throw new Error(
      `Git tree entry for ${normalizedPath} at ${normalizedRef} is malformed.`,
    );
  }
  if (entry[2] !== "blob") {
    throw new Error(
      `Git path ${normalizedPath} at ${normalizedRef} is ${entry[2]}, expected blob.`,
    );
  }

  const objectId = entry[3];
  const contentsResult = runGit(spawn, cwd, ["cat-file", "blob", objectId]);
  if (contentsResult.status !== 0) {
    throw new Error(
      `Could not read ${normalizedPath} at ${normalizedRef}: ${commandFailure(contentsResult)}.`,
    );
  }

  return {
    state: "present",
    commitSha,
    filePath: normalizedPath,
    objectId,
    contents: String(contentsResult.stdout ?? ""),
  };
}
