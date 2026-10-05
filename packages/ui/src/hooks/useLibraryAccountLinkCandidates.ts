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
export function useLibraryAccountLinkCandidatesState({
  entityId,
  entityKind,
  sourceVersion,
}: {
  readonly entityId: string | null;
  readonly entityKind: "account" | "person";
  readonly sourceVersion: number;
}): { readonly rows: readonly AccountLinkSuggestion[]; readonly resultsCurrent: boolean; readonly status: "loading" | "refreshing" | "ready" | "failed" | "idle" } {
  const { queryLibraryCore } = usePlatform();
  const readerSessionId = useRef(operationId("account-link-reader"));
  const [result, setResult] = useState<{
    readonly attemptKey: string;
    readonly requestKey: string;
    readonly sourceVersion: number;
    readonly failed: boolean;
    readonly reader: typeof queryLibraryCore;
    readonly rows: readonly AccountLinkSuggestion[];
  } | null>(null);
  const requestKey = JSON.stringify([entityKind, entityId]);
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
          attemptKey, requestKey, sourceVersion, failed: false,
          reader: queryLibraryCore,
          rows: Object.freeze(response.rows.map(toSuggestion)),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, requestKey, sourceVersion, failed: true, reader: queryLibraryCore, rows: Object.freeze([]) });
      });
    return () => {
      cancelled = true;
    };
  }, [attemptKey, entityId, entityKind, queryLibraryCore]);

  const retained = entityId && result !== null && result.reader === queryLibraryCore && result.requestKey === requestKey && result.sourceVersion <= sourceVersion ? result : null;
  const resultsCurrent = retained?.attemptKey === attemptKey && retained.failed === false;
  const failed = retained?.attemptKey === attemptKey && retained.failed;
  return { rows: retained?.rows ?? [], resultsCurrent, status: !entityId || !queryLibraryCore ? "idle" : failed ? "failed" : resultsCurrent ? "ready" : retained?.rows.length ? "refreshing" : "loading" };
}

export function useLibraryAccountLinkCandidates(options: Parameters<typeof useLibraryAccountLinkCandidatesState>[0]): readonly AccountLinkSuggestion[] {
  return useLibraryAccountLinkCandidatesState(options).rows;
}
