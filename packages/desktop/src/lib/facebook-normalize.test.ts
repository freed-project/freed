import { describe, expect, it } from "vitest";
import type { RawFbPost } from "@freed/capture-facebook/browser";
import { fbPostToFeedItem } from "@freed/capture-facebook/browser";

describe("fbPostToFeedItem", () => {
  function rawPost(overrides: Partial<RawFbPost> = {}): RawFbPost {
    return {
      id: "123",
      url: "https://www.facebook.com/story.php?story_fbid=123&id=999",
      authorName: "Alice Example",
      authorProfileUrl: "https://www.facebook.com/alice.example",
      authorAvatarUrl: null,
      text: "Facebook post",
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
      group: null,
      ...overrides,
    };
  }

  it("maps raw Facebook group metadata to feedItem.fbGroup", () => {
    const item = fbPostToFeedItem(rawPost({
      url: "https://www.facebook.com/groups/my-group/posts/123",
      text: "Group post",
      group: {
        id: "my-group",
        name: "My Group",
        url: "https://www.facebook.com/groups/my-group",
      },
    }));

    expect(item?.fbGroup).toEqual({
      id: "my-group",
      name: "My Group",
      url: "https://www.facebook.com/groups/my-group",
    });
  });

  it("rejects Facebook registration UI as an author", () => {
    expect(fbPostToFeedItem(rawPost({
      authorName: "Create New Account",
      authorProfileUrl: "https://www.facebook.com/r.php",
    }))).toBeNull();
  });

  it("rejects Facebook shortcut UI as an author", () => {
    expect(fbPostToFeedItem(rawPost({
      authorName: "Your Shortcuts",
      authorProfileUrl: "https://www.facebook.com/bookmarks",
    }))).toBeNull();
  });

  it("keeps a normal Facebook author", () => {
    const item = fbPostToFeedItem(rawPost({
      authorName: "Zana Prana",
      authorProfileUrl: "https://www.facebook.com/zana.prana",
    }));

    expect(item?.author).toMatchObject({
      id: "fb:zana.prana",
      displayName: "Zana Prana",
    });
  });
});
