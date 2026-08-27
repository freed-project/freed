export interface AccountLinkSuggestion {
  readonly accountId: string;
  readonly personId: string;
  readonly confidence: "high" | "medium";
  readonly reason: string;
  readonly score: number;
}
