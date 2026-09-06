import type { LibraryCoreNormalizedQueryExecutor, LibraryCorePersonGraphPageRequestV1, LibraryCorePersonGraphPageResponseV1, LibraryCoreAccountGraphPageResponseV1 } from "@freed/shared/library-core";
import { resolveDesktopAvatarUrl } from "./avatar-delivery";

/** Visit every identity with one bounded SQLite page resident, never a corpus list. */
export async function backfillIdentityAvatars(
  query: LibraryCoreNormalizedQueryExecutor,
  signal: AbortSignal,
  warm: (url: string, signal: AbortSignal) => Promise<boolean> = async (url, signal) => {
    const response = await fetch(resolveDesktopAvatarUrl(url), { method: "HEAD", signal, cache: "no-store" });
    return response.ok;
  },
): Promise<{ cached: number; unavailable: number }> {
  const counts = { cached: 0, unavailable: 0 };
  const readerSessionId = `avatar-cache:${crypto.randomUUID()}`;
  for (const queryId of ["person_graph_page_v1", "account_graph_page_v1"] as const) {
    let cursor: string | null = null;
    do {
      signal.throwIfAborted();
      const request: Omit<LibraryCorePersonGraphPageRequestV1, "queryId"> = { cursor, schemaVersion: 1, limit: 128, readerSessionId, cancellationId: readerSessionId };
      const page: LibraryCorePersonGraphPageResponseV1 | LibraryCoreAccountGraphPageResponseV1 = queryId === "person_graph_page_v1"
        ? await query({ ...request, queryId: "person_graph_page_v1" })
        : await query({ ...request, queryId: "account_graph_page_v1" });
      signal.throwIfAborted();
      // Shared profile URLs in this page need only one native lookup. Cross-page
      // deduplication belongs to disk, not an ever-growing renderer collection.
      const urls = new Set(page.rows.map(row => row.avatarUrl).filter((url): url is string => !!url && /^https:\/\//i.test(url)));
      for (const url of urls) {
        signal.throwIfAborted();
        try {
          if (await warm(url, signal)) counts.cached += 1;
          else counts.unavailable += 1;
        } catch {
          signal.throwIfAborted();
          counts.unavailable += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return counts;
}

/** Coalesce discoveries without running concurrent corpus passes or retry loops. */
export function startAvatarBackfill(
  query: LibraryCoreNormalizedQueryExecutor,
  subscribe: (invalidate: () => void) => () => void,
  report: (message: string) => void,
): () => void {
  let stopped = false;
  let pending = true;
  let running = false;
  let controller: AbortController | null = null;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      while (pending && !stopped) {
        pending = false;
        controller = new AbortController();
        try {
          const counts = await backfillIdentityAvatars(query, controller.signal);
          report(`[avatars] Cache pass completed: ${counts.cached.toLocaleString()} cached URL references, ${counts.unavailable.toLocaleString()} unavailable.`);
        } catch {
          if (!stopped) report("[avatars] Cache pass interrupted; a later identity change or app restart will resume discovery.");
        }
      }
    } finally { running = false; }
  };
  const unsubscribe = subscribe(() => { pending = true; void run(); });
  void run();
  return () => { stopped = true; controller?.abort(); unsubscribe(); };
}
