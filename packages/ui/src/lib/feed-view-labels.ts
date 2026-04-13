import { PLATFORM_LABELS, type FilterOptions, type RssFeed } from "@freed/shared";

/** Human-readable retention message for archived content cleanup. */
export function getRetentionLabel(pruneDays: number): string {
  if (pruneDays === 0) return "Archived content is kept forever";
  if (pruneDays === 1) return "Archived content deleted after 1 day";
  return `Archived content deleted after ${pruneDays} days`;
}

/** Human-readable label for the scope currently active in the sidebar. */
export function getFilterLabel(filter: FilterOptions, feeds: Record<string, RssFeed>): string {
  if (filter.savedOnly) return "Saved";
  if (filter.archivedOnly) return "Archived";
  if (filter.feedUrl) return feeds[filter.feedUrl]?.title ?? "this feed";
  if (filter.platform === "rss") return "Feeds";
  if (filter.platform) return PLATFORM_LABELS[filter.platform as keyof typeof PLATFORM_LABELS] ?? filter.platform;
  return "All Sources";
}
