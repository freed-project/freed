import type { Metadata } from "next";
import { notFound } from "next/navigation";
import changelogReleases from "@/content/changelog.generated.json";
import type { ParsedRelease } from "@/content/changelog";

export const CHANGELOG_PAGE_SIZE = 5;

const allReleases = changelogReleases as ParsedRelease[];

export function getAllChangelogReleases(): ParsedRelease[] {
  return allReleases;
}

export function getChangelogTotalPages(): number {
  return Math.max(1, Math.ceil(allReleases.length / CHANGELOG_PAGE_SIZE));
}

export function getChangelogPageHref(page: number): string {
  return page <= 1 ? "/changelog" : `/changelog/${page.toString()}`;
}

export function parseChangelogPage(value: string | number | undefined): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "1", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    notFound();
  }

  const totalPages = getChangelogTotalPages();

  if (parsed > totalPages) {
    notFound();
  }

  return parsed;
}

export function getChangelogPageSlice(page: number): ParsedRelease[] {
  const start = (page - 1) * CHANGELOG_PAGE_SIZE;
  return allReleases.slice(start, start + CHANGELOG_PAGE_SIZE);
}

export function getChangelogPageRange(page: number): {
  start: number;
  end: number;
  total: number;
} {
  const total = allReleases.length;
  if (total === 0) {
    return { start: 0, end: 0, total };
  }

  const start = (page - 1) * CHANGELOG_PAGE_SIZE + 1;
  const end = Math.min(page * CHANGELOG_PAGE_SIZE, total);

  return { start, end, total };
}

export function buildChangelogMetadata(page: number): Metadata {
  const pageSuffix = page > 1 ? `, page ${page.toLocaleString()}` : "";
  const title = `Log | Freed`;
  const description = `Every release, every fix, every new feature${pageSuffix}. The full build history of Freed Desktop.`;
  const path = getChangelogPageHref(page);

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: path,
    },
  };
}

export function getChangelogPaginationStaticParams(): Array<{ page: string }> {
  const totalPages = getChangelogTotalPages();

  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({
    page: (index + 2).toString(),
  }));
}
