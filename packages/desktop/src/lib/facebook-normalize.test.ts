import { describe, expect, it } from "vitest";
import { fbPostToFeedItem } from "@freed/capture-facebook/browser";

describe("fbPostToFeedItem", () => {
  it("maps raw Facebook group metadata to feedItem.fbGroup", () => {
    const item = fbPostToFeedItem({
      id: "123",
      url: "https://www.facebook.com/groups/my-group/posts/123",
      authorName: "Alice Example",
      authorProfileUrl: "https://www.facebook.com/alice.example",
      authorAvatarUrl: null,
      text: "Group post",
      timestampSeconds: 1_700_000_000,
      timestampIso: null,
      mediaUrls: [],
      hasVideo: false,
      likeCount: 12,
      commentCount: 3,
      shareCount: 1,
      postType: "post",
      location: null,
      hashtags: [],
      isShare: false,
      sharedFrom: null,
      group: {
        id: "my-group",
        name: "My Group",
        url: "https://www.facebook.com/groups/my-group",
      },
    });

    expect(item?.fbGroup).toEqual({
      id: "my-group",
      name: "My Group",
      url: "https://www.facebook.com/groups/my-group",
    });
  });
});
