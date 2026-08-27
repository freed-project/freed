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
  readonly rows: readonly LibraryCorePersonPickerRowV1[];
} {
  const readerSessionId = useRef(
    createLibraryCoreOperationInstanceId(
      "person-picker-reader",
      crypto.randomUUID(),
    ),
  );
  const normalizedSearch = search.trim();
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
        setResult({ attemptKey, rows: response.rows });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, rows: EMPTY_ROWS });
      });
    return () => {
      cancelled = true;
    };
  }, [attemptKey, enabled, normalizedSearch, query]);

  const current = enabled && result?.attemptKey === attemptKey ? result : null;
  return {
    loading:
      enabled && query !== null && query !== undefined && current === null,
    rows: current?.rows ?? EMPTY_ROWS,
  };
}
