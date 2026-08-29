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
export function useLibraryFriendCandidateReview({
  contactSuggestions,
  dismissedSuggestionIds,
  sourceVersion,
}: {
  readonly contactSuggestions: readonly IdentitySuggestion[];
  readonly dismissedSuggestionIds: readonly string[];
  readonly sourceVersion: number;
}): readonly FriendCandidateSuggestion[] {
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
  const attemptKey = JSON.stringify([
    contactAccountIds,
    contactPersonIds,
    boundedDismissedSuggestionIds,
    sourceVersion,
  ]);
  const [result, setResult] = useState<{
    readonly attemptKey: string;
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
    void queryLibraryCore({
      cancellationId: operationId("friend-candidate-query"),
      contactAccountIds,
      contactPersonIds,
      dismissedSuggestionIds: boundedDismissedSuggestionIds,
      limit: MAXIMUM_CANDIDATES,
      nowMs: Date.now(),
      queryId: "friend_candidate_review_v1",
      readerSessionId: readerSessionId.current,
      schemaVersion: 1,
    })
      .then((response) => {
        if (cancelled) return;
        setResult({
          attemptKey,
          rows: Object.freeze(
            response.rows.map(friendCandidateSuggestionFromReviewRow),
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ attemptKey, rows: Object.freeze([]) });
      });
    return () => {
      cancelled = true;
    };
  }, [
    attemptKey,
    boundedDismissedSuggestionIds,
    contactAccountIds,
    contactPersonIds,
    queryLibraryCore,
  ]);

  return result?.attemptKey === attemptKey ? result.rows : [];
}
