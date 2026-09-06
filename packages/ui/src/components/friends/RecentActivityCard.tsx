import { formatDistanceToNow } from "date-fns";
import type { FeedItem } from "@freed/shared";
import { usePlatform } from "../../context/PlatformContext.js";
import { providerLabel } from "../../lib/account-labels.js";
import { navigateToFeedView } from "../../lib/workspace-navigation.js";

/** Two sibling hit targets keep provider navigation independent of the card. */
export function RecentActivityCard({ item }: { item: FeedItem }) {
  const platform = usePlatform();
  const open = (providerOnly: boolean) => {
    const actions = platform.store.getState();
    actions.setSearchQuery("");
    navigateToFeedView(actions, providerOnly
      ? { platform: item.platform, authorId: item.author.id,
          ...(item.platform === "rss" && item.rssSource?.feedUrl
            ? { feedUrl: item.rssSource.feedUrl } : {}) }
      : {});
    actions.setSelectedItem(item.globalId);
    if (platform.interactionMode === "read-only") {
      platform.onReadOnlyItemOpened?.(item);
    } else {
      void actions.markAsRead(item.globalId);
    }
  };
  const text = item.content.text?.trim() || item.content.linkPreview?.title || "Open post";
  return (
    <div className="theme-card-soft relative isolate rounded-2xl">
      <button type="button" onClick={() => open(false)}
        aria-label={`Read post: ${text}`}
        className="group w-full rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)]">
        <span className="flex justify-end text-[11px] text-[color:var(--theme-text-muted)]">
          {formatDistanceToNow(item.publishedAt, { addSuffix: true })}
        </span>
        <p className="mt-2 line-clamp-3 text-sm text-[color:var(--theme-text-primary)] group-hover:text-[color:var(--theme-accent-primary)]">{text}</p>
      </button>
      <button type="button" onClick={() => open(true)}
        title={`Read this post in ${item.author.displayName || "this account"}'s ${providerLabel(item.platform)} feed`}
        className="absolute left-2 top-2 rounded-md px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--theme-accent-primary)] transition-colors hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.18)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
        {providerLabel(item.platform)}
      </button>
    </div>
  );
}
