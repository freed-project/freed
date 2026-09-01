import { PLATFORM_LABELS, type FilterOptions } from "@freed/shared";

/** Human-readable retention message for archived content cleanup. */
export function getRetentionLabel(pruneDays: number): string {
  if (pruneDays === 0) return "Archived content is kept forever";
  if (pruneDays === 1) return "Archived content deleted after 1 day";
  return `Archived content deleted after ${pruneDays} days`;
}

/** Human-readable label that needs no Library row lookup. */
export function getStaticFilterLabel(filter: FilterOptions): string | null {
  if (filter.savedOnly) return "Saved";
  if (filter.archivedOnly) return "Archived";
  if (filter.feedUrl || filter.authorId) return null;
  if (filter.platform === "rss") return "Feeds";
  if (filter.platform)
    return (
      PLATFORM_LABELS[filter.platform as keyof typeof PLATFORM_LABELS] ??
      filter.platform
    );
  return "All Sources";
}
