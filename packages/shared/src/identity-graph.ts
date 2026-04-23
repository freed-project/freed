import type { Account, Person } from "./types.js";

export interface ProvisionalPersonCandidate {
  person: Person;
  accountIds: string[];
}

export function isPrunableConnectionPerson(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  personId: string | null | undefined,
  ignoredAccountIds: string[] = [],
): boolean {
  if (!personId) return false;
  const person = persons[personId];
  if (!person || person.relationshipStatus !== "connection") return false;
  const ignored = new Set(ignoredAccountIds);
  return !Object.values(accounts).some(
    (account) => account.personId === personId && !ignored.has(account.id),
  );
}

const SOCIAL_GRAPH_PROVIDERS = new Set<Account["provider"]>([
  "instagram",
  "facebook",
  "x",
  "linkedin",
]);

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
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
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
      .replace(/[^a-z0-9\s']/g, " ")
  );
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function displayNameForAccount(account: Account): string {
  return normalizeWhitespace(account.displayName ?? account.handle ?? account.externalId);
}

function isLikelyHumanName(value: string): boolean {
  const normalized = normalizeIdentityName(value);
  if (!normalized) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (tokens.some((token) => token.length < 2 || /\d/.test(token))) return false;
  if (tokens.some((token) => ORGANIZATION_KEYWORDS.has(token))) return false;
  return tokens.filter((token) => token.length >= 2).length >= 2;
}

function humanNameForAccount(account: Account): string | null {
  const displayName = displayNameForAccount(account);
  if (!isLikelyHumanName(displayName)) return null;
  const normalized = normalizeIdentityName(displayName);
  return normalized
    .split(" ")
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ");
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
    .filter((account): account is Account => !!account && account.kind === "social");

  if (candidateAccounts.length === 0) return null;

  const nameCounts = new Map<string, number>();
  for (const account of candidateAccounts) {
    const humanName = humanNameForAccount(account);
    if (!humanName) continue;
    nameCounts.set(humanName, (nameCounts.get(humanName) ?? 0) + 1);
  }

  const selectedName = Array.from(nameCounts.entries()).sort((left, right) =>
    right[1] - left[1] ||
    left[0].localeCompare(right[0])
  )[0]?.[0];

  if (!selectedName) return null;

  return {
    id: candidateIdForName(selectedName, candidateAccounts.map((account) => account.id)),
    name: selectedName,
    relationshipStatus: "connection",
    careLevel: 2,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildProvisionalPersonCandidates(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  now: number = Date.now(),
): ProvisionalPersonCandidate[] {
  const existingNames = new Set(
    Object.values(persons).map((person) => normalizeIdentityName(person.name)).filter(Boolean),
  );
  const grouped = new Map<string, string[]>();

  for (const account of Object.values(accounts)) {
    if (account.kind !== "social" || account.personId || !SOCIAL_GRAPH_PROVIDERS.has(account.provider)) {
      continue;
    }
    const humanName = humanNameForAccount(account);
    if (!humanName) continue;
    const normalized = normalizeIdentityName(humanName);
    if (!normalized || existingNames.has(normalized)) continue;
    const bucket = grouped.get(normalized);
    if (bucket) {
      bucket.push(account.id);
    } else {
      grouped.set(normalized, [account.id]);
    }
  }

  const candidates: ProvisionalPersonCandidate[] = [];
  for (const [normalizedName, accountIds] of grouped) {
    const displayName = normalizedName
      .split(" ")
      .filter(Boolean)
      .map(titleCaseWord)
      .join(" ");
    const person = buildConnectionPersonDraftFromAccounts(accounts, accountIds, now, {
      id: candidateIdForName(displayName, accountIds),
      name: displayName,
      relationshipStatus: "connection",
      careLevel: 2,
      createdAt: now,
      updatedAt: now,
    });
    if (!person) continue;
    candidates.push({
      person,
      accountIds: [...accountIds].sort(),
    });
  }

  return candidates.sort((left, right) =>
    right.accountIds.length - left.accountIds.length ||
    left.person.name.localeCompare(right.person.name)
  );
}
