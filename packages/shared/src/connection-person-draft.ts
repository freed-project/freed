import type { Account, Person } from "./types.js";

const ORGANIZATION_KEYWORDS = new Set([
  "agency",
  "blog",
  "capital",
  "collective",
  "company",
  "daily",
  "digest",
  "foundation",
  "group",
  "inc",
  "journal",
  "llc",
  "magazine",
  "media",
  "network",
  "news",
  "official",
  "podcast",
  "press",
  "radio",
  "society",
  "studio",
  "team",
]);

function hashValue(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeIdentityName(value: string | null | undefined): string {
  return normalizeWhitespace(
    (value ?? "")
      .toLowerCase()
      .replace(/[@._-]+/g, " ")
      .replace(/[^a-z0-9\s']/g, " "),
  );
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function displayNameForAccount(account: Account): string {
  return normalizeWhitespace(
    account.displayName ?? account.handle ?? account.externalId,
  );
}

function humanNameForAccount(account: Account): string | null {
  const displayName = displayNameForAccount(account);
  const normalized = normalizeIdentityName(displayName);
  if (!normalized) return null;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (tokens.some((token) => token.length < 2 || /\d/.test(token))) return null;
  if (tokens.some((token) => ORGANIZATION_KEYWORDS.has(token))) return null;
  return tokens.map(titleCaseWord).join(" ");
}

function candidateIdForName(name: string, accountIds: string[]): string {
  const normalized = normalizeIdentityName(name).replace(/\s+/g, "-");
  const seed = [...accountIds].sort()[0] ?? name;
  return `person:auto:${normalized}:${hashValue(seed)}`;
}

export function buildConnectionPersonDraftFromAccounts(
  accounts: Record<string, Account>,
  accountIds: string[],
  now: number = Date.now(),
  personOverride?: Person,
): Person | null {
  if (personOverride) {
    return {
      ...personOverride,
      relationshipStatus: "connection",
      updatedAt: personOverride.updatedAt ?? now,
      createdAt: personOverride.createdAt ?? now,
    };
  }

  const candidateAccounts = accountIds
    .map((accountId) => accounts[accountId])
    .filter(
      (account): account is Account =>
        Boolean(account) && account.kind === "social",
    );
  if (candidateAccounts.length === 0) return null;

  const nameCounts = new Map<string, number>();
  for (const account of candidateAccounts) {
    const humanName = humanNameForAccount(account);
    if (!humanName) continue;
    nameCounts.set(humanName, (nameCounts.get(humanName) ?? 0) + 1);
  }
  const selectedName = Array.from(nameCounts.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0];
  if (!selectedName) return null;

  return {
    id: candidateIdForName(
      selectedName,
      candidateAccounts.map((account) => account.id),
    ),
    name: selectedName,
    relationshipStatus: "connection",
    careLevel: 2,
    createdAt: now,
    updatedAt: now,
  };
}
