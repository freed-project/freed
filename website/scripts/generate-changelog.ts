import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  groupReleasesByDay,
  normalizeGitHubReleases,
  parseReleaseBody,
  type ParsedRelease,
  type ReleaseItem,
  versionDayKey,
} from "../src/content/changelog";

const OUTPUT_PATH = join(
  process.cwd(),
  "src/content/changelog.generated.json",
);
const RELEASE_NOTES_ROOT = join(process.cwd(), "..", "release-notes");
const RELEASE_NOTES_RELEASES_DIR = join(RELEASE_NOTES_ROOT, "releases");
const RELEASE_NOTES_DAILY_DIR = join(RELEASE_NOTES_ROOT, "daily");
const authToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
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
  generatedAt?: string | null;
  source?: {
    prNumbers?: number[];
  };
  release?: {
    summary?: string;
    whatsNew?: string[];
    fixes?: string[];
    performance?: string[];
  };
}

interface LocalDailyArtifact {
  dayKey: string;
  rollup?: {
    summary?: string;
    whatsNew?: string[];
    fixes?: string[];
    performance?: string[];
  };
}

const prSummaryCache = new Map<number, string>();

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

function toReleaseItems(items: string[] | undefined): ReleaseItem[] {
  return dedupeItems(
    (items ?? [])
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((text) => ({ text: text.trim() })),
  );
}

function normalizeBodyText(body: string): string {
  return body.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

function normalizeSubject(subject: string): string {
  return subject.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
}

function commitKind(subject: string): string {
  const normalized = normalizeSubject(subject);
  const match = normalized.match(
    /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:/,
  );
  return match?.[1] ?? "";
}

function stripPrefix(subject: string): string {
  const normalized = normalizeSubject(subject)
    .replace(/ \(#\d+\)$/, "")
    .replace(
      /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:\s*/,
      "",
    )
    .trim();

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function cleanDetailLine(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*] /, "")
    .replace(/:\s*$/, "")
    .trim();
}

function extractSection(body: string, headings: Set<string>): string[] {
  const lines = normalizeBodyText(body).split("\n");
  const sectionLines: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.trim().toLowerCase();
    if (headings.has(heading)) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines;
}

function parseDetails(lines: string[]): string[] {
  const details: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const text = cleanDetailLine(paragraph.join(" "));
    paragraph = [];

    if (
      text &&
      !["Includes", "Include", "Summary", "What changed", "Impact"].includes(
        text,
      )
    ) {
      details.push(text.charAt(0).toUpperCase() + text.slice(1));
    }
  };

  for (const line of lines) {
    const stripped = line.trim();

    if (!stripped) {
      flushParagraph();
      continue;
    }

    if (stripped.startsWith("```")) {
      flushParagraph();
      continue;
    }

    if (stripped.startsWith("(AI Generated")) {
      continue;
    }

    if (/^[-*] /.test(stripped)) {
      flushParagraph();
      const cleaned = cleanDetailLine(stripped);
      if (cleaned) {
        details.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
      }
      continue;
    }

    paragraph.push(stripped);
  }

  flushParagraph();
  return [...new Set(details)];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: API_HEADERS });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${url}`);
  }

  return (await response.json()) as T;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: join(process.cwd(), ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ensureTagsAvailable() {
  try {
    git(["fetch", "--tags", "--force"]);
  } catch {
    // If git is unavailable in the build environment, we fall back to
    // the existing release body snapshot logic below.
  }
}

function shortenSummary(text: string, maxLength = 160): string {
  if (text.length <= maxLength) {
    return text;
  }

  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.length <= maxLength);
  if (sentence) {
    return sentence;
  }

  const trimmed = text.slice(0, maxLength).trimEnd();
  const lastBreak = Math.max(
    trimmed.lastIndexOf(","),
    trimmed.lastIndexOf(";"),
    trimmed.lastIndexOf(" "),
  );

  if (lastBreak > 80) {
    return trimmed.slice(0, lastBreak).trimEnd();
  }

  return trimmed;
}

function normalizeSummaryText(text: string): string {
  const normalized = text
    .replace(/^This\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.]$/, "")
    .trim();

  if (!normalized) {
    return normalized;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function summarizePrDetails(details: string[], fallback: string): string {
  const summary = details.find((detail) => detail.length > 0) ?? fallback;
  return normalizeSummaryText(shortenSummary(summary));
}

async function fetchPrSummary(
  prNumber: number,
  fallback: string,
): Promise<string> {
  const cached = prSummaryCache.get(prNumber);
  if (cached) {
    return cached;
  }

  const pull = await fetchJson<{ body: string | null }>(
    `https://api.github.com/repos/freed-project/freed/pulls/${prNumber}`,
  );
  const body = pull.body ?? "";
  const preferredSections = [
    new Set(["## what changed"]),
    new Set(["## summary"]),
    new Set(["## impact"]),
  ];

  for (const section of preferredSections) {
    const details = parseDetails(extractSection(body, section));
    if (details.length > 0) {
      const summary = summarizePrDetails(details, fallback);
      prSummaryCache.set(prNumber, summary);
      return summary;
    }
  }

  const summary = summarizePrDetails(
    parseDetails(normalizeBodyText(body).split("\n")),
    fallback,
  );
  prSummaryCache.set(prNumber, summary);
  return summary;
}

function fallbackRelease(release: GitHubRelease): ParsedRelease {
  const { features, fixes, performance, prNumbers } = parseReleaseBody(
    release.body ?? "",
  );

  return {
    version: release.tag_name.replace(/^v/, ""),
    tagName: release.tag_name,
    date: release.published_at,
    summary: "",
    features,
    fixes,
    performance,
    htmlUrl: release.html_url,
    prNumbers,
    builds: [release.tag_name.replace(/^v/, "")],
  };
}

async function buildRelease(
  release: GitHubRelease,
  previousPublishedTag: string | null,
): Promise<ParsedRelease> {
  if (!previousPublishedTag) {
    return fallbackRelease(release);
  }

  try {
    const subjects = git([
      "log",
      `${previousPublishedTag}..${release.tag_name}`,
      "--format=%s",
    ])
      .split("\n")
      .map((subject) => subject.trim())
      .filter(Boolean);
    const features: ReleaseItem[] = [];
    const fixes: ReleaseItem[] = [];
    const performance: ReleaseItem[] = [];
    const prNumbers = new Set<number>();

    for (const subject of subjects) {
      const normalizedSubject = normalizeSubject(subject);
      if (/^(release:|docs:|test:|build:|ci:|Merge )/.test(normalizedSubject)) {
        continue;
      }

      const kind = commitKind(subject);
      const prMatch = subject.match(/\(#(\d+)\)$/);
      const prNumber = prMatch ? Number(prMatch[1]) : undefined;
      const fallback = stripPrefix(subject);

      let items: ReleaseItem[];
      if (prNumber) {
        prNumbers.add(prNumber);
        const summary = await fetchPrSummary(prNumber, fallback);
        items = [{ text: summary, prNumber }];
      } else {
        items = [{ text: fallback }];
      }

      if (kind === "feat") {
        features.push(...items);
        continue;
      }

      if (kind === "perf") {
        performance.push(...items);
        continue;
      }

      fixes.push(...items);
    }

    if (features.length === 0 && fixes.length === 0 && performance.length === 0) {
      return fallbackRelease(release);
    }

    return {
      version: release.tag_name.replace(/^v/, ""),
      tagName: release.tag_name,
      date: release.published_at,
      features: dedupeItems(features),
      fixes: dedupeItems(fixes),
      performance: dedupeItems(performance),
      htmlUrl: release.html_url,
      prNumbers: [...prNumbers].sort((a, b) => a - b),
      builds: [release.tag_name.replace(/^v/, "")],
    };
  } catch {
    return fallbackRelease(release);
  }
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

function readLocalDailyArtifacts(): Map<string, LocalDailyArtifact> {
  const artifacts = new Map<string, LocalDailyArtifact>();

  if (!existsSync(RELEASE_NOTES_DAILY_DIR)) {
    return artifacts;
  }

  for (const file of readdirSync(RELEASE_NOTES_DAILY_DIR)) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const artifact = JSON.parse(
      readFileSync(join(RELEASE_NOTES_DAILY_DIR, file), "utf8"),
    ) as LocalDailyArtifact;
    if (artifact?.dayKey) {
      artifacts.set(artifact.dayKey, artifact);
    }
  }

  return artifacts;
}

function releaseFromLocalArtifact(
  artifact: LocalReleaseArtifact,
  release: GitHubRelease,
): ParsedRelease {
  return {
    version: artifact.version || release.tag_name.replace(/^v/, ""),
    tagName: release.tag_name,
    date: release.published_at,
    summary: artifact.release?.summary?.trim() || "",
    features: toReleaseItems(artifact.release?.whatsNew),
    fixes: toReleaseItems(artifact.release?.fixes),
    performance: toReleaseItems(artifact.release?.performance),
    htmlUrl: release.html_url,
    prNumbers: [...new Set(artifact.source?.prNumbers ?? [])].sort((a, b) => a - b),
    builds: [release.tag_name.replace(/^v/, "")],
  };
}

function applyDailyRollups(
  releases: ParsedRelease[],
  dailyArtifacts: Map<string, LocalDailyArtifact>,
): ParsedRelease[] {
  return releases.map((release) => {
    const daily = dailyArtifacts.get(versionDayKey(release.version));
    const rollup = daily?.rollup;

    if (!rollup) {
      return release;
    }

    const hasRollupContent =
      Boolean(rollup.summary?.trim()) ||
      (rollup.whatsNew?.length ?? 0) > 0 ||
      (rollup.fixes?.length ?? 0) > 0 ||
      (rollup.performance?.length ?? 0) > 0;

    if (!hasRollupContent) {
      return release;
    }

    return {
      ...release,
      summary: rollup.summary?.trim() || release.summary || "",
      features: toReleaseItems(rollup.whatsNew),
      fixes: toReleaseItems(rollup.fixes),
      performance: toReleaseItems(rollup.performance),
    };
  });
}

async function fetchChangelog(): Promise<ParsedRelease[]> {
  ensureTagsAvailable();

  const releases = await fetchJson<GitHubRelease[]>(
    "https://api.github.com/repos/freed-project/freed/releases?per_page=100",
  );
  const publishedReleases = normalizeGitHubReleases(releases);
  const releaseMap = new Map(releases.map((release) => [release.tag_name, release]));
  const localReleaseArtifacts = readLocalReleaseArtifacts();
  const localDailyArtifacts = readLocalDailyArtifacts();

  const detailedReleases: ParsedRelease[] = [];
  let previousPublishedTag: string | null = null;

  for (const publishedRelease of [...publishedReleases].reverse()) {
    const release = releaseMap.get(publishedRelease.tagName);
    if (!release) {
      continue;
    }

    const localArtifact = localReleaseArtifacts.get(release.tag_name);

    if (localArtifact?.release) {
      detailedReleases.push(releaseFromLocalArtifact(localArtifact, release));
    } else {
      detailedReleases.push(await buildRelease(release, previousPublishedTag));
    }
    previousPublishedTag = release.tag_name;
  }

  return applyDailyRollups(
    groupReleasesByDay(detailedReleases.reverse()),
    localDailyArtifacts,
  );
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
