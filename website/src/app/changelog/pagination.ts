import type { Metadata } from "next";
import { notFound } from "next/navigation";
import changelogReleases from "@/content/changelog.generated.json";
import type { ParsedRelease } from "@/content/changelog";

export const CHANGELOG_PAGE_SIZE = 5;
export type ChangelogMode = "production" | "all";

const allReleases = changelogReleases as ParsedRelease[];

function releasesForMode(mode: ChangelogMode): ParsedRelease[] {
  if (mode === "all") {
    return allReleases;
  }

  return allReleases.filter((release) => release.channel !== "dev");
}

export function getChangelogTotalPages(
  mode: ChangelogMode = "production",
): number {
  return Math.max(
    1,
    Math.ceil(releasesForMode(mode).length / CHANGELOG_PAGE_SIZE),
  );
}

export function getChangelogPageHref(
  page: number,
  mode: ChangelogMode = "production",
): string {
  const basePath = mode === "all" ? "/changelog/all" : "/changelog";
  const pathPage = page.toLocaleString("en-US", { useGrouping: false });
  return page <= 1 ? basePath : `${basePath}/${pathPage}`;
}

export function parseChangelogPage(
  value: string | number | undefined,
  mode: ChangelogMode = "production",
): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "1", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    notFound();
  }

  const totalPages = getChangelogTotalPages(mode);

  if (parsed > totalPages) {
    notFound();
  }

  return parsed;
}

export function getChangelogPageSlice(page: number): ParsedRelease[] {
  return getChangelogPageSliceForMode(page, "production");
}

export function getChangelogPageSliceForMode(
  page: number,
  mode: ChangelogMode = "production",
): ParsedRelease[] {
  const start = (page - 1) * CHANGELOG_PAGE_SIZE;
  return releasesForMode(mode).slice(start, start + CHANGELOG_PAGE_SIZE);
}

export function getChangelogPageRange(
  page: number,
  mode: ChangelogMode = "production",
): {
  start: number;
  end: number;
  total: number;
} {
  const total = releasesForMode(mode).length;
  if (total === 0) {
    return { start: 0, end: 0, total };
  }

  const start = (page - 1) * CHANGELOG_PAGE_SIZE + 1;
  const end = Math.min(page * CHANGELOG_PAGE_SIZE, total);

  return { start, end, total };
}

export function buildChangelogMetadata(
  page: number,
  mode: ChangelogMode = "production",
): Metadata {
  const pageSuffix = page > 1 ? `, page ${page.toLocaleString()}` : "";
  const title = `Log | Freed`;
  const modeSuffix = mode === "all" ? " including dev builds" : "";
  const description = `Every release, every fix, every new feature${modeSuffix}${pageSuffix}. The full build history of Freed Desktop.`;
  const path = getChangelogPageHref(page, mode);

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

export function getChangelogPaginationStaticParams(
  mode: ChangelogMode = "production",
): Array<{ page: string }> {
  const totalPages = getChangelogTotalPages(mode);

  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({
    page: (index + 2).toLocaleString("en-US", { useGrouping: false }),
  }));
}
