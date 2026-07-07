import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  facebookGroupsFromFeedItems,
  getFacebookGroupDisplayName,
  mergeFacebookGroupRecords,
} from "./facebook-groups";

describe("facebook group records", () => {
  it("repairs stored numeric group names when a real name is found", () => {
    const id = "268672221985841";
    const result = mergeFacebookGroupRecords(
      {
        [id]: {
          id,
          name: id,
          url: `https://www.facebook.com/groups/${id}`,
        },
      },
      [
        {
          id,
          name: "CDA Buy Trade Or SellLast active about a minute ago",
          url: `https://www.facebook.com/groups/${id}`,
        },
      ],
    );

    expect(result.repairedNameCount).toBe(1);
    expect(result.knownGroups[id].name).toBe(
      "CDA Buy Trade Or Sell Last active about a minute ago",
    );
  });

  it("does not overwrite a real name with a relative activity label", () => {
    const result = mergeFacebookGroupRecords(
      {
        one: {
          id: "one",
          name: "North Idaho Life",
          url: "https://www.facebook.com/groups/one",
        },
      },
      [
        {
          id: "one",
          name: "1d",
          url: "https://www.facebook.com/groups/one?sorting_setting=CHRONOLOGICAL",
        },
      ],
    );

    expect(result.repairedNameCount).toBe(0);
    expect(result.knownGroups.one.name).toBe("North Idaho Life");
    expect(result.knownGroups.one.url).toBe(
      "https://www.facebook.com/groups/one?sorting_setting=CHRONOLOGICAL",
    );
  });

  it("uses a visible fallback with the group id tail for missing display names", () => {
    const group = {
      id: "377650389038228",
      name: "5m",
      url: "https://www.facebook.com/groups/377650389038228",
    };

    expect(getFacebookGroupDisplayName(group)).toBe("Facebook group ...89038228");
  });

  it("collects usable group names from already captured feed items", () => {
    const items = [
      {
        platform: "facebook",
        fbGroup: {
          id: "one",
          name: "CDA Buy Trade Or SellLast active 1 day ago",
          url: "https://www.facebook.com/groups/one",
        },
      },
      {
        platform: "facebook",
        fbGroup: {
          id: "two",
          name: "1m",
          url: "https://www.facebook.com/groups/two",
        },
      },
    ] as FeedItem[];

    expect(facebookGroupsFromFeedItems(items)).toEqual([
      {
        id: "one",
        name: "CDA Buy Trade Or Sell Last active 1 day ago",
        url: "https://www.facebook.com/groups/one",
      },
    ]);
  });
});
