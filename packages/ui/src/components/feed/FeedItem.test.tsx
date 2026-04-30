/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { PlatformProvider, type PlatformConfig } from "../../context/PlatformContext.js";
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

const platformConfig = {
  feedMediaPreviews: "inline",
  store: () => undefined,
  SourceIndicator: null,
  HeaderSyncIndicator: null,
  SettingsExtraSections: null,
  LegalSettingsContent: null,
  FeedEmptyState: null,
  XSettingsContent: null,
  FacebookSettingsContent: null,
  InstagramSettingsContent: null,
  LinkedInSettingsContent: null,
  GoogleContactsSettingsContent: null,
} as unknown as PlatformConfig;

function renderFeedItemToStaticMarkup(
  item: FeedItemType,
  props: Partial<ComponentProps<typeof FeedItem>> = {},
): string {
  return renderToStaticMarkup(
    <PlatformProvider value={platformConfig}>
      <FeedItem item={item} {...props} />
    </PlatformProvider>,
  );
}

describe("FeedItem read styling", () => {
  it("applies read styling to story tiles", () => {
    const html = renderFeedItemToStaticMarkup(makeItem({ userState: { readAt: NOW } }));

    expect(html).toContain("grayscale opacity-60");
  });

  it("leaves unread story tiles unstyled", () => {
    const html = renderFeedItemToStaticMarkup(makeItem());

    expect(html).not.toContain("grayscale opacity-60");
  });

  it("keeps regular feed cards styled as read", () => {
    const html = renderFeedItemToStaticMarkup(
      makeItem({
          globalId: "item-2",
          platform: "facebook",
          contentType: "post",
          content: {
            text: "Post text",
            mediaUrls: [],
            mediaTypes: [],
          },
          userState: { readAt: NOW },
        }),
    );

    expect(html).toContain("grayscale opacity-60");
  });
});

describe("FeedItem story media", () => {
  it("shares the feed card view transition name in primary story tiles", () => {
    const html = renderFeedItemToStaticMarkup(makeItem({ globalId: "ig:story/transition proof" }));

    expect(html).toContain("view-transition-name:feed-card-ig-story-transition-proof");
  });

  it("shares the feed card view transition name in compact story tiles", () => {
    const html = renderFeedItemToStaticMarkup(
      makeItem({ globalId: "ig:story/compact transition proof" }),
      { compact: true },
    );

    expect(html).toContain("view-transition-name:feed-card-ig-story-compact-transition-proof");
  });

  it("renders image stories as images", () => {
    const html = renderFeedItemToStaticMarkup(makeItem());

    expect(html).toContain("<img");
    expect(html).toContain("https://example.com/story.jpg");
    expect(html).not.toContain("<video");
  });

  it("renders video stories as playable videos", () => {
    const html = renderFeedItemToStaticMarkup(
      makeItem({
          content: {
            mediaUrls: ["https://example.com/story.mp4"],
            mediaTypes: ["video"],
          },
        }),
    );

    expect(html).toContain("<video");
    expect(html).toContain("controls=");
    expect(html).toContain("playsInline=");
    expect(html).toContain("https://example.com/story.mp4");
  });

  it("falls back to the gradient when story media fails", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={platformConfig}>
            <FeedItem item={makeItem()} />
          </PlatformProvider>,
        );
      });

      const image = container.querySelector("img[src='https://example.com/story.jpg']");
      expect(image).toBeInstanceOf(HTMLImageElement);

      await act(async () => {
        image?.dispatchEvent(new Event("error", { bubbles: true }));
      });

      expect(container.querySelector("img[src='https://example.com/story.jpg']")).toBeNull();
      expect(container.querySelector(".bg-gradient-to-br")).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});

describe("FeedItem channel avatars", () => {
  it("falls back to the channel initial when a story avatar fails", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={platformConfig}>
            <FeedItem
              item={makeItem({
                author: {
                  displayName: "Lotus Alchemist",
                  avatarUrl: "https://example.com/avatar.jpg",
                },
              })}
            />
          </PlatformProvider>,
        );
      });

      const avatar = container.querySelector("img[src='https://example.com/avatar.jpg']");
      expect(avatar).toBeInstanceOf(HTMLImageElement);

      await act(async () => {
        avatar?.dispatchEvent(new Event("error", { bubbles: true }));
      });

      expect(container.querySelector("img[src='https://example.com/avatar.jpg']")).toBeNull();
      expect(container.textContent).toContain("L");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("falls back to the channel initial when a regular post avatar fails", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={platformConfig}>
            <FeedItem
              item={makeItem({
                contentType: "post",
                author: {
                  displayName: "Lotus Alchemist",
                  avatarUrl: "https://example.com/post-avatar.jpg",
                },
                content: {
                  mediaUrls: [],
                  mediaTypes: [],
                },
              })}
            />
          </PlatformProvider>,
        );
      });

      const avatar = container.querySelector("img[src='https://example.com/post-avatar.jpg']");
      expect(avatar).toBeInstanceOf(HTMLImageElement);

      await act(async () => {
        avatar?.dispatchEvent(new Event("error", { bubbles: true }));
      });

      expect(container.querySelector("img[src='https://example.com/post-avatar.jpg']")).toBeNull();
      expect(container.textContent).toContain("L");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});
