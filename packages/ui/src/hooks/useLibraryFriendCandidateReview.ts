import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareUtf8Binary,
  friendCandidateSuggestionFromReviewRow,
  type FriendCandidateSuggestion,
  type IdentitySuggestion,
} from "@freed/shared";

import { usePlatform } from "../context/PlatformContext.js";

const MAXIMUM_CONTACT_IDS = 512;
const MAXIMUM_DISMISSED_IDS = 256;
const MAXIMUM_CANDIDATES = 10;

function operationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function boundedSortedUnique(
  values: readonly string[],
  maximumItems: number,
): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort(compareUtf8Binary).slice(0, maximumItems),
  );
}

/** Retain only the ten SQLite-ranked candidate rows visible in Friends. */
export function useLibraryFriendCandidateReviewState({
  contactSuggestions,
  dismissedSuggestionIds,
  sourceVersion,
}: {
  readonly contactSuggestions: readonly IdentitySuggestion[];
  readonly dismissedSuggestionIds: readonly string[];
  readonly sourceVersion: number;
}): { readonly rows: readonly FriendCandidateSuggestion[]; readonly resultsCurrent: boolean; readonly status: "loading" | "refreshing" | "ready" | "failed" | "idle" } {
  const { queryLibraryCore } = usePlatform();
  const readerSessionId = useRef(operationId("friend-candidate-reader"));
  const contactAccountIds = useMemo(
    () =>
      boundedSortedUnique(
        contactSuggestions.flatMap((suggestion) => suggestion.accountIds),
        MAXIMUM_CONTACT_IDS,
      ),
    [contactSuggestions],
  );
  const contactPersonIds = useMemo(
    () =>
      boundedSortedUnique(
        contactSuggestions.flatMap((suggestion) =>
          suggestion.personId ? [suggestion.personId] : [],
        ),
        MAXIMUM_CONTACT_IDS,
      ),
    [contactSuggestions],
  );
  const boundedDismissedSuggestionIds = useMemo(
    () => boundedSortedUnique(dismissedSuggestionIds, MAXIMUM_DISMISSED_IDS),
    [dismissedSuggestionIds],
  );
  const requestKey = JSON.stringify([contactAccountIds, contactPersonIds, boundedDismissedSuggestionIds]);
  const attemptKey = JSON.stringify([
    contactAccountIds,
    contactPersonIds,
    boundedDismissedSuggestionIds,
    sourceVersion,
  ]);
  const [result, setResult] = useState<{
    readonly attemptKey: string;
    readonly requestKey: string;
    readonly sourceVersion: number;
    readonly failed: boolean;
    readonly reader: typeof queryLibraryCore;
    readonly rows: readonly FriendCandidateSuggestion[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!queryLibraryCore) {
      setResult(null);
      return () => {
        cancelled = true;
      };
    }
    const [
      requestContactAccountIds,
      requestContactPersonIds,
      requestDismissedIds,
    ] = JSON.parse(attemptKey) as [string[], string[], string[], number];
    void queryLibraryCore({
      cancellationId: operationId("friend-candidate-query"),
      contactAccountIds: requestContactAccountIds,
      contactPersonIds: requestContactPersonIds,
      dismissedSuggestionIds: requestDismissedIds,
      limit: MAXIMUM_CANDIDATES,
      nowMs: Date.now(),
      queryId: "friend_candidate_review_v1",
      readerSessionId: readerSessionId.current,
      schemaVersion: 1,
    })
      .then((response) => {
        if (cancelled) return;
        setResult({
          attemptKey, requestKey, sourceVersion, failed: false,
          reader: queryLibraryCore,
          rows: Object.freeze(
            response.rows.map(friendCandidateSuggestionFromReviewRow),
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, requestKey, sourceVersion, failed: true, reader: queryLibraryCore, rows: Object.freeze([]) });
      });
    return () => {
      cancelled = true;
    };
  }, [attemptKey, queryLibraryCore]);

  const retained = result !== null && result.reader === queryLibraryCore && result.requestKey === requestKey && result.sourceVersion <= sourceVersion ? result : null;
  const resultsCurrent = retained?.attemptKey === attemptKey && retained.failed === false;
  const failed = retained?.attemptKey === attemptKey && retained.failed;
  return { rows: retained?.rows ?? [], resultsCurrent, status: !queryLibraryCore ? "idle" : failed ? "failed" : resultsCurrent ? "ready" : retained?.rows.length ? "refreshing" : "loading" };
}

export function useLibraryFriendCandidateReview(options: Parameters<typeof useLibraryFriendCandidateReviewState>[0]): readonly FriendCandidateSuggestion[] {
  return useLibraryFriendCandidateReviewState(options).rows;
}
