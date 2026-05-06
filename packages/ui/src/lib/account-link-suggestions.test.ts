import { describe, expect, it } from "vitest";
import type { Account, Person } from "@freed/shared";
import { buildAccountLinkSuggestionGroups } from "./account-link-suggestions";

function person(id: string, name: string): Person {
  return {
    id,
    name,
    relationshipStatus: "friend",
    careLevel: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}

function socialAccount(
  id: string,
  overrides: Partial<Account> & Pick<Account, "externalId">,
): Account {
  return {
    id,
    kind: "social",
    provider: "instagram",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("account link suggestions", () => {
  it("finds exact names, matching linked handles, and avatar matches through indexed candidates", () => {
    const persons = {
      ada: person("ada", "Ada Lovelace"),
      grace: person("grace", "Grace Hopper"),
      katherine: person("katherine", "Katherine Johnson"),
    };
    const accounts: Record<string, Account> = {
      adaLinked: socialAccount("adaLinked", {
        personId: "ada",
        externalId: "ada-linked",
        handle: "ada.codes",
      }),
      graceLinked: socialAccount("graceLinked", {
        personId: "grace",
        externalId: "grace-linked",
        avatarUrl: "https://example.com/grace.jpg",
      }),
      exactName: socialAccount("exactName", {
        externalId: "exact-name",
        displayName: "Ada Lovelace",
      }),
      matchingHandle: socialAccount("matchingHandle", {
        externalId: "matching-handle",
        displayName: "A. L.",
        handle: "ada.codes",
      }),
      matchingAvatar: socialAccount("matchingAvatar", {
        externalId: "matching-avatar",
        displayName: "Grace Hopper",
        avatarUrl: "https://example.com/grace.jpg",
      }),
    };

    const groups = buildAccountLinkSuggestionGroups(persons, accounts);

    expect(groups.byAccount.get("exactName")?.[0]).toMatchObject({
      personId: "ada",
      confidence: "high",
    });
    expect(groups.byAccount.get("matchingHandle")?.[0]).toMatchObject({
      personId: "ada",
      confidence: "high",
    });
    expect(groups.byAccount.get("matchingAvatar")?.[0]).toMatchObject({
      personId: "grace",
      confidence: "high",
    });
    expect(groups.byPerson.get("katherine")).toBeUndefined();
  });

  it("keeps common-token scale work bounded", () => {
    const persons = Object.fromEntries(
      Array.from({ length: 1_600 }, (_, index) => [
        `person-${index}`,
        person(`person-${index}`, `Scale Person ${index}`),
      ]),
    );
    const accounts = Object.fromEntries(
      Array.from({ length: 1_920 }, (_, index) => {
        const linked = index < 1_600;
        const id = `account-${index}`;
        return [
          id,
          socialAccount(id, {
            personId: linked ? `person-${index}` : undefined,
            externalId: `author-${index}`,
            displayName: `Scale Person ${index % 1_600}`,
          }),
        ];
      }),
    );

    const startedAt = performance.now();
    const groups = buildAccountLinkSuggestionGroups(persons, accounts);
    const elapsed = performance.now() - startedAt;

    expect(groups.byAccount.size).toBe(320);
    expect(elapsed).toBeLessThan(200);
  });
});
