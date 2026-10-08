import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "node:url";
import {
  groupReleasesByDay,
  normalizeGitHubReleases,
  parseReleaseBody,
  type ParsedRelease,
  type ReleaseBuild,
  type ReleaseChannel,
  type ReleaseItem,
} from "../src/content/changelog";

const OUTPUT_PATH = join(process.cwd(), "src/content/changelog.generated.json");
const RELEASE_NOTES_ROOT = join(process.cwd(), "..", "release-notes");
const RELEASE_NOTES_RELEASES_DIR = join(RELEASE_NOTES_ROOT, "releases");
const GITHUB_RELEASE_PAGE_SIZE = 100;
const authToken =
  process.env.GITHUB_RELEASES_TOKEN ??
  process.env.GITHUB_TOKEN ??
  process.env.GH_TOKEN ??
  process.env.RELEASE_GITHUB_TOKEN;
const API_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (authToken) {
  API_HEADERS.Authorization = `Bearer ${authToken}`;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

interface LocalReleaseArtifact {
  tag: string;
  version: string;
  dayKey: string;
  approved?: boolean;
  source?: {
    previousPublishedTag?: string;
    prNumbers?: number[];
    relatedBuildTags?: string[];
  };
  release?: {
    deck?: string;
    features?: ReleaseArtifactItem[];
    fixes?: ReleaseArtifactItem[];
    followUps?: ReleaseArtifactItem[];
    summary?: string;
    whatsNew?: ReleaseArtifactItem[];
    performance?: ReleaseArtifactItem[];
  };
}

type ReleaseArtifactItem = string | { text?: unknown };

interface GitHubCompare {
  commits: Array<{
    sha: string;
    commit: {
      message: string;
    };
  }>;
}

function dedupeItems(items: ReleaseItem[]): ReleaseItem[] {
  const deduped = new Map<string, ReleaseItem>();

  for (const item of items) {
    const key = item.text.toLowerCase();
    const existing = deduped.get(key);

    if (!existing || (!existing.prNumber && item.prNumber)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

function getReleaseItemText(item: ReleaseArtifactItem): string | null {
  if (typeof item === "string") {
    return item;
  }

  if (item && typeof item.text === "string") {
    return item.text;
  }

  return null;
}

export function toReleaseItems(
  items: ReleaseArtifactItem[] | undefined,
): ReleaseItem[] {
  return dedupeItems(
    (items ?? [])
      .map(getReleaseItemText)
      .filter((text): text is string => Boolean(text?.trim()))
      .map((text) => {
        const trimmed = text.trim();
        if (/\[#\d+\]\(https:\/\/github\.com\/freed-project\/freed\/pull\/\d+\)/.test(trimmed)) {
          return parseReleaseBody(`### Features\n- ${trimmed}`).features[0] ?? { text: trimmed };
        }
        return { text: trimmed };
      }),
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];

  for (let page = 1; ; page += 1) {
    const pageReleases = await fetchJson<GitHubRelease[]>(
      `https://api.github.com/repos/freed-project/freed/releases?per_page=${GITHUB_RELEASE_PAGE_SIZE.toLocaleString(
        "en-US",
        { useGrouping: false },
      )}&page=${page.toLocaleString("en-US", { useGrouping: false })}`,
    );

    releases.push(...pageReleases);

    if (pageReleases.length < GITHUB_RELEASE_PAGE_SIZE) {
      return releases;
    }
  }
}

function extractPrNumbersFromText(text: string): number[] {
  return [...text.matchAll(/(?:#|\/pull\/)(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((num) => Number.isInteger(num) && num > 0);
}

export async function fetchComparePrNumbers(
  baseTag: string | undefined,
  headTag: string,
): Promise<number[]> {
  if (!baseTag || baseTag === headTag) return [];
  const commits: GitHubCompare["commits"] = [];
  for (let page = 1; ; page += 1) {
    const compare = await fetchJson<GitHubCompare>(
      `https://api.github.com/repos/freed-project/freed/compare/${encodeURIComponent(baseTag)}...${encodeURIComponent(headTag)}?per_page=100&page=${page}`,
    );
    commits.push(...compare.commits);
    if (compare.commits.length < 100) break;
  }
  const numbers = commits.flatMap((commit) =>
    extractPrNumbersFromText(commit.commit.message),
  );
  if (numbers.length) return numbers;

  // Custom squash subjects can omit PR numbers. GitHub retains the association.
  for (const commit of commits) {
    for (let page = 1; ; page += 1) {
      const pulls = await fetchJson<
        Array<{ number: number; merged_at: string | null }>
      >(
        `https://api.github.com/repos/freed-project/freed/commits/${commit.sha}/pulls?per_page=100&page=${page}`,
      );
      numbers.push(
        ...pulls.filter((pull) => pull.merged_at).map((pull) => pull.number),
      );
      if (pulls.length < 100) break;
    }
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function readLocalReleaseArtifacts(): Map<string, LocalReleaseArtifact> {
  const artifacts = new Map<string, LocalReleaseArtifact>();

  if (!existsSync(RELEASE_NOTES_RELEASES_DIR)) {
    return artifacts;
  }

  for (const file of readdirSync(RELEASE_NOTES_RELEASES_DIR)) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const artifact = JSON.parse(
      readFileSync(join(RELEASE_NOTES_RELEASES_DIR, file), "utf8"),
    ) as LocalReleaseArtifact;

    if (artifact?.tag) {
      artifacts.set(artifact.tag, artifact);
    }
  }

  return artifacts;
}

function buildLinksFromArtifact(
  artifact: LocalReleaseArtifact,
  release: GitHubRelease,
  releaseMap: Map<string, GitHubRelease>,
): ReleaseBuild[] {
  const relatedBuildTags = artifact.source?.relatedBuildTags ?? [];
  const buildLinks = relatedBuildTags
    .map((tag) => releaseMap.get(tag))
    .filter((candidate): candidate is GitHubRelease => Boolean(candidate))
    .map((candidate) => ({
      version: candidate.tag_name.replace(/^v/, ""),
      htmlUrl: candidate.html_url,
      channel: (candidate.tag_name.endsWith("-dev")
        ? "dev"
        : "production") as ReleaseChannel,
    }));

  if (buildLinks.length > 0) {
    return buildLinks;
  }

  return [
    {
      version: artifact.version || release.tag_name.replace(/^v/, ""),
      htmlUrl: release.html_url,
      channel: (release.tag_name.endsWith("-dev")
        ? "dev"
        : "production") as ReleaseChannel,
    },
  ];
}

async function collectPrNumbersFromArtifact(
  artifact: LocalReleaseArtifact,
  release: GitHubRelease,
  localReleaseArtifacts: Map<string, LocalReleaseArtifact>,
): Promise<number[]> {
  const prNumbers = new Set(artifact.source?.prNumbers ?? []);

  for (const relatedTag of artifact.source?.relatedBuildTags ?? []) {
    const relatedArtifact = localReleaseArtifacts.get(relatedTag);
    for (const prNumber of relatedArtifact?.source?.prNumbers ?? []) {
      prNumbers.add(prNumber);
    }
  }

  if (prNumbers.size === 0 && artifact.source?.previousPublishedTag) {
    for (const prNumber of await fetchComparePrNumbers(
      artifact.source.previousPublishedTag,
      release.tag_name,
    )) {
      prNumbers.add(prNumber);
    }
  }

  return [...prNumbers].sort((a, b) => a - b);
}

async function releaseFromLocalArtifact(
  artifact: LocalReleaseArtifact,
  release: GitHubRelease,
  releaseMap: Map<string, GitHubRelease>,
  localReleaseArtifacts: Map<string, LocalReleaseArtifact>,
): Promise<ParsedRelease> {
  const releaseShape = artifact.release ?? {};
  const version = artifact.version || release.tag_name.replace(/^v/, "");
  const channel: ReleaseChannel = release.tag_name.endsWith("-dev")
    ? "dev"
    : "production";
  const features = toReleaseItems(
    releaseShape.features ?? releaseShape.whatsNew,
  );
  const fixes = toReleaseItems(releaseShape.fixes);
  const followUps = toReleaseItems([
    ...(releaseShape.followUps ?? []),
    ...(releaseShape.performance ?? []),
  ]);
  const buildLinks = buildLinksFromArtifact(artifact, release, releaseMap);

  return {
    version,
    tagName: release.tag_name,
    channel,
    date: release.published_at,
    deck: releaseShape.deck?.trim() || releaseShape.summary?.trim() || "",
    features,
    fixes,
    followUps,
    htmlUrl: release.html_url,
    prNumbers: await collectPrNumbersFromArtifact(
      artifact,
      release,
      localReleaseArtifacts,
    ),
    builds: buildLinks.map((build) => build.version),
    buildLinks,
  };
}

// Public tag contents travel with the release, regardless of the publishing machine.
// Local historical artifacts retain their reviewed editorial corrections.
export async function fetchPublishedArtifact(
  tag: string,
): Promise<LocalReleaseArtifact | null> {
  const url = `https://raw.githubusercontent.com/freed-project/freed/${encodeURIComponent(tag)}/release-notes/releases/${encodeURIComponent(tag)}.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null; // Early releases predate structured notes.
  if (!response.ok)
    throw new Error(
      `Release artifact request failed: ${response.status} ${tag}`,
    );
  const artifact = (await response.json()) as LocalReleaseArtifact;
  if (artifact.tag !== tag || artifact.approved !== true || !artifact.release) {
    throw new Error(`Missing approval or mismatched release artifact: ${tag}`);
  }
  return artifact;
}

export function assertReleaseCoverage(
  releases: { tag_name: string }[],
  snapshot: ParsedRelease[],
  expectedTag?: string,
): void {
  const builds = new Set(
    snapshot.flatMap((day) =>
      day.buildLinks.map((build) => `v${build.version}`),
    ),
  );
  const missing = releases
    .map((release) => release.tag_name)
    .filter((tag) => !builds.has(tag));
  if (
    expectedTag &&
    !releases.some((release) => release.tag_name === expectedTag)
  ) {
    throw new Error(`Expected release is not published: ${expectedTag}`);
  }
  if (missing.length)
    throw new Error(
      `Changelog is missing published builds: ${missing.join(", ")}`,
    );
}

async function fetchChangelog(): Promise<ParsedRelease[]> {
  const releases = await fetchGitHubReleases();
  const publishedReleases = normalizeGitHubReleases(releases);
  const releaseMap = new Map(
    releases
      .filter((release) => !release.draft)
      .map((release) => [release.tag_name, release]),
  );
  const artifacts = readLocalReleaseArtifacts();

  // Bound requests rather than sending the entire historical inventory at once.
  for (let offset = 0; offset < publishedReleases.length; offset += 6) {
    await Promise.all(
      publishedReleases.slice(offset, offset + 6).map(async (release) => {
        if (artifacts.has(release.tagName)) return;
        const artifact = await fetchPublishedArtifact(release.tagName);
        if (artifact) artifacts.set(release.tagName, artifact);
      }),
    );
  }
  const detailedReleases: ParsedRelease[] = [];
  for (const publishedRelease of publishedReleases) {
    const release = releaseMap.get(publishedRelease.tagName)!;
    const artifact = artifacts.get(release.tag_name);
    detailedReleases.push(
      artifact?.release
        ? await releaseFromLocalArtifact(
            artifact,
            release,
            releaseMap,
            artifacts,
          )
        : publishedRelease,
    );
  }
  const snapshot = groupReleasesByDay(detailedReleases);
  assertReleaseCoverage(
    publishedReleases.map((release) => ({ tag_name: release.tagName })),
    snapshot,
    process.env.CHANGELOG_EXPECT_TAG,
  );
  return snapshot;
}

function readExistingSnapshot(): ParsedRelease[] | null {
  if (!existsSync(OUTPUT_PATH)) {
    return null;
  }

  return JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as ParsedRelease[];
}

export async function generateChangelog() {
  try {
    const releases = await fetchChangelog();
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(releases, null, 2)}\n`);
    console.log(
      `✓ Generated changelog snapshot with ${releases.length.toLocaleString()} grouped days`,
    );
  } catch (error) {
    const existingSnapshot = readExistingSnapshot();
    if (
      existingSnapshot &&
      process.env.CHANGELOG_ALLOW_STALE === "1" &&
      !process.env.CHANGELOG_EXPECT_TAG
    ) {
      console.warn(
        `[generate-changelog] Using existing snapshot with ${existingSnapshot.length.toLocaleString()} grouped days because refresh failed.`,
      );
      console.warn(error);
      return;
    }

    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  generateChangelog().catch((error) => {
    console.error("[generate-changelog] Failed to build changelog snapshot.");
    console.error(error);
    process.exit(1);
  });
