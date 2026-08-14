import type { Account, Person, RssFeed } from "@freed/shared";

function sameKeys(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key));
}

function samePerson(left: Person, right: Person): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    left.avatarUrl === right.avatarUrl &&
    left.relationshipStatus === right.relationshipStatus &&
    left.careLevel === right.careLevel &&
    left.graphPinned === right.graphPinned &&
    left.graphX === right.graphX &&
    left.graphY === right.graphY;
}

function sameAccount(left: Account, right: Account): boolean {
  return left.id === right.id &&
    left.personId === right.personId &&
    left.kind === right.kind &&
    left.provider === right.provider &&
    left.externalId === right.externalId &&
    left.handle === right.handle &&
    left.displayName === right.displayName &&
    left.avatarUrl === right.avatarUrl &&
    left.graphPinned === right.graphPinned &&
    left.graphX === right.graphX &&
    left.graphY === right.graphY;
}

function sameFeed(left: RssFeed, right: RssFeed): boolean {
  return left.url === right.url &&
    left.title === right.title &&
    left.imageUrl === right.imageUrl &&
    left.enabled === right.enabled;
}

export function sameFriendsGalaxyPersons(
  left: readonly Person[],
  right: readonly Person[],
): boolean {
  return left === right || (
    left.length === right.length &&
    left.every((person, index) => samePerson(person, right[index]!))
  );
}

export function sameFriendsGalaxyAccounts(
  left: Readonly<Record<string, Account>>,
  right: Readonly<Record<string, Account>>,
): boolean {
  if (left === right) return true;
  if (!sameKeys(left, right)) return false;
  return Object.keys(left).every((id) => sameAccount(left[id]!, right[id]!));
}

export function sameFriendsGalaxyFeeds(
  left: Readonly<Record<string, RssFeed>>,
  right: Readonly<Record<string, RssFeed>>,
): boolean {
  if (left === right) return true;
  if (!sameKeys(left, right)) return false;
  return Object.keys(left).every((url) => sameFeed(left[url]!, right[url]!));
}
