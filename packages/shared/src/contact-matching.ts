import type { ContactMatch, GoogleContact } from "./types.js";
import type {
  LibraryCoreContactMatchRequestV1,
  LibraryCoreNormalizedQueryExecutor,
} from "./library-core/index.js";

function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function contactNames(contact: GoogleContact): readonly string[] {
  const names = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = normalize(value);
    if (normalized) names.add(normalized);
  };
  add(contact.name.displayName);
  if (contact.name.givenName && contact.name.familyName) {
    add(`${contact.name.givenName} ${contact.name.familyName}`);
    add(`${contact.name.familyName} ${contact.name.givenName}`);
  }
  add(contact.name.givenName);
  return Object.freeze([...names].sort().slice(0, 8));
}

function contactEmails(contact: GoogleContact): readonly string[] {
  return Object.freeze(
    [...new Set(contact.emails.map((entry) => normalize(entry.value)).filter(Boolean))]
      .sort()
      .slice(0, 16),
  );
}

export function contactMatchRequestForGoogleContact(
  contact: GoogleContact,
): LibraryCoreContactMatchRequestV1 | null {
  const names = contactNames(contact);
  const emails = contactEmails(contact);
  if (names.length + emails.length === 0) return null;
  return Object.freeze({
    emails,
    names,
    queryId: "contact_match_v1",
    schemaVersion: 1,
  });
}

export async function matchContactsWithLibraryCore(
  contacts: readonly GoogleContact[],
  query: LibraryCoreNormalizedQueryExecutor,
): Promise<ContactMatch[]> {
  const matches: ContactMatch[] = [];
  for (const contact of contacts) {
    const request = contactMatchRequestForGoogleContact(contact);
    if (!request) {
      matches.push({
        accountIds: [],
        confidence: "medium",
        contact,
        personId: null,
      });
      continue;
    }
    const response = await query(request);
    matches.push({
      accountIds: [...response.accountIds],
      confidence: response.confidence,
      contact,
      personId: response.personId,
    });
  }
  return matches.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return left.confidence === "high" ? -1 : 1;
    }
    return (left.contact.name.displayName ?? "").localeCompare(
      right.contact.name.displayName ?? "",
    );
  });
}
