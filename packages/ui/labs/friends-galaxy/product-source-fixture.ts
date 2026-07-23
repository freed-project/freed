import type { Account, Person } from "@freed/shared";
import type { BuildIdentityGraphAtlasModelInput } from "../../src/lib/identity-graph-atlas.js";

function productPerson(index: number): Person {
  return {
    id: `product-person-${index}`,
    name: `Product Person ${index.toLocaleString()}`,
    relationshipStatus: index % 5 === 0 ? "connection" : "friend",
    careLevel: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    createdAt: 1,
    updatedAt: 1,
  };
}

function productAccount(index: number, personCount: number): Account {
  const provider = index % 3 === 0 ? "instagram" : index % 3 === 1 ? "x" : "linkedin";
  return {
    id: `product-account-${index}`,
    personId: index < personCount * 3
      ? `product-person-${index % personCount}`
      : undefined,
    kind: "social",
    provider,
    externalId: `product-author-${index}`,
    handle: `product-author-${index}`,
    displayName: `Product Author ${index.toLocaleString()}`,
    firstSeenAt: 1,
    lastSeenAt: index + 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  };
}

export function createFriendsGalaxyProductSource(
  personCount: number,
  accountCount: number,
): BuildIdentityGraphAtlasModelInput {
  const persons = Array.from({ length: personCount }, (_, index) => productPerson(index));
  const accounts = Object.fromEntries(
    Array.from({ length: accountCount }, (_, index) => {
      const account = productAccount(index, personCount);
      return [account.id, account];
    }),
  );
  return {
    persons,
    accounts,
    feeds: {},
    activitySummaries: { social: {}, rss: {}, buildMs: 0, itemCount: 0 },
    mode: "all_content",
    width: 1,
    height: 1,
  };
}
