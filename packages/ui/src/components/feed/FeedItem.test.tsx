/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { PlatformProvider, type PlatformConfig } from "../../context/PlatformContext.js";
import { useDebugStore, type RuntimeMemorySnapshot } from "../../lib/debug-store.js";
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

const readerOnlyPlatformConfig = {
  ...platformConfig,
  feedMediaPreviews: "reader-only",
} as unknown as PlatformConfig;

function setMemoryPressure(
  pressureLevel: RuntimeMemorySnapshot["pressureLevel"],
  overrides: Partial<RuntimeMemorySnapshot> = {},
): void {
  useDebugStore.setState({
    runtimeMemory: {
      processResidentBytes: 0,
      processVirtualBytes: 0,
      relayDocBytes: 0,
      relayClientCount: 0,
      contentQueuePending: 0,
      contentCompleted: 0,
      contentFailed: 0,
      contentActive: false,
      contentBackoffLevel: 0,
      sampleTs: Date.now(),
      pressureLevel,
      ...overrides,
    },
  });
}

beforeEach(() => {
  useDebugStore.setState({ runtimeMemory: null });
  setMobileNavigator(false);
  setTouchOnlyPointer(false);
});

function setMobileNavigator(mobile: boolean): void {
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { mobile },
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: mobile ? 5 : 0,
  });
}

function setTouchOnlyPointer(touchOnly: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)"
        ? touchOnly
        : query === "(any-hover: hover)"
          ? !touchOnly
          : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

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

describe("FeedItem card text previews", () => {
  it("renders a bounded text preview for long regular posts", () => {
    const longText = `${"Opening sentence ".repeat(120)}needle-tail`;
    const html = renderFeedItemToStaticMarkup(
      makeItem({
        globalId: "item-long",
        platform: "rss",
        contentType: "post",
        content: {
          text: longText,
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
    );

    expect(html).toContain("Opening sentence");
    expect(html).toContain("...");
    expect(html).not.toContain("needle-tail");
  });

  it("keeps short regular post text intact", () => {
    const html = renderFeedItemToStaticMarkup(
      makeItem({
        globalId: "item-short",
        platform: "rss",
        contentType: "post",
        content: {
          text: "A short post stays readable.",
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
    );

    expect(html).toContain("A short post stays readable.");
  });
});

describe("FeedItem story media", () => {
  it("shares the feed card view transition name in primary story tiles", () => {
    const html = renderFeedItemToStaticMarkup(makeItem({ globalId: "ig:story/transition proof" }));

    expect(html).toContain("view-transition-name:feed-card-ig-story-transition-proof");
  });

  it("opens touch mobile story cards on the first tap without quick actions", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMobileNavigator(true);
    const onClick = vi.fn();
    const onSave = vi.fn();
    const onArchive = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={platformConfig}>
            <FeedItem
              item={makeItem()}
              onClick={onClick}
              onSave={onSave}
              onArchive={onArchive}
            />
          </PlatformProvider>,
        );
      });

      expect(container.querySelector('button[aria-label="Bookmark"]')).toBeNull();
      expect(container.querySelector('button[aria-label="Archive"]')).toBeNull();

      const card = container.querySelector('[role="button"]') as HTMLElement | null;
      expect(card).toBeInstanceOf(HTMLElement);
      await act(async () => {
        card?.click();
      });

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
      expect(onArchive).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      setMobileNavigator(false);
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("opens touch mobile regular cards without rendering quick action buttons", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setTouchOnlyPointer(true);
    const onClick = vi.fn();
    const onSave = vi.fn();
    const onArchive = vi.fn();
    const onLike = vi.fn();
    const onOpenCommentUrl = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={platformConfig}>
            <FeedItem
              item={makeItem({
                platform: "facebook",
                contentType: "post",
                sourceUrl: "https://example.com/post",
                content: {
                  text: "Post text",
                  mediaUrls: [],
                  mediaTypes: [],
                },
              })}
              fixedHeight={220}
              onClick={onClick}
              onSave={onSave}
              onArchive={onArchive}
              onLike={onLike}
              onOpenCommentUrl={onOpenCommentUrl}
            />
          </PlatformProvider>,
        );
      });

      for (const label of ["Like", "Comment on Facebook", "Bookmark", "Archive", "Open"]) {
        expect(container.querySelector(`button[aria-label="${label}"]`)).toBeNull();
      }

      const card = container.querySelector('[role="button"]') as HTMLElement | null;
      expect(card).toBeInstanceOf(HTMLElement);
      await act(async () => {
        card?.click();
      });

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
      expect(onArchive).not.toHaveBeenCalled();
      expect(onLike).not.toHaveBeenCalled();
      expect(onOpenCommentUrl).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      setMobileNavigator(false);
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("renders regular card actions in a shared centered icon box", async () => {
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
                platform: "instagram",
                contentType: "post",
                sourceUrl: "https://example.com/post",
                content: {
                  text: "Post text",
                  mediaUrls: [],
                  mediaTypes: [],
                },
              })}
              fixedHeight={220}
              onLike={vi.fn()}
              onSave={vi.fn()}
              onArchive={vi.fn()}
              onOpenCommentUrl={vi.fn()}
            />
          </PlatformProvider>,
        );
      });

      const actionLabels = ["Like", "Comment on Instagram", "Bookmark", "Archive", "Open"];
      for (const label of actionLabels) {
        const button = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
        expect(button).toBeInstanceOf(HTMLButtonElement);
        expect(button?.className).toContain("h-7");
        expect(button?.className).toContain("items-center");
        expect(button?.className).toContain("justify-center");

        const icon = button?.querySelector("svg");
        expect(icon?.getAttribute("class")).toContain("h-4");
        expect(icon?.getAttribute("class")).toContain("w-4");
        expect(icon?.getAttribute("class")).toContain("shrink-0");
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
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

  it("suppresses non-story feed media when the platform uses reader-only previews", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={readerOnlyPlatformConfig}>
            <FeedItem
              item={makeItem({
                contentType: "post",
                content: {
                  text: "Post text",
                  mediaUrls: ["https://example.com/post.jpg"],
                  mediaTypes: ["image"],
                },
              })}
              fixedHeight={220}
            />
          </PlatformProvider>,
        );
      });

      expect(container.querySelector("img[src='https://example.com/post.jpg']")).toBeNull();
      expect(container.textContent).toContain("Post text");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("renders story media when the platform uses reader-only previews", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PlatformProvider value={readerOnlyPlatformConfig}>
            <FeedItem item={makeItem()} />
          </PlatformProvider>,
        );
      });

      expect(container.querySelector("img[src='https://example.com/story.jpg']")).toBeInstanceOf(HTMLImageElement);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("suppresses story images under renderer memory pressure", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("high");
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

  it("suppresses regular feed media under renderer memory pressure", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("critical");
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
                content: {
                  text: "Post text",
                  mediaUrls: ["https://example.com/post.jpg"],
                  mediaTypes: ["image"],
                },
              })}
              fixedHeight={220}
            />
          </PlatformProvider>,
        );
      });

      expect(container.querySelector("img[src='https://example.com/post.jpg']")).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
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

  it("keeps inline media below the native app pressure threshold", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      appMemoryPressureBytes: Math.floor(2.5 * 1024 * 1024 * 1024),
      memoryHighBytes: Math.floor(5.5 * 1024 * 1024 * 1024),
    });
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

      expect(container.querySelector("img[src='https://example.com/story.jpg']")).toBeInstanceOf(HTMLImageElement);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("keeps inline media below the native WebKit pressure threshold", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      webkitTotalResidentBytes: Math.floor(1.7 * 1024 * 1024 * 1024),
      memoryHighBytes: Math.floor(5.5 * 1024 * 1024 * 1024),
    });
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

      expect(container.querySelector("img[src='https://example.com/story.jpg']")).toBeInstanceOf(HTMLImageElement);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("keeps inline media when WebKit resident is high but footprint is below pressure limits", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      appMemoryPressureBytes: Math.floor(2.6 * 1024 * 1024 * 1024),
      memoryHighBytes: Math.floor(5.5 * 1024 * 1024 * 1024),
      webkitTotalFootprintBytes: Math.floor(2.5 * 1024 * 1024 * 1024),
      webkitLargestResidentBytes: Math.floor(4.7 * 1024 * 1024 * 1024),
    });
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

      expect(container.querySelector("img[src='https://example.com/story.jpg']")).toBeInstanceOf(HTMLImageElement);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("suppresses inline media near the adaptive native pressure threshold", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      appMemoryPressureBytes: Math.floor(5 * 1024 * 1024 * 1024),
      memoryHighBytes: Math.floor(5.5 * 1024 * 1024 * 1024),
    });
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

  it("uses the legacy fixed threshold when native pressure limits are unavailable", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      appMemoryPressureBytes: Math.floor(2.5 * 1024 * 1024 * 1024),
    });
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

  it("suppresses feed avatar images when WebKit footprint is already high", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setMemoryPressure("normal", {
      webkitLargestFootprintBytes: Math.floor(2.4 * 1024 * 1024 * 1024),
    });
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
