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

  return (data as Array<{
    id: number;
    tag_name: string;
    name: string;
    body: string | null;
    published_at: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
  }>)
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

export default async function ChangelogPage() {
  const releases = await getReleases();

  return <ChangelogContent releases={releases} />;
}
