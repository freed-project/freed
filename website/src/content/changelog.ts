interface ReleaseItem {
  text: string;
  prNumber?: number;
}

export interface ParsedRelease {
  version: string;
  tagName: string;
  date: string;
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  performance: ReleaseItem[];
  htmlUrl: string;
  prNumbers: number[];
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

function parseReleaseBody(body: string): {
  features: ReleaseItem[];
  fixes: ReleaseItem[];
  performance: ReleaseItem[];
  prNumbers: number[];
} {
  const features: ReleaseItem[] = [];
  const fixes: ReleaseItem[] = [];
  const performance: ReleaseItem[] = [];
  const prNumbers: number[] = [];

  const sectionRegex = /###\s+(.+?)\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(body)) !== null) {
    const heading = match[1].trim().toLowerCase();
    const content = match[2];

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));

    const items: ReleaseItem[] = lines.map((line) => {
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
    features,
    fixes,
    performance,
    prNumbers: [...new Set(prNumbers)].sort((a, b) => a - b),
  };
}

function versionDayKey(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return version;

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
    return {
      ...head,
      features: [...head.features, ...rest.flatMap((release) => release.features)],
      fixes: [...head.fixes, ...rest.flatMap((release) => release.fixes)],
      performance: [
        ...head.performance,
        ...rest.flatMap((release) => release.performance),
      ],
      prNumbers: [
        ...new Set([
          ...head.prNumbers,
          ...rest.flatMap((release) => release.prNumbers),
        ]),
      ].sort((a, b) => a - b),
    };
  });
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
        features,
        fixes,
        performance,
        htmlUrl: release.html_url,
        prNumbers,
      };
    });
}
