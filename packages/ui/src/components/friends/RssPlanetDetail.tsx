import { useLibraryRssFeedDetail } from "../../hooks/useLibraryRssFeedDetail.js";
import { usePlatform } from "../../context/PlatformContext.js";
import { navigateToFeedView } from "../../lib/workspace-navigation.js";

export function RssPlanetDetail({ url, sourceVersion, onBack }: {
  url: string; sourceVersion: number; onBack: () => void;
}) {
  const { feed, loading, error } = useLibraryRssFeedDetail(url, sourceVersion);
  const platform = usePlatform();
  return <section className="p-4 space-y-4">
    <button type="button" className="btn-secondary" onClick={onBack}>Back</button>
    <p className="text-xs text-[color:var(--theme-accent-primary)]">RSS feed</p>
    <h2 className="text-lg font-semibold">{feed?.title || "RSS feed"}</h2>
    {loading ? <p>Loading feed...</p> : error ? <p role="alert">{error}</p> : <>
      <p className="break-words text-sm text-[color:var(--theme-text-muted)]">{url}</p>
      <button type="button" className="btn-primary" onClick={() => {
        const actions = platform.store.getState();
        actions.setSearchQuery("");
        navigateToFeedView(actions, { platform: "rss", feedUrl: url });
      }}>View posts</button>
    </>}
  </section>;
}
