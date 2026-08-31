import type { Account, GoogleContact } from "./types.js";

export function createContactAccountFromGoogleContact(
  contact: GoogleContact,
  importedAt: number,
  personId?: string,
): Account {
  return {
    id: `contact:google:${contact.resourceName}`,
    personId,
    kind: "contact",
    provider: "google_contacts",
    externalId: contact.resourceName,
    displayName: contact.name.displayName ?? contact.name.givenName ?? "",
    avatarUrl: contact.photos[0]?.url,
    email: contact.emails[0]?.value,
    phone: contact.phones[0]?.value,
    importedAt,
    firstSeenAt: importedAt,
    lastSeenAt: importedAt,
    discoveredFrom: "contact_import",
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
