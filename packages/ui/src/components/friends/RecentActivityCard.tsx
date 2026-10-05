import type { FeedItem } from "@freed/shared";
import { FeedItem as FeedItemCard } from "../feed/FeedItem.js";
import { usePlatform } from "../../context/PlatformContext.js";
import { providerLabel } from "../../lib/account-labels.js";
import { PlatformIcon } from "../icons.js";
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
  return (
    <div className="theme-card-soft relative isolate rounded-2xl">
      <FeedItemCard item={item} summary fixedHeight={128} showReadInGrayscale={false} onClick={() => open(false)} />
      <button type="button" onClick={() => open(true)}
        title={`Read this post in ${item.author.displayName || "this account"}'s ${providerLabel(item.platform)} feed`}
        className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--theme-accent-primary)] transition-colors hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.18)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
        <PlatformIcon platform={item.platform} className="h-3 w-3" />
        {providerLabel(item.platform)}
      </button>
    </div>
  );
}
