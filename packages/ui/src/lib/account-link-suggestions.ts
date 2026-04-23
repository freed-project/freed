import { socialAccountsForPerson, type Account, type Person } from "@freed/shared";

export interface AccountLinkSuggestion {
  accountId: string;
  personId: string;
  confidence: "high" | "medium";
  reason: string;
  score: number;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[@._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 2)
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function personAccountEvidence(person: Person, accounts: Record<string, Account>) {
  return socialAccountsForPerson(accounts, person.id);
}

export function buildAccountLinkSuggestions(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): AccountLinkSuggestion[] {
  const confirmedPersons = Object.values(persons).filter((person) => person.relationshipStatus === "friend");
  const unlinkedAccounts = Object.values(accounts).filter((account) => account.kind === "social" && !account.personId);
  const suggestions: AccountLinkSuggestion[] = [];

  for (const account of unlinkedAccounts) {
    const accountName = normalize(account.displayName);
    const accountHandle = normalize(account.handle);
    const accountTokens = tokenSet(account.displayName || account.handle || account.externalId);

    for (const person of confirmedPersons) {
      const personName = normalize(person.name);
      const personTokens = tokenSet(person.name);
      const evidenceAccounts = personAccountEvidence(person, accounts);
      const exactHandleMatch = evidenceAccounts.some(
        (candidate) => normalize(candidate.handle) && normalize(candidate.handle) === accountHandle,
      );
      const exactNameMatch = accountName !== "" && accountName === personName;
      const tokenOverlap = overlapScore(accountTokens, personTokens);
      const avatarMatch = !!(account.avatarUrl && evidenceAccounts.some((candidate) => candidate.avatarUrl && candidate.avatarUrl === account.avatarUrl));

      let score = 0;
      let reason = "";

      if (exactHandleMatch) {
        score += 95;
        reason = "Same handle as an account already linked to this friend.";
      }
      if (exactNameMatch) {
        score = Math.max(score, 84);
        reason = reason || "Display name matches this friend's name exactly.";
      }
      if (tokenOverlap >= 0.8) {
        score = Math.max(score, 72);
        reason = reason || "Display name strongly overlaps this friend's name.";
      } else if (tokenOverlap >= 0.5) {
        score = Math.max(score, 58);
        reason = reason || "Display name partially overlaps this friend's name.";
      }
      if (avatarMatch && tokenOverlap >= 0.5) {
        score = Math.max(score, 88);
        reason = "Avatar and name both align with this friend.";
      }

      if (score < 58) continue;

      suggestions.push({
        accountId: account.id,
        personId: person.id,
        confidence: score >= 80 ? "high" : "medium",
        reason,
        score,
      });
    }
  }

  return suggestions.sort((left, right) => right.score - left.score);
}

export function buildSuggestionsByAccount(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): Map<string, AccountLinkSuggestion[]> {
  const grouped = new Map<string, AccountLinkSuggestion[]>();

  for (const suggestion of buildAccountLinkSuggestions(persons, accounts)) {
    if (!grouped.has(suggestion.accountId)) {
      grouped.set(suggestion.accountId, []);
    }
    const bucket = grouped.get(suggestion.accountId);
    if (!bucket) continue;
    if (bucket.length >= 3) continue;
    bucket.push(suggestion);
  }

  return grouped;
}

export function buildSuggestionStrengthByAccount(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): Map<string, "high" | "medium"> {
  const grouped = buildSuggestionsByAccount(persons, accounts);
  return new Map(
    Array.from(grouped.entries()).map(([accountId, suggestions]) => [
      accountId,
      suggestions.some((suggestion) => suggestion.confidence === "high") ? "high" : "medium",
    ])
  );
}

export function buildSuggestionsByPerson(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): Map<string, AccountLinkSuggestion[]> {
  const grouped = new Map<string, AccountLinkSuggestion[]>();

  for (const suggestion of buildAccountLinkSuggestions(persons, accounts)) {
    if (!grouped.has(suggestion.personId)) {
      grouped.set(suggestion.personId, []);
    }
    grouped.get(suggestion.personId)?.push(suggestion);
  }

  for (const [personId, suggestions] of grouped) {
    grouped.set(personId, suggestions.sort((left, right) => right.score - left.score).slice(0, 5));
  }

  return grouped;
}
