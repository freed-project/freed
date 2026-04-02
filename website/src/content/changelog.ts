export interface ReleaseItem {
  text: string;
  prNumber?: number;
}

export interface ParsedRelease {
  version: string;
  tagName: string;
  date: string;
  summary?: string;
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  performance: ReleaseItem[];
  htmlUrl: string;
  prNumbers: number[];
  builds: string[];
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

function filterGenericItems(items: ReleaseItem[]): ReleaseItem[] {
  if (items.length <= 1) {
    return items;
  }

  return items.filter((item) => {
    const text = item.text.trim().toLowerCase();
    return text !== "bug fixes and improvements" && text !== "bug fixes and improvements.";
  });
}

function dedupeItems(items: ReleaseItem[]): ReleaseItem[] {
  const deduped = new Map<string, ReleaseItem>();

  for (const item of items) {
    const key = item.text.toLowerCase();
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    if (!existing.prNumber && item.prNumber) {
      deduped.set(key, item);
    }
  }

  return filterGenericItems(Array.from(deduped.values()));
}

export function parseReleaseBody(body: string): {
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  performance: ReleaseItem[];
  prNumbers: number[];
} {
  const features: ReleaseItem[] = [];
  const fixes: ReleaseItem[] = [];
  const performance: ReleaseItem[] = [];
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
        .trim();

      const prMatch = text.match(/\(#(\d+)\)$/) ?? text.match(/#(\d+)$/);
      const prNumber = prMatch ? Number(prMatch[1]) : undefined;
      const cleanText = text
        .replace(/\s*\(#\d+\)$/, "")
        .replace(/\s*#\d+$/, "")
        .trim();

      return { text: cleanText, prNumber };
    });

    if (heading.includes("new") || heading.includes("feat")) {
      features.push(...items);
      continue;
    }

    if (heading.includes("fix")) {
      fixes.push(...items);
      continue;
    }

    if (heading.includes("perf")) {
      performance.push(...items);
    }
  }

  return {
    features: dedupeItems(features),
    fixes: dedupeItems(fixes),
    performance: dedupeItems(performance),
    prNumbers: [...new Set(prNumbers)].sort((a, b) => a - b),
  };
}

export function normalizeGitHubReleases(
  releases: GitHubRelease[],
): ParsedRelease[] {
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => {
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
    });
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

    return {
      ...head,
      summary: head.summary ?? "",
      features: dedupeItems(allReleases.flatMap((release) => release.features)),
      fixes: dedupeItems(allReleases.flatMap((release) => release.fixes)),
      performance: dedupeItems(
        allReleases.flatMap((release) => release.performance),
      ),
      prNumbers: [
        ...new Set(allReleases.flatMap((release) => release.prNumbers)),
      ].sort((a, b) => a - b),
      builds: allReleases.map((release) => release.version),
    };
  });
}
