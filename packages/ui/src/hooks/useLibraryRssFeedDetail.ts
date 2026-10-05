import { useEffect, useState } from "react";
import type { RssFeed } from "@freed/shared";
import { libraryCoreRssFeedDetailToRssFeedV1 } from "@freed/shared/library-core";
import { usePlatform } from "../context/PlatformContext.js";

interface LibraryRssFeedDetailState {
  readonly error: string | null;
  readonly feed: RssFeed | null;
  readonly loading: boolean;
  readonly refreshing?: boolean;
}

/** Read one exact RSS Feed from SQLite without retaining the subscription map. */
export function useLibraryRssFeedDetail(
  url: string | null,
  sourceVersion: number,
): LibraryRssFeedDetailState {
  const { queryLibraryCore } = usePlatform();
  const [state, setState] = useState<LibraryRssFeedDetailState & { reader?: typeof queryLibraryCore; url?: string; sourceVersion?: number }>({
    error: null,
    feed: null,
    loading: url !== null,
  });

  useEffect(() => {
    let cancelled = false;
    if (url === null) {
      setState({ error: null, feed: null, loading: false });
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setState({
        error: "SQLite RSS Feed detail query is unavailable",
        feed: null,
        loading: false,
      });
      return () => {
        cancelled = true;
      };
    }

    setState(current => ({ reader: queryLibraryCore, url, sourceVersion, feed: current.reader === queryLibraryCore && current.url === url && (current.sourceVersion ?? Infinity) <= sourceVersion ? current.feed : null, error: null, loading: true }));
    void queryLibraryCore({
      queryId: "rss_feed_detail_v1",
      schemaVersion: 1,
      url,
    })
      .then((response) => {
        if (cancelled) return;
        setState({
          reader: queryLibraryCore, url, sourceVersion,
          error: null,
          feed:
            response.feed === null
              ? null
              : libraryCoreRssFeedDetailToRssFeedV1(response.feed),
          loading: false,
        });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState({
          reader: queryLibraryCore, url, sourceVersion,
          error: reason instanceof Error ? reason.message : String(reason),
          feed: null,
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [queryLibraryCore, sourceVersion, url]);

  if (url === null) return { feed: null, error: null, loading: false };
  if (!queryLibraryCore) return { feed: null, error: "SQLite RSS Feed detail query is unavailable", loading: false };
  const matches = state.reader === queryLibraryCore && state.url === url && (state.sourceVersion ?? Infinity) <= sourceVersion;
  const current = matches && state.sourceVersion === sourceVersion && !state.loading;
  return { feed: matches ? state.feed : null, error: current ? state.error : null, loading: !current && (!matches || !state.feed), refreshing: !current && matches && !!state.feed };
}
