import { friendCandidateActivitySourceKey } from "@freed/shared";

export interface IdentityGraphActivitySummary {
  itemCount: number;
  latestActivityAt: number;
  sampleItemIds: string[];
  hasLocation: boolean;
  avatarUrl: string | null;
  avatarPublishedAt: number | null;
  avatarGlobalId: string | null;
}

export interface IdentityGraphActivitySummaries {
  social: Record<string, IdentityGraphActivitySummary>;
  rss: Record<string, IdentityGraphActivitySummary>;
  buildMs: number;
  itemCount: number;
}

export const EMPTY_IDENTITY_GRAPH_ACTIVITY_SUMMARIES: IdentityGraphActivitySummaries =
  Object.freeze({
    social: Object.freeze({}),
    rss: Object.freeze({}),
    buildMs: 0,
    itemCount: 0,
  });

export function socialActivitySummaryKey(
  provider: string,
  externalId: string,
): string {
  return friendCandidateActivitySourceKey(provider, externalId);
}
