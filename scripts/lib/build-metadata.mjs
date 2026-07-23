const BUILD_KIND_VALUES = new Set(["release", "snapshot", "preview", "local"]);
const BUILD_CHANNEL_VALUES = new Set(["dev", "production"]);

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
  const commitMessage =
    readEnvString(env, "VERCEL_GIT_COMMIT_MESSAGE")?.toLowerCase() ?? "";
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

function inferBuildChannel(appVersion, buildKind, commitRef, env) {
  const explicit = readEnvString(env, "FREED_BUILD_CHANNEL");
  if (explicit) {
    if (!BUILD_CHANNEL_VALUES.has(explicit)) {
      throw new Error(
        `FREED_BUILD_CHANNEL must be dev or production, received ${explicit}.`,
      );
    }
    return explicit;
  }

  if (
    appVersion.endsWith("-dev") ||
    commitRef === "dev" ||
    commitRef?.endsWith("-dev") ||
    buildKind !== "release"
  ) {
    return "dev";
  }

  return "production";
}

export function getBuildMetadata(appVersion, env = process.env) {
  const buildKind = inferBuildKind(env);
  const commitRef =
    readEnvString(env, "FREED_BUILD_COMMIT_REF") ??
    readEnvString(env, "VERCEL_GIT_COMMIT_REF") ??
    readEnvString(env, "GITHUB_REF_NAME");
  return {
    appVersion,
    buildKind,
    channel: inferBuildChannel(appVersion, buildKind, commitRef, env),
    commitSha:
      readEnvString(env, "FREED_BUILD_COMMIT_SHA") ??
      readEnvString(env, "VERCEL_GIT_COMMIT_SHA") ??
      readEnvString(env, "GITHUB_SHA"),
    commitRef,
    deployedAt:
      readEnvString(env, "FREED_BUILD_TIMESTAMP") ?? new Date().toISOString(),
  };
}
