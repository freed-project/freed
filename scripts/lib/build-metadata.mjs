const BUILD_KIND_VALUES = new Set(["release", "snapshot", "preview", "local"]);

function readEnvString(env, key) {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferBuildKind(env) {
  const explicit = readEnvString(env, "FREED_BUILD_KIND");
  if (explicit && BUILD_KIND_VALUES.has(explicit)) {
    return explicit;
  }

  const isVercelBuild = readEnvString(env, "VERCEL") === "1";
  const vercelEnv = readEnvString(env, "VERCEL_ENV");
  const commitRef = readEnvString(env, "VERCEL_GIT_COMMIT_REF");
  const commitMessage = readEnvString(env, "VERCEL_GIT_COMMIT_MESSAGE")?.toLowerCase() ?? "";
  const isReleaseCommit =
    /^release:\s/.test(commitMessage) ||
    /^docs:\sreview release notes for v/.test(commitMessage);

  if (!isVercelBuild) {
    return "local";
  }

  if (vercelEnv === "production") {
    return "release";
  }

  if (commitRef === "dev") {
    return isReleaseCommit ? "release" : "snapshot";
  }

  return "preview";
}

export function getBuildMetadata(appVersion, env = process.env) {
  return {
    appVersion,
    buildKind: inferBuildKind(env),
    commitSha: readEnvString(env, "VERCEL_GIT_COMMIT_SHA"),
    commitRef: readEnvString(env, "VERCEL_GIT_COMMIT_REF"),
    deployedAt: readEnvString(env, "FREED_BUILD_TIMESTAMP") ?? new Date().toISOString(),
  };
}
