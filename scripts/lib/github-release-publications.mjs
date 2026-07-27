import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

export const GITHUB_RELEASE_PAGE_SIZE = 100;
export const MAX_GITHUB_RELEASE_PAGES = 50;
export const GITHUB_RELEASE_PAGE_MAX_BYTES = 16 * 1024 * 1024;

function githubBinary(environment) {
  const candidates = [
    environment.GH_BIN,
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? "gh";
}

function validToken(value) {
  const token = String(value ?? "").trim();
  if (!token || /[\r\n"\\]/.test(token)) {
    return null;
  }
  return token;
}

export function resolveGithubReadToken({
  environment = process.env,
  execFile = execFileSync,
  ghBinary = githubBinary(environment),
} = {}) {
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const token = validToken(environment[name]);
    if (token) {
      return token;
    }
  }

  try {
    const token = validToken(
      execFile(ghBinary, ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      }),
    );
    if (token) {
      return token;
    }
  } catch (error) {
    throw new Error(
      `Authenticated GitHub release reads require GH_TOKEN, GITHUB_TOKEN, or gh auth: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }

  throw new Error(
    "Authenticated GitHub release reads require GH_TOKEN, GITHUB_TOKEN, or gh auth.",
  );
}

function requestFailure(result) {
  return (
    result.stderr?.trim() ||
    result.error?.message ||
    (result.signal ? `terminated by ${result.signal}` : "curl failed")
  );
}

export function readGithubReleasePublications({
  repository = "freed-project/freed",
  environment = process.env,
  execFile = execFileSync,
  spawn = spawnSync,
  curlBinary = "/usr/bin/curl",
  projectRelease = (release) => release,
} = {}) {
  const token = resolveGithubReadToken({ environment, execFile });

  const readPass = ({ collect }) => {
    const releases = [];
    const pageDigests = [];
    const seenIds = new Set();
    const seenTags = new Set();

    for (let page = 1; page <= MAX_GITHUB_RELEASE_PAGES; page += 1) {
      const result = spawn(
        curlBinary,
        [
          "--disable",
          "--fail",
          "--silent",
          "--show-error",
          "--proto",
          "=https",
          "--tlsv1.2",
          "--config",
          "-",
          "--connect-timeout",
          "10",
          "--max-time",
          "30",
          "--retry",
          "2",
          "--retry-all-errors",
          "--header",
          "Accept: application/vnd.github+json",
          "--header",
          "X-GitHub-Api-Version: 2022-11-28",
          `https://api.github.com/repos/${repository}/releases?per_page=${GITHUB_RELEASE_PAGE_SIZE}&page=${page}`,
        ],
        {
          encoding: "utf8",
          input: `header = "Authorization: Bearer ${token}"\n`,
          timeout: 35_000,
          maxBuffer: GITHUB_RELEASE_PAGE_MAX_BYTES,
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `Could not read canonical GitHub release publications: ${requestFailure(result)}.`,
        );
      }

      let pageReleases;
      try {
        pageReleases = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          "Canonical GitHub release publication response is invalid JSON.",
        );
      }
      if (!Array.isArray(pageReleases)) {
        throw new Error(
          "Canonical GitHub release publication response must be an array.",
        );
      }

      pageDigests.push(
        createHash("sha256").update(result.stdout).digest("hex"),
      );
      for (const release of pageReleases) {
        const releaseId = String(release?.id ?? "").trim();
        const releaseTag = String(release?.tag_name ?? "").trim();
        if (!releaseId || !releaseTag) {
          throw new Error(
            "Canonical GitHub release publication is missing its ID or tag.",
          );
        }
        if (seenIds.has(releaseId) || seenTags.has(releaseTag)) {
          throw new Error(
            `Canonical GitHub release publication history contains a duplicate ID or tag at ${releaseTag}.`,
          );
        }
        seenIds.add(releaseId);
        seenTags.add(releaseTag);
      }
      if (collect) {
        releases.push(...pageReleases.map(projectRelease));
      }
      if (pageReleases.length < GITHUB_RELEASE_PAGE_SIZE) {
        return { releases, pageDigests };
      }
    }

    throw new Error(
      `Canonical GitHub release publication history exceeds ${MAX_GITHUB_RELEASE_PAGES.toLocaleString()} pages.`,
    );
  };

  const firstPass = readPass({ collect: true });
  const verificationPass = readPass({ collect: false });
  if (
    firstPass.pageDigests.length !== verificationPass.pageDigests.length ||
    firstPass.pageDigests.some(
      (digest, index) => digest !== verificationPass.pageDigests[index],
    )
  ) {
    throw new Error(
      "Canonical GitHub release publication history changed while it was being read.",
    );
  }
  return firstPass.releases;
}
