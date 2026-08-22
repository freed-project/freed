import { useEffect, useMemo, useState } from "react";
import type { FilterOptions } from "@freed/shared";
import type { LibraryCoreFilterScopeSummaryResponseV1 } from "@freed/shared/library-core";
import { usePlatform } from "../context/PlatformContext.js";

export interface LibraryFilterScopeSummaryState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly summary: LibraryCoreFilterScopeSummaryResponseV1 | null;
}

/** Resolve one exact Feed or provider-author scope without retaining a catalog. */
export function useLibraryFilterScopeSummary(
  filter: FilterOptions,
  sourceVersion: number,
): LibraryFilterScopeSummaryState {
  const { queryLibraryCore } = usePlatform();
  const request = useMemo(() => {
    if (filter.feedUrl) {
      return {
        authorId: null,
        feedUrl: filter.feedUrl,
        platform: null,
        queryId: "filter_scope_summary_v1" as const,
        schemaVersion: 1 as const,
      };
    }
    if (filter.authorId && filter.platform) {
      return {
        authorId: filter.authorId,
        feedUrl: null,
        platform: filter.platform,
        queryId: "filter_scope_summary_v1" as const,
        schemaVersion: 1 as const,
      };
    }
    return null;
  }, [filter.authorId, filter.feedUrl, filter.platform]);
  const queryKey = request ? JSON.stringify({ request, sourceVersion }) : null;
  const [result, setResult] = useState<{
    readonly queryKey: string;
    readonly summary: LibraryCoreFilterScopeSummaryResponseV1;
  } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!request || !queryKey) {
      setResult(null);
      setLoadingKey(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setResult(null);
      setLoadingKey(null);
      setError("SQLite filter scope query is unavailable");
      return () => {
        cancelled = true;
      };
    }

    setLoadingKey(queryKey);
    setError(null);
    void queryLibraryCore(request)
      .then((summary) => {
        if (cancelled) return;
        setResult({ queryKey, summary });
        setLoadingKey(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setResult(null);
        setLoadingKey(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, queryLibraryCore, request]);

  return {
    error,
    loading: queryKey !== null && loadingKey === queryKey,
    summary: result?.queryKey === queryKey ? result.summary : null,
  };
}
