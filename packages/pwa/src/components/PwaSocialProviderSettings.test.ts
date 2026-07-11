import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Account, FeedItem, Person } from "@freed/shared";
import type { PlatformConfig } from "@freed/ui/context";
import { PlatformProvider } from "@freed/ui/context";
import {
  PwaFacebookSettings,
  PwaFeedsSettings,
  PwaGoogleContactsSettings,
  PwaYouTubeSettings,
} from "./PwaSocialProviderSettings";
import { useAppStore } from "../lib/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  const now = 1_774_389_200_000;
  return {
    globalId: "facebook:item-1",
    platform: "facebook",
    sourceUrl: "https://facebook.example/item",
    author: {
      id: "facebook-author",
      displayName: "Facebook Author",
      handle: "facebook-author",
    },
    content: {
      text: "Post text",
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      highlights: [],
    },
    topics: [],
    contentType: "post",
    capturedAt: now,
    publishedAt: now - 60_000,
    ...overrides,
  } as FeedItem;
}

function createPlatform(): PlatformConfig {
  return {
    store: useAppStore,
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: PwaFacebookSettings,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    YouTubeSettingsContent: PwaYouTubeSettings,
    GoogleContactsSettingsContent: PwaGoogleContactsSettings,
    releaseChannel: "production",
  };
}

function renderWithPlatform(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PlatformProvider, { value: createPlatform(), children: node }));
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("PWA source provider settings", () => {
  afterEach(() => {
    useAppStore.setState({
      items: [],
      accounts: {},
      feeds: {},
      persons: {},
      pendingMatchCount: 0,
    });
    document.body.innerHTML = "";
  });

  it("shows social sync statistics without provider management controls", () => {
    useAppStore.setState({
      items: [
        makeItem(),
        makeItem({
          globalId: "facebook:item-2",
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            readAt: 1_774_389_199_000,
            tags: [],
            highlights: [],
          },
        }),
      ],
    });

    const { container, cleanup } = renderWithPlatform(
      createElement(PwaFacebookSettings, { surface: "settings" }),
    );

    expect(container.textContent).toContain("Facebook connections are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Unread");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect Facebook");
    const downloadLink = container.querySelector<HTMLAnchorElement>("a");
    expect(downloadLink?.className).toContain("inline-flex");
    expect(downloadLink?.querySelector("svg")).not.toBeNull();
    expect(downloadLink?.parentElement?.className).toContain("justify-center");
    expect(downloadLink?.parentElement?.className).toContain("pt-3");
    cleanup();
  });

  it("shows YouTube sync status without provider management controls", () => {
    useAppStore.setState({
      items: [
        makeItem({
          globalId: "youtube:item-1",
          platform: "youtube",
          contentType: "video",
          sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      ],
    });

    const { container, cleanup } = renderWithPlatform(
      createElement(PwaYouTubeSettings, { surface: "settings" }),
    );

    expect(container.textContent).toContain("YouTube connections are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect YouTube");
    expect(container.textContent).not.toContain("Freed Offline");
    cleanup();
  });

  it("shows Google Contacts sync status without connect or sync controls", () => {
    const person: Person = {
      id: "person-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: 1_774_389_100_000,
      updatedAt: 1_774_389_100_000,
    };
    const account: Account = {
      id: "contact:google:people/c123",
      personId: person.id,
      kind: "contact",
      provider: "google_contacts",
      externalId: "people/c123",
      displayName: "Ada Lovelace",
      importedAt: 1_774_389_200_000,
      firstSeenAt: 1_774_389_200_000,
      lastSeenAt: 1_774_389_200_000,
      discoveredFrom: "contact_import",
      createdAt: 1_774_389_200_000,
      updatedAt: 1_774_389_200_000,
    };
    useAppStore.setState({
      persons: { [person.id]: person },
      accounts: { [account.id]: account },
      pendingMatchCount: 2,
    });

    const { container, cleanup } = renderWithPlatform(createElement(PwaGoogleContactsSettings));

    expect(container.textContent).toContain("Google Contacts is managed in Freed Desktop");
    expect(container.textContent).toContain("Imported contacts");
    expect(container.textContent).toContain("Linked people");
    expect(container.textContent).toContain("Pending review");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect Google Contacts");
    expect(container.textContent).not.toContain("Sync Now");
    cleanup();
  });

  it("shows feed sync status without subscription management controls", () => {
    useAppStore.setState({
      feeds: {
        "https://example.com/feed.xml": {
          url: "https://example.com/feed.xml",
          title: "Example Feed",
          enabled: true,
          trackUnread: true,
          lastFetched: 1_774_389_150_000,
        },
      },
      items: [
        makeItem({
          globalId: "rss:item-1",
          platform: "rss",
          rssSource: {
            feedUrl: "https://example.com/feed.xml",
            feedTitle: "Example Feed",
            siteUrl: "https://example.com",
          },
        }),
        makeItem({
          globalId: "rss:item-2",
          platform: "rss",
          rssSource: {
            feedUrl: "https://example.com/feed.xml",
            feedTitle: "Example Feed",
            siteUrl: "https://example.com",
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            readAt: 1_774_389_199_000,
            tags: [],
            highlights: [],
          },
        }),
      ],
    });

    const { container, cleanup } = renderWithPlatform(createElement(PwaFeedsSettings));

    expect(container.textContent).toContain("Feed subscriptions are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced feeds");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("Unread");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Add Feed");
    expect(container.textContent).not.toContain("Subscribe");
    expect(container.textContent).not.toContain("Download OPML");
    expect(container.textContent).not.toContain("Remove");
    cleanup();
  });
});
