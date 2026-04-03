import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { FeedItem } from "./FeedItem";

const NOW = 1_712_147_200_000;

type FeedItemOverrides = Omit<Partial<FeedItemType>, "author" | "content" | "userState"> & {
  author?: Partial<FeedItemType["author"]>;
  content?: Partial<FeedItemType["content"]>;
  userState?: Partial<FeedItemType["userState"]>;
};

function makeItem(overrides: FeedItemOverrides = {}): FeedItemType {
  const base: FeedItemType = {
    globalId: "item-1",
    platform: "instagram",
    contentType: "story",
    capturedAt: NOW,
    publishedAt: NOW - 60_000,
    author: {
      id: "author-1",
      handle: "story.tester",
      displayName: "Story Tester",
    },
    content: {
      text: "Story text",
      mediaUrls: ["https://example.com/story.jpg"],
      mediaTypes: ["image"],
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };

  const { author, content, userState, ...rest } = overrides;

  return {
    ...base,
    ...rest,
    author: {
      ...base.author,
      ...author,
    },
    content: {
      ...base.content,
      ...content,
    },
    userState: {
      ...base.userState,
      ...userState,
    },
  };
}

describe("FeedItem read styling", () => {
  it("applies read styling to story tiles", () => {
    const html = renderToStaticMarkup(
      <FeedItem item={makeItem({ userState: { readAt: NOW } })} />,
    );

    expect(html).toContain("grayscale opacity-60");
  });

  it("leaves unread story tiles unstyled", () => {
    const html = renderToStaticMarkup(<FeedItem item={makeItem()} />);

    expect(html).not.toContain("grayscale opacity-60");
  });

  it("keeps regular feed cards styled as read", () => {
    const html = renderToStaticMarkup(
      <FeedItem
        item={makeItem({
          globalId: "item-2",
          platform: "facebook",
          contentType: "post",
          content: {
            text: "Post text",
            mediaUrls: [],
            mediaTypes: [],
          },
          userState: { readAt: NOW },
        })}
      />,
    );

    expect(html).toContain("grayscale opacity-60");
  });
});
