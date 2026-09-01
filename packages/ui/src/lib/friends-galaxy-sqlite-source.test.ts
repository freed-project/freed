import { describe, expect, it } from "vitest";

import {
  FRIENDS_GALAXY_SQLITE_SOURCE_FENCE_CHANGED,
  normalizeFriendsGalaxySqliteSourceFailure,
} from "./friends-galaxy-sqlite-source.js";

describe("Friends Galaxy SQLite source recovery", () => {
  it.each([
    "normalized Person graph page cursor is stale",
    "normalized Account graph page cursor is stale",
    "normalized RSS Feed page cursor is stale",
  ])("maps the native %s failure to a recoverable source fence", (message) => {
    expect(
      normalizeFriendsGalaxySqliteSourceFailure(new Error(message)),
    ).toMatchObject({ message: FRIENDS_GALAXY_SQLITE_SOURCE_FENCE_CHANGED });
  });

  it("preserves unrelated query failures", () => {
    const failure = new Error("normalized Person graph page row is invalid");
    expect(normalizeFriendsGalaxySqliteSourceFailure(failure)).toBe(failure);
  });
});
