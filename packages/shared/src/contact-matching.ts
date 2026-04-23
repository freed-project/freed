import { primaryContactAccountForPerson, socialAccountsForPerson } from "./friends.js";
import type { Account, ContactMatch, FeedItem, GoogleContact, Person } from "./types.js";

function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function splitHandle(handle: string): string[] {
  return handle
    .split(/[._\-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function getContactNames(contact: GoogleContact): Set<string> {
  const names = new Set<string>();
  if (contact.name.displayName) names.add(normalize(contact.name.displayName));
  if (contact.name.givenName && contact.name.familyName) {
    names.add(normalize(`${contact.name.givenName} ${contact.name.familyName}`));
    names.add(normalize(`${contact.name.familyName} ${contact.name.givenName}`));
  }
  if (contact.name.givenName) names.add(normalize(contact.name.givenName));
  return names;
}

export function matchContacts(
  contacts: GoogleContact[],
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  feedItems: FeedItem[]
): ContactMatch[] {
  const personList = Object.values(persons);
  const authorMap = new Map<string, { displayName: string; handle?: string }>();

  for (const item of feedItems) {
    if (item.author?.id && item.author?.displayName && !authorMap.has(item.author.id)) {
      authorMap.set(item.author.id, {
        displayName: item.author.displayName,
        handle: item.author.handle,
      });
    }
  }

  const results: ContactMatch[] = [];

  for (const contact of contacts) {
    const contactNames = getContactNames(contact);
    const contactEmails = new Set(contact.emails.map((entry) => entry.value.toLowerCase()));

    let matchedPerson: Person | null = null;
    let confidence: "high" | "medium" = "medium";
    const matchedAuthorIds: string[] = [];

    for (const person of personList) {
      const personName = normalize(person.name);
      const primaryContact = primaryContactAccountForPerson(accounts, person.id);

      if (primaryContact?.email && contactEmails.has(primaryContact.email.toLowerCase())) {
        matchedPerson = person;
        confidence = "high";
        break;
      }

      if (contactNames.has(personName)) {
        matchedPerson = person;
        confidence = "high";
        break;
      }

      for (const account of socialAccountsForPerson(accounts, person.id)) {
        if (account.handle) {
          const reconstructed = normalize(splitHandle(account.handle).join(" "));
          if (contactNames.has(reconstructed)) {
            matchedPerson = person;
            confidence = "medium";
          }
        }
      }
    }

    for (const [authorId, author] of authorMap) {
      const alreadyLinked = Object.values(accounts).some((account) =>
        account.kind === "social" && account.externalId === authorId && Boolean(account.personId)
      );
      if (alreadyLinked) continue;

      const authorName = normalize(author.displayName);
      if (contactNames.has(authorName)) {
        matchedAuthorIds.push(authorId);
        if (confidence !== "high") confidence = "high";
      } else if (author.handle) {
        const reconstructed = normalize(splitHandle(author.handle).join(" "));
        if (contactNames.has(reconstructed)) {
          matchedAuthorIds.push(authorId);
          if (confidence !== "high") confidence = "medium";
        }
      }
    }

    results.push({
      contact,
      person: matchedPerson,
      authorIds: matchedAuthorIds,
      confidence,
    });
  }

  return results.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence === "high" ? -1 : 1;
    }
    const nameA = a.contact.name.displayName ?? "";
    const nameB = b.contact.name.displayName ?? "";
    return nameA.localeCompare(nameB);
  });
}
