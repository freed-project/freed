import { useEffect, useMemo, useState } from "react";
import type { FilterOptions } from "@freed/shared";
import type { LibraryCoreFilterScopeSummaryResponseV1 } from "@freed/shared/library-core";
import { usePlatform } from "../context/PlatformContext.js";

export interface LibraryFilterScopeSummaryState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly status: "idle" | "loading" | "refreshing" | "ready" | "failed";
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
  const contextKey = request ? JSON.stringify(request) : null;
  const queryKey = request ? JSON.stringify({ request, sourceVersion }) : null;
  const [result, setResult] = useState<{
    readonly queryKey: string;
    readonly reader: typeof queryLibraryCore;
    readonly contextKey: string;
    readonly sourceVersion: number;
    readonly summary: LibraryCoreFilterScopeSummaryResponseV1;
  } | null>(null);

  const [error, setError] = useState<{ key: string; reader: typeof queryLibraryCore; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!request || !queryKey) {
      setResult(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    if (!queryLibraryCore) {
      setResult(null);
      setError({ key: queryKey, reader: queryLibraryCore, message: "SQLite filter scope query is unavailable" });
      return () => {
        cancelled = true;
      };
    }

    setError(null);
    void queryLibraryCore(request)
      .then((summary) => {
        if (cancelled) return;
        setResult({ queryKey, reader: queryLibraryCore, contextKey: contextKey!, sourceVersion, summary });
        })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setResult(null);
          setError({ key: queryKey, reader: queryLibraryCore, message: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, queryLibraryCore, request, contextKey, sourceVersion]);

  const retained = result !== null && result.reader === queryLibraryCore && result.contextKey === contextKey && result.sourceVersion <= sourceVersion ? result : null;
  const message = error?.key === queryKey && error.reader === queryLibraryCore ? error.message : null;
  const status = !request ? "idle" : !queryLibraryCore || message ? "failed" : retained?.queryKey === queryKey ? "ready" : retained ? "refreshing" : "loading";
  return { error: message, loading: status === "loading", status, summary: status === "failed" ? null : retained?.summary ?? null };
}
