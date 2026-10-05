import { useEffect, useRef, useState } from "react";
import {
  createLibraryCoreOperationInstanceId,
  LIBRARY_CORE_PERSON_PICKER_MAXIMUM_LIMIT,
  LIBRARY_CORE_PERSON_PICKER_QUERY_ID,
  LIBRARY_CORE_PERSON_PICKER_SCHEMA_VERSION,
  type LibraryCoreNormalizedQueryExecutor,
  type LibraryCorePersonPickerRowV1,
} from "@freed/shared/library-core";

const EMPTY_ROWS: readonly LibraryCorePersonPickerRowV1[] = Object.freeze([]);

interface PersonPickerResult {
  readonly attemptKey: string;
  readonly requestKey: string;
  readonly sourceVersion: number;
  readonly failed: boolean;
  readonly reader: LibraryCoreNormalizedQueryExecutor;
  readonly rows: readonly LibraryCorePersonPickerRowV1[];
}

/** Retain only one bounded Person search window from SQLite. */
export function useLibraryPersonPicker({
  enabled,
  query,
  search,
  sourceVersion,
}: {
  readonly enabled: boolean;
  readonly query: LibraryCoreNormalizedQueryExecutor | null | undefined;
  readonly search: string;
  readonly sourceVersion: number;
}): {
  readonly loading: boolean;
  readonly resultsCurrent: boolean;
  readonly status: "loading" | "refreshing" | "ready" | "failed" | "idle";
  readonly rows: readonly LibraryCorePersonPickerRowV1[];
} {
  const readerSessionId = useRef(
    createLibraryCoreOperationInstanceId(
      "person-picker-reader",
      crypto.randomUUID(),
    ),
  );
  const normalizedSearch = search.trim();
  const requestKey = normalizedSearch;
  const attemptKey = JSON.stringify([normalizedSearch, sourceVersion]);
  const [result, setResult] = useState<PersonPickerResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !query) {
      setResult(null);
      return () => {
        cancelled = true;
      };
    }
    void query({
      cancellationId: createLibraryCoreOperationInstanceId(
        "person-picker-query",
        crypto.randomUUID(),
      ),
      limit: LIBRARY_CORE_PERSON_PICKER_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_PERSON_PICKER_QUERY_ID,
      readerSessionId: readerSessionId.current,
      schemaVersion: LIBRARY_CORE_PERSON_PICKER_SCHEMA_VERSION,
      search: normalizedSearch,
    })
      .then((response) => {
        if (cancelled) return;
        setResult({ attemptKey, requestKey, sourceVersion, failed: false, reader: query, rows: response.rows });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, requestKey, sourceVersion, failed: true, reader: query, rows: EMPTY_ROWS });
      });
    return () => {
      cancelled = true;
    };
  }, [attemptKey, enabled, normalizedSearch, query]);

  const retained = enabled && result !== null && result.reader === query && result.requestKey === requestKey && result.sourceVersion <= sourceVersion ? result : null;
  const resultsCurrent = retained?.attemptKey === attemptKey && retained.failed === false;
  const failed = retained?.attemptKey === attemptKey && retained.failed;
  const active = enabled && Boolean(query);
  return {
    loading: active && retained === null,
    rows: retained?.rows ?? EMPTY_ROWS,
    resultsCurrent,
    status: !active ? "idle" : failed ? "failed" : resultsCurrent ? "ready" : retained?.rows.length ? "refreshing" : "loading",
  };
}
