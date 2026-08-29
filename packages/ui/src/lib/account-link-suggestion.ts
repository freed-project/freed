export interface AccountLinkSuggestion {
  readonly accountAvatarUrl: string | null;
  readonly accountDisplayName: string | null;
  readonly accountExternalId: string;
  readonly accountHandle: string | null;
  readonly accountId: string;
  readonly accountProvider: string;
  readonly personId: string;
  readonly personAvatarUrl: string | null;
  readonly personName: string;
  readonly confidence: "high" | "medium";
  readonly reason: string;
  readonly score: number;
}
