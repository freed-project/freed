import { useEffect, useRef, useState } from "react";
import type { LibraryCoreAccountLinkCandidateRowV1 } from "@freed/shared/library-core";

import { usePlatform } from "../context/PlatformContext.js";
import type { AccountLinkSuggestion } from "../lib/account-link-suggestion.js";

const MAXIMUM_CANDIDATES = 5;

function operationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function toSuggestion(
  row: LibraryCoreAccountLinkCandidateRowV1,
): AccountLinkSuggestion {
  return {
    accountAvatarUrl: row.accountAvatarUrl,
    accountDisplayName: row.accountDisplayName,
    accountExternalId: row.accountExternalId,
    accountHandle: row.accountHandle,
    accountId: row.accountId,
    accountProvider: row.accountProvider,
    confidence: row.confidence,
    personAvatarUrl: row.personAvatarUrl,
    personId: row.personId,
    personName: row.personName,
    reason: row.reason,
    score: row.score,
  };
}

/** Retain only the link candidates for the selected Person or Account. */
export function useLibraryAccountLinkCandidates({
  entityId,
  entityKind,
  sourceVersion,
}: {
  readonly entityId: string | null;
  readonly entityKind: "account" | "person";
  readonly sourceVersion: number;
}): readonly AccountLinkSuggestion[] {
  const { queryLibraryCore } = usePlatform();
  const readerSessionId = useRef(operationId("account-link-reader"));
  const [result, setResult] = useState<{
    readonly attemptKey: string;
    readonly rows: readonly AccountLinkSuggestion[];
  } | null>(null);
  const attemptKey = JSON.stringify([entityKind, entityId, sourceVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!entityId || !queryLibraryCore) {
      setResult(null);
      return () => {
        cancelled = true;
      };
    }
    void queryLibraryCore({
      cancellationId: operationId("account-link-query"),
      entityId,
      entityKind,
      limit: MAXIMUM_CANDIDATES,
      queryId: "account_link_candidates_v1",
      readerSessionId: readerSessionId.current,
      schemaVersion: 1,
    })
      .then((response) => {
        if (cancelled) return;
        setResult({
          attemptKey,
          rows: Object.freeze(response.rows.map(toSuggestion)),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, rows: Object.freeze([]) });
      });
    return () => {
      cancelled = true;
    };
  }, [attemptKey, entityId, entityKind, queryLibraryCore]);

  return result?.attemptKey === attemptKey ? result.rows : [];
}
