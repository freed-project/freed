import type {
  ContentSignal,
  FriendCandidateReason,
  FriendCandidateReasonCode,
  FriendCandidateSuggestion,
} from "./types.js";
import type { LibraryCoreFriendCandidateReviewRowV1 } from "./library-core/friend-candidate-review-contracts.js";

const REASON_LABELS: Record<FriendCandidateReasonCode, string> = {
  personal_updates: "Personal updates",
  life_events: "Life events",
  direct_requests: "Direct asks",
  places_and_moments: "Places and moments",
  multi_channel_identity: "Multiple linked channels",
  recent_activity: "Recent activity",
  contact_overlap: "Contact overlap",
};

const UTF8_ENCODER = new TextEncoder();

export function compareUtf8Binary(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function friendCandidateActivitySourceKey(
  platform: string,
  authorId: string,
): string {
  return JSON.stringify([platform, authorId]);
}

function addReason(
  reasons: FriendCandidateReason[],
  code: FriendCandidateReasonCode,
  score: number,
): void {
  if (score <= 0) return;
  reasons.push({
    code,
    label: REASON_LABELS[code],
    score: Math.round(score),
  });
}

/** Convert one closed, bounded SQLite review row into the shared UI model. */
export function friendCandidateSuggestionFromReviewRow(
  row: LibraryCoreFriendCandidateReviewRowV1,
): FriendCandidateSuggestion {
  const accountIds = JSON.parse(row.accountIdsJson) as string[];
  const sampleItemIds = JSON.parse(row.sampleItemIdsJson) as string[];
  const signalCounts = JSON.parse(row.signalCountsJson) as Partial<
    Record<ContentSignal, number>
  >;
  const reasons: FriendCandidateReason[] = [];
  addReason(reasons, "personal_updates", row.personalUpdatesScore);
  addReason(reasons, "life_events", row.lifeEventsScore);
  addReason(reasons, "direct_requests", row.directRequestsScore);
  addReason(reasons, "places_and_moments", row.placesMomentsScore);
  addReason(reasons, "multi_channel_identity", row.multiChannelScore);
  addReason(reasons, "recent_activity", row.recentActivityScore);
  addReason(reasons, "contact_overlap", row.contactOverlapScore);
  return {
    id: row.id,
    kind: row.kind,
    personId: row.personId ?? undefined,
    accountIds,
    displayName: row.displayName,
    score: row.score,
    confidence: row.confidence,
    reasons: reasons
      .sort(
        (left, right) =>
          right.score - left.score || left.code.localeCompare(right.code),
      )
      .slice(0, 4),
    signalCounts,
    lastActivityAt: row.lastActivityAt ?? undefined,
    sampleItemIds,
  };
}
