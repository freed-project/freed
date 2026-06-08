import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  groupReleasesByDay,
  normalizeGitHubReleases,
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

function toReleaseItems(items: ReleaseArtifactItem[] | undefined): ReleaseItem[] {
  return dedupeItems(
    (items ?? [])
      .map(getReleaseItemText)
      .filter((text): text is string => Boolean(text?.trim()))
      .map((text) => ({ text: text.trim() })),
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: API_HEADERS });

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

async function fetchComparePrNumbers(
  baseTag: string | undefined,
  headTag: string,
): Promise<number[]> {
  if (!baseTag || baseTag === headTag) {
    return [];
  }

  const compare = await fetchJson<GitHubCompare>(
    `https://api.github.com/repos/freed-project/freed/compare/${encodeURIComponent(
      baseTag,
    )}...${encodeURIComponent(headTag)}`,
  );

  return compare.commits.flatMap((commit) =>
    extractPrNumbersFromText(commit.commit.message),
  );
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
      channel: (candidate.tag_name.endsWith("-dev") ? "dev" : "production") as ReleaseChannel,
    }));

  if (buildLinks.length > 0) {
    return buildLinks;
  }

  return [
    {
      version: artifact.version || release.tag_name.replace(/^v/, ""),
      htmlUrl: release.html_url,
      channel: (release.tag_name.endsWith("-dev") ? "dev" : "production") as ReleaseChannel,
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
  const features = toReleaseItems(releaseShape.features ?? releaseShape.whatsNew);
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

async function fetchChangelog(): Promise<ParsedRelease[]> {
  const releases = await fetchGitHubReleases();
  const publishedReleases = normalizeGitHubReleases(releases);
  const releaseMap = new Map(releases.map((release) => [release.tag_name, release]));
  const localReleaseArtifacts = readLocalReleaseArtifacts();

  const detailedReleases = await Promise.all(publishedReleases.map((publishedRelease) => {
    const release = releaseMap.get(publishedRelease.tagName);
    const localArtifact = release ? localReleaseArtifacts.get(release.tag_name) : null;

    if (release && localArtifact?.release) {
      return releaseFromLocalArtifact(
        localArtifact,
        release,
        releaseMap,
        localReleaseArtifacts,
      );
    }

    return publishedRelease;
  }));

  return groupReleasesByDay(detailedReleases);
}

function readExistingSnapshot(): ParsedRelease[] | null {
  if (!existsSync(OUTPUT_PATH)) {
    return null;
  }

  return JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as ParsedRelease[];
}

async function main() {
  try {
    const releases = await fetchChangelog();
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(releases, null, 2)}\n`);
    console.log(
      `✓ Generated changelog snapshot with ${releases.length.toLocaleString()} grouped days`,
    );
  } catch (error) {
    const existingSnapshot = readExistingSnapshot();
    if (existingSnapshot) {
      console.warn(
        `[generate-changelog] Using existing snapshot with ${existingSnapshot.length.toLocaleString()} grouped days because refresh failed.`,
      );
      console.warn(error);
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error("[generate-changelog] Failed to build changelog snapshot.");
  console.error(error);
  process.exit(1);
});
