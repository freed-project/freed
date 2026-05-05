import type { Account, Person } from "@freed/shared";

export interface AccountLinkSuggestion {
  accountId: string;
  personId: string;
  confidence: "high" | "medium";
  reason: string;
  score: number;
}

export interface AccountLinkSuggestionGroups {
  byAccount: Map<string, AccountLinkSuggestion[]>;
  byPerson: Map<string, AccountLinkSuggestion[]>;
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

function buildSocialAccountsByPerson(accounts: Account[]): Map<string, Account[]> {
  const grouped = new Map<string, Account[]>();
  for (const account of accounts) {
    if (!account.personId) continue;
    const bucket = grouped.get(account.personId);
    if (bucket) {
      bucket.push(account);
    } else {
      grouped.set(account.personId, [account]);
    }
  }
  return grouped;
}

export function buildAccountLinkSuggestions(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): AccountLinkSuggestion[] {
  const suggestions: AccountLinkSuggestion[] = [];
  visitAccountLinkSuggestions(persons, accounts, (suggestion) => {
    suggestions.push(suggestion);
  });
  return suggestions.sort((left, right) => right.score - left.score);
}

function visitAccountLinkSuggestions(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  visit: (suggestion: AccountLinkSuggestion) => void,
): void {
  const confirmedPersons = Object.values(persons).filter((person) => person.relationshipStatus === "friend");
  const unlinkedAccounts = Object.values(accounts).filter((account) => account.kind === "social" && !account.personId);
  const socialAccountsByPerson = buildSocialAccountsByPerson(
    Object.values(accounts).filter((account) => account.kind === "social"),
  );

  for (const account of unlinkedAccounts) {
    const accountName = normalize(account.displayName);
    const accountHandle = normalize(account.handle);
    const accountTokens = tokenSet(account.displayName || account.handle || account.externalId);

    for (const person of confirmedPersons) {
      const personName = normalize(person.name);
      const personTokens = tokenSet(person.name);
      const evidenceAccounts = socialAccountsByPerson.get(person.id) ?? [];
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

      visit({
        accountId: account.id,
        personId: person.id,
        confidence: score >= 80 ? "high" : "medium",
        reason,
        score,
      });
    }
  }
}

export function groupSuggestionsByAccount(
  suggestions: AccountLinkSuggestion[],
): Map<string, AccountLinkSuggestion[]> {
  const grouped = new Map<string, AccountLinkSuggestion[]>();

  for (const suggestion of suggestions) {
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

export function buildSuggestionsByAccount(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): Map<string, AccountLinkSuggestion[]> {
  return groupSuggestionsByAccount(buildAccountLinkSuggestions(persons, accounts));
}

function insertSortedLimited(
  bucket: AccountLinkSuggestion[],
  suggestion: AccountLinkSuggestion,
  limit: number,
): void {
  bucket.push(suggestion);
  bucket.sort((left, right) => right.score - left.score);
  if (bucket.length > limit) {
    bucket.length = limit;
  }
}

export function buildAccountLinkSuggestionGroups(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
): AccountLinkSuggestionGroups {
  const byAccount = new Map<string, AccountLinkSuggestion[]>();
  const byPerson = new Map<string, AccountLinkSuggestion[]>();

  visitAccountLinkSuggestions(persons, accounts, (suggestion) => {
    let accountBucket = byAccount.get(suggestion.accountId);
    if (!accountBucket) {
      accountBucket = [];
      byAccount.set(suggestion.accountId, accountBucket);
    }
    insertSortedLimited(accountBucket, suggestion, 3);

    let personBucket = byPerson.get(suggestion.personId);
    if (!personBucket) {
      personBucket = [];
      byPerson.set(suggestion.personId, personBucket);
    }
    insertSortedLimited(personBucket, suggestion, 5);
  });

  return { byAccount, byPerson };
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

export function groupSuggestionsByPerson(
  suggestions: AccountLinkSuggestion[],
): Map<string, AccountLinkSuggestion[]> {
  const grouped = new Map<string, AccountLinkSuggestion[]>();

  for (const suggestion of suggestions) {
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

export function buildSuggestionsByPerson(
  persons: Record<string, Person>,
  accounts: Record<string, Account>
): Map<string, AccountLinkSuggestion[]> {
  return groupSuggestionsByPerson(buildAccountLinkSuggestions(persons, accounts));
}
