export interface ReleaseItem {
  text: string;
  prNumber?: number;
}

export interface ReleaseBuild {
  version: string;
  htmlUrl: string;
}

export interface ParsedRelease {
  version: string;
  tagName: string;
  date: string;
  deck?: string;
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  followUps: ReleaseItem[];
  htmlUrl: string;
  prNumbers: number[];
  builds: string[];
  buildLinks: ReleaseBuild[];
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

function normalizeReleaseText(text: string): string {
  return text
    .replace(/[—–]/g, ", ")
    .replace(/→/g, " to ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowSignalReleaseText(text: string): boolean {
  const normalized = normalizeReleaseText(text).toLowerCase();

  if (!normalized) {
    return true;
  }

  if (
    normalized === "bug fixes and improvements" ||
    normalized === "bug fixes and improvements." ||
    normalized.startsWith("no behavior change") ||
    normalized.startsWith("prerequisite cleanup") ||
    normalized.startsWith("minor text fixes") ||
    normalized.startsWith("further ") ||
    normalized.startsWith("this was ") ||
    normalized.startsWith("this is ") ||
    normalized.startsWith("this change ") ||
    normalized.startsWith("the primary reason ")
  ) {
    return true;
  }

  return /\b(api returned errors|blocked the release|internal cleanup|package-lock\.json|tsconfig|App\.tsx|SettingsDialog|tsc\b|docaddfeeditem|followingentry\.content|fs caps|dedup index|chrome default "peanuts"|api to get)\b/i.test(
    normalized,
  );
}

function filterGenericItems(items: ReleaseItem[]): ReleaseItem[] {
  return items.filter((item) => !isLowSignalReleaseText(item.text));
}

function dedupeItems(items: ReleaseItem[]): ReleaseItem[] {
  const deduped = new Map<string, ReleaseItem>();

  for (const item of items) {
    const normalized = normalizeReleaseText(item.text);
    const key = normalized.toLowerCase();
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, { ...item, text: normalized });
      continue;
    }

    if (!existing.prNumber && item.prNumber) {
      deduped.set(key, { ...item, text: normalized });
    }
  }

  return filterGenericItems(Array.from(deduped.values()));
}

function extractDeck(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let sawHeading = false;
  const deckLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("(AI Generated")) {
      continue;
    }

    if (!sawHeading && /^##\s+/.test(trimmed)) {
      sawHeading = true;
      continue;
    }

    if (!sawHeading) {
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      break;
    }

    if (!trimmed) {
      if (deckLines.length > 0) {
        break;
      }
      continue;
    }

    deckLines.push(trimmed);
  }

  return normalizeReleaseText(deckLines.join(" "));
}

export function parseReleaseBody(body: string): {
  deck: string;
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  followUps: ReleaseItem[];
  prNumbers: number[];
} {
  const features: ReleaseItem[] = [];
  const fixes: ReleaseItem[] = [];
  const followUps: ReleaseItem[] = [];
  const prNumbers: number[] = [];

  const normalizedBody = body.replace(/\r\n/g, "\n");
  const sectionRegex = /###\s+(.+?)\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(normalizedBody)) !== null) {
    const heading = match[1].trim().toLowerCase();
    const content = match[2];

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));

    const items = lines.map((line) => {
      const text = line
        .replace(/^- /, "")
        .replace(/\[#(\d+)\]\([^)]+\)/g, (_, num: string) => {
          prNumbers.push(Number(num));
          return `#${num}`;
        })
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[—–]/g, ", ")
        .replace(/→/g, " to ")
        .trim();

      const prMatch = text.match(/\(#(\d+)\)$/) ?? text.match(/#(\d+)$/);
      const prNumber = prMatch ? Number(prMatch[1]) : undefined;
      const cleanText = text
        .replace(/\s*\(#\d+\)$/, "")
        .replace(/\s*#\d+$/, "")
        .trim();

      return { text: normalizeReleaseText(cleanText), prNumber };
    });

    if (
      heading.includes("feature") ||
      heading.includes("new") ||
      heading.includes("feat")
    ) {
      features.push(...items);
      continue;
    }

    if (heading.includes("fix")) {
      fixes.push(...items);
      continue;
    }

    if (heading.includes("follow") || heading.includes("perf")) {
      followUps.push(...items);
    }
  }

  return {
    deck: extractDeck(normalizedBody),
    features: dedupeItems(features),
    fixes: dedupeItems(fixes),
    followUps: dedupeItems(followUps),
    prNumbers: [...new Set(prNumbers)].sort((a, b) => a - b),
  };
}

export function normalizeGitHubReleases(
  releases: GitHubRelease[],
): ParsedRelease[] {
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => {
      const { deck, features, fixes, followUps, prNumbers } = parseReleaseBody(
        release.body ?? "",
      );

      return {
        version: release.tag_name.replace(/^v/, ""),
        tagName: release.tag_name,
        date: release.published_at,
        deck,
        features,
        fixes,
        followUps,
        htmlUrl: release.html_url,
        prNumbers,
        builds: [release.tag_name.replace(/^v/, "")],
        buildLinks: [
          {
            version: release.tag_name.replace(/^v/, ""),
            htmlUrl: release.html_url,
          },
        ],
      };
    });
}

function compareVersionsAscending(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

export function versionDayKey(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return version;
  }

  const [yy, month, patch] = parts;
  const day = Math.floor(Number(patch) / 100);
  return `${yy}.${month}.${day}`;
}

export function groupReleasesByDay(releases: ParsedRelease[]): ParsedRelease[] {
  const byDay = new Map<string, ParsedRelease[]>();

  for (const release of releases) {
    const day = versionDayKey(release.version);
    const group = byDay.get(day) ?? [];
    group.push(release);
    byDay.set(day, group);
  }

  return Array.from(byDay.values()).map((group) => {
    const [head, ...rest] = group;
    const allReleases = [head, ...rest];
    const buildLinks = allReleases
      .map((release) => ({
        version: release.version,
        htmlUrl: release.htmlUrl,
      }))
      .sort((left, right) => compareVersionsAscending(left.version, right.version));

    return {
      ...head,
      builds: buildLinks.map((release) => release.version),
      buildLinks,
      prNumbers: [
        ...new Set(allReleases.flatMap((release) => release.prNumbers)),
      ].sort((a, b) => a - b),
    };
  });
}
