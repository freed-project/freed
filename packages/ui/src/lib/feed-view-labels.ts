import { PLATFORM_LABELS, type Account, type FilterOptions, type RssFeed } from "@freed/shared";
import { accountTitle } from "./account-labels.js";

/** Human-readable retention message for archived content cleanup. */
export function getRetentionLabel(pruneDays: number): string {
  if (pruneDays === 0) return "Archived content is kept forever";
  if (pruneDays === 1) return "Archived content deleted after 1 day";
  return `Archived content deleted after ${pruneDays} days`;
}

/** Human-readable label for the scope currently active in the sidebar. */
function tailId(id: string): string {
  return `...${id.slice(-8)}`;
}

function getAuthorFilterLabel(filter: FilterOptions, accounts: Record<string, Account>): string | null {
  if (!filter.platform || !filter.authorId) return null;
  const account = Object.values(accounts).find(
    (candidate) =>
      candidate.kind === "social" &&
      candidate.provider === filter.platform &&
      candidate.externalId === filter.authorId,
  );
  return account ? accountTitle(account) : tailId(filter.authorId);
}

export function getFilterLabel(
  filter: FilterOptions,
  feeds: Record<string, RssFeed>,
  accounts: Record<string, Account> = {},
): string {
  if (filter.savedOnly) return "Saved";
  if (filter.archivedOnly) return "Archived";
  if (filter.feedUrl) return feeds[filter.feedUrl]?.title ?? "this feed";
  const authorLabel = getAuthorFilterLabel(filter, accounts);
  if (authorLabel) return authorLabel;
  if (filter.platform === "rss") return "Feeds";
  if (filter.platform) return PLATFORM_LABELS[filter.platform as keyof typeof PLATFORM_LABELS] ?? filter.platform;
  return "All Sources";
}
