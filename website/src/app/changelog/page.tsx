import type { Metadata } from "next";
import ChangelogContent from "./ChangelogContent";

export const metadata: Metadata = {
  title: "Log | Freed",
  description:
    "Every release, every fix, every new feature. The full build history of Freed Desktop.",
  openGraph: {
    title: "Log | Freed",
    description:
      "Every release, every fix, every new feature. The full build history of Freed Desktop.",
  },
};

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

interface ReleaseItem {
  text: string;
  prNumber?: number;
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
  let match;

  while ((match = sectionRegex.exec(body)) !== null) {
    const heading = match[1].trim().toLowerCase();
    const content = match[2];

    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "));

    const items: ReleaseItem[] = lines.map((line) => {
      const text = line
        .replace(/^- /, "")
        // Capture PR number from markdown links before stripping them
        .replace(/\[#(\d+)\]\([^)]+\)/g, (_, num) => {
          prNumbers.push(Number(num));
          return `#${num}`;
        })
        // Strip any remaining markdown links
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();

      // Extract trailing PR number reference like " (#42)" or "#42"
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
    } else if (heading.includes("fix")) {
      fixes.push(...items);
    } else if (heading.includes("perf")) {
      performance.push(...items);
    }
  }

  // Deduplicate PR numbers
  const uniquePrNumbers = [...new Set(prNumbers)].sort((a, b) => a - b);

  return { features, fixes, performance, prNumbers: uniquePrNumbers };
}

async function getReleases(): Promise<ParsedRelease[]> {
  const res = await fetch(
    "https://api.github.com/repos/freed-project/freed/releases?per_page=100",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 3600 },
    },
  );

  if (!res.ok) return [];

  const data = await res.json();

  return (
    data as Array<{
      id: number;
      tag_name: string;
      name: string;
      body: string | null;
      published_at: string;
      html_url: string;
      draft: boolean;
      prerelease: boolean;
    }>
  )
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => {
      const { features, fixes, performance, prNumbers } = parseReleaseBody(
        r.body ?? "",
      );
      return {
        version: r.tag_name.replace(/^v/, ""),
        tagName: r.tag_name,
        date: r.published_at,
        features,
        fixes,
        performance,
        htmlUrl: r.html_url,
        prNumbers,
      };
    });
}

/**
 * Derives the CalVer day key from a version string.
 *
 * Scheme: YY.M.DDBUILD where patch = (day × 100) + build_number
 * e.g. "26.3.904" → day=9 → key "26.3.9"
 *
 * Using the version (not published_at) avoids UTC midnight edge cases where
 * two same-day builds can have different UTC date strings.
 */
function versionDayKey(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return version;
  const [yy, m, patch] = parts;
  const day = Math.floor(Number(patch) / 100);
  return `${yy}.${m}.${day}`;
}

function groupReleasesByDay(releases: ParsedRelease[]): ParsedRelease[] {
  const byDay = new Map<string, ParsedRelease[]>();

  for (const r of releases) {
    const day = versionDayKey(r.version);
    const group = byDay.get(day) ?? [];
    group.push(r);
    byDay.set(day, group);
  }

  // GitHub returns releases newest-first, so the first entry in each group
  // is already the most recent build for that day.
  return Array.from(byDay.values()).map((group) => {
    const [head, ...rest] = group;
    return {
      ...head,
      features: [...head.features, ...rest.flatMap((r) => r.features)],
      fixes: [...head.fixes, ...rest.flatMap((r) => r.fixes)],
      performance: [...head.performance, ...rest.flatMap((r) => r.performance)],
      prNumbers: [
        ...new Set([...head.prNumbers, ...rest.flatMap((r) => r.prNumbers)]),
      ].sort((a, b) => a - b),
    };
  });
}

export default async function ChangelogPage() {
  const releases = await getReleases();

  return <ChangelogContent releases={groupReleasesByDay(releases)} />;
}
