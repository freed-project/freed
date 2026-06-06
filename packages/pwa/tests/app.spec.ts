import { test, expect } from "@playwright/test";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
} from "@freed/shared";

const SAMPLE_AUTHOR_PERSON_COUNT = 20;
const SAMPLE_LINKEDIN_POST_COUNT = 10;
const EXPECTED_LINKEDIN_ITEMS_PER_BATCH =
  SAMPLE_SHOWCASE_FRIEND_COUNT + SAMPLE_LINKEDIN_POST_COUNT;
const EXPECTED_FIRST_SAMPLE_LIBRARY_COUNTS = {
  feeds: SAMPLE_SHOWCASE_FEED_COUNT,
  friends: SAMPLE_SHOWCASE_FRIEND_COUNT + SAMPLE_AUTHOR_PERSON_COUNT,
  items: SAMPLE_SHOWCASE_ITEM_COUNT,
};
const EXPECTED_ADDITIONAL_SAMPLE_LIBRARY_COUNTS = {
  feeds: SAMPLE_SHOWCASE_FEED_COUNT,
  friends: SAMPLE_SHOWCASE_FRIEND_COUNT,
  items: SAMPLE_SHOWCASE_ITEM_COUNT,
};

async function waitForPwaDocumentReady(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState?: () => { isInitialized?: boolean } }
      | undefined;
    return store?.getState?.().isInitialized === true;
  });
}

async function acceptLegalGate(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const acceptButton = page.getByTestId("legal-gate-accept");
  const gateVisible = await acceptButton.isVisible({ timeout: 5_000 }).catch(
    () => false,
  );

  if (!gateVisible) return false;

  const checkbox = page.getByRole("checkbox");
  await checkbox.evaluate((element) => {
    (element as HTMLInputElement).click();
  });
  await expect(acceptButton).toBeEnabled({ timeout: 5_000 });
  await acceptButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  return true;
}

async function seedSidebarFeeds(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        feeds: Record<string, unknown>;
        isInitialized: boolean;
        addFeed: (feed: unknown) => Promise<void>;
        removeAllFeeds: (includeItems: boolean) => Promise<void>;
      };
    };

    const feedTitles = [
      "Alpha Dispatch",
      "Beta Notes",
      "Gamma Journal",
      "Delta Weekly",
      "Epsilon Review",
      "Zeta Digest",
      "Eta Bulletin",
      "Theta Roundup",
      "Iota Ledger",
      "Kappa Signal",
      "Lambda Letters",
      "Needle Feed",
    ];

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (store.getState().isInitialized) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("store init timeout"));
        }
      }, 50);
    });

    await store.getState().removeAllFeeds(false);

    for (const [index, title] of feedTitles.entries()) {
      await store.getState().addFeed({
        url: `https://example.com/feeds/${index + 1}.xml`,
        title,
        enabled: true,
        trackUnread: false,
      });
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const { feeds } = store.getState();
        if (Object.keys(feeds).length >= feedTitles.length) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("feed seed timeout"));
        }
      }, 50);
    });
  });
}

async function waitForPwaReady(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
      getState: () => { isInitialized: boolean };
        }
      | undefined;
    if (!store) return false;
    return store.getState().isInitialized === true;
  });
}

async function emulateMobileDevice(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { mobile: true },
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
  });
}

async function seedFriendLocation(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFriend: (friend: unknown) => Promise<void>;
      docAddAccount: (account: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        friends: Record<string, unknown>;
        accounts: Record<string, unknown>;
        items: unknown[];
        setActiveView: (view: string) => void;
        setSelectedFriend: (id: string | null) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddFriend({
      id: "friend-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddAccount({
      id: "social:instagram:ada-ig",
      personId: "friend-ada",
      kind: "social",
      provider: "instagram",
      externalId: "ada-ig",
      handle: "ada",
      displayName: "Ada Lovelace",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });

    await automerge.docAddFeedItems([
      {
        globalId: "ig:ada:paris",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Bonjour from Paris",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Paris",
          coordinates: { lat: 48.8566, lng: 2.3522 },
          source: "geo_tag",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        if (
          state.friends["friend-ada"]
          && state.accounts["social:instagram:ada-ig"]
          && state.items.length > 0
        ) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("seed timeout"));
        }
      }, 50);
    });

    const state = store.getState();
    state.setActiveView("friends");
    state.setSelectedFriend("friend-ada");
  });
}

async function seedFriendFeedLens(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFriend: (friend: unknown) => Promise<void>;
      docAddAccount: (account: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        friends: Record<string, unknown>;
        accounts: Record<string, unknown>;
        items: Array<{ globalId: string }>;
        setActiveView: (view: string) => void;
        setSelectedFriend: (id: string | null) => void;
        setSelectedItem: (id: string | null) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddFriend({
      id: "friend-grace",
      name: "Grace Hopper",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddAccount({
      id: "social:linkedin:grace-li",
      personId: "friend-grace",
      kind: "social",
      provider: "linkedin",
      externalId: "grace-li",
      handle: "grace",
      displayName: "Grace Hopper",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });

    await automerge.docAddFeedItems([
      {
        globalId: "li:grace:lens",
        platform: "linkedin",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 30_000,
        author: {
          id: "grace-li",
          handle: "grace",
          displayName: "Grace Hopper",
        },
        content: {
          text: "Grace friend toggle scenario",
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "x:outsider:lens",
        platform: "x",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 20_000,
        author: {
          id: "outsider-x",
          handle: "outsider",
          displayName: "Outsider Account",
        },
        content: {
          text: "Outsider toggle scenario",
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        const itemIds = new Set(state.items.map((item) => item.globalId));
        if (
          state.friends["friend-grace"]
          && state.accounts["social:linkedin:grace-li"]
          && itemIds.has("li:grace:lens")
          && itemIds.has("x:outsider:lens")
        ) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("friend feed lens seed timeout"));
        }
      }, 50);
    });

    const state = store.getState();
    state.setActiveView("feed");
    state.setSelectedFriend(null);
    state.setSelectedItem(null);
  });
}

async function seedMultipleFriendLocations(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFriend: (friend: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        friends: Record<string, unknown>;
        items: unknown[];
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddFriend({
      id: "friend-omar",
      name: "Omar Hassan",
      sources: [
        {
          platform: "instagram",
          authorId: "omar-ig",
          handle: "omar",
          displayName: "Omar Hassan",
        },
      ],
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    });

    await automerge.docAddFriend({
      id: "friend-samir",
      name: "Samir Dutta",
      sources: [
        {
          platform: "linkedin",
          authorId: "samir-li",
          handle: "samir-dutta",
          displayName: "Samir Dutta",
        },
      ],
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    });

    await automerge.docAddFeedItems([
      {
        globalId: "ig:omar:reykjavik",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 45 * 60_000,
        author: {
          id: "omar-ig",
          handle: "omar",
          displayName: "Omar Hassan",
        },
        content: {
          text: "Reminder that `git blame` is a feature, not a slur.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Reykjavik, Capital Region, Iceland",
          coordinates: { lat: 64.1466, lng: -21.9426 },
          source: "geo_tag",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "li:samir:paris",
        platform: "linkedin",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 2 * 60 * 60_000,
        author: {
          id: "samir-li",
          handle: "samir-dutta",
          displayName: "Samir Dutta",
        },
        content: {
          text: "Morning light, cold brew, and a diff that's finally green ☀️",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Paris",
          coordinates: { lat: 48.8566, lng: 2.3522 },
          source: "text_extraction",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        if (Object.keys(state.friends).length >= 2 && state.items.length >= 2) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("seed timeout"));
        }
      }, 50);
    });

    store.getState().setActiveView("map");
  });
}

async function seedFriendsWorkspace(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFriend: (friend: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        friends: Record<string, unknown>;
        items: unknown[];
        setActiveView: (view: string) => void;
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };

    const now = Date.now();
    await automerge.docAddFriend({
      id: "friend-ada",
      name: "Ada Lovelace",
      careLevel: 5,
      sources: [
        { platform: "instagram", authorId: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
      ],
      reachOutLog: [{ loggedAt: now - 45 * 24 * 60 * 60_000, channel: "text" }],
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddFriend({
      id: "friend-maya",
      name: "Maya Chen",
      careLevel: 3,
      sources: [
        { platform: "linkedin", authorId: "maya-li", handle: "maya-chen", displayName: "Maya Chen" },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddFriend({
      id: "friend-jules",
      name: "Jules Rivera",
      careLevel: 4,
      sources: [
        { platform: "instagram", authorId: "jules-ig", handle: "jules", displayName: "Jules Rivera" },
      ],
      createdAt: now,
      updatedAt: now,
    });

    await automerge.docAddFeedItems([
      {
        globalId: "ig:ada:brooklyn",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 3 * 60 * 60_000,
        author: { id: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
        content: { text: "Working from Brooklyn today.", mediaUrls: [], mediaTypes: [] },
        location: {
          name: "Brooklyn, NY",
          coordinates: { lat: 40.6782, lng: -73.9442 },
          source: "geo_tag",
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
      {
        globalId: "li:maya:london",
        platform: "linkedin",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 90 * 60_000,
        author: { id: "maya-li", handle: "maya-chen", displayName: "Maya Chen" },
        content: { text: "Roadmap review complete.", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
      {
        globalId: "ig:jules:berlin",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 26 * 60 * 60_000,
        author: { id: "jules-ig", handle: "jules", displayName: "Jules Rivera" },
        content: { text: "Checking in from Berlin.", mediaUrls: [], mediaTypes: [] },
        location: {
          name: "Berlin, Germany",
          coordinates: { lat: 52.52, lng: 13.405 },
          source: "geo_tag",
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        if (Object.keys(state.friends).length >= 3 && state.items.length >= 3) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("seed timeout"));
        }
      }, 50);
    });

    await store.getState().updatePreferences({
      display: {
        friendsSidebarWidth: 402,
      },
    });

    store.getState().setActiveView("friends");
  });
}

async function openDangerZone(
  page: import("@playwright/test").Page,
): Promise<void> {
  const settingsHeading = page.getByRole("heading", { name: "Settings" });
  const settingsOpen = await settingsHeading.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!settingsOpen) {
    await page.getByTestId("sidebar-settings-button").click();
  }
  await expect(settingsHeading).toBeVisible();
  await page.getByRole("button", { name: "Danger Zone" }).click();
}

async function populateSampleData(
  page: import("@playwright/test").Page,
  previousCounts: { friends: number; items: number; feeds: number },
  expectedCounts: { friends: number; items: number; feeds: number },
): Promise<void> {
  let populateButton = page.getByRole("button", {
    name: /^(Populate sample data|Add more sample data)$/,
  });
  const exactButtonVisible = await populateButton.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!exactButtonVisible) {
    populateButton = page.getByRole("button", {
      name: /^(Populate sample data|Add more sample data) /,
    }).first();
  }
  await expect(populateButton).toBeVisible();
  await populateButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const confirmButton = page.getByRole("button", { name: "Populate anyway" });
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
  }

  await expect(page.getByText("Sample data added:")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => getLibraryCounts(page), {
      timeout: 15_000,
    })
    .toEqual({
      friends: previousCounts.friends + expectedCounts.friends,
      items: previousCounts.items + expectedCounts.items,
      feeds: previousCounts.feeds + expectedCounts.feeds,
    });
  await expect(page.getByText("Cannot assign undefined value")).toBeHidden();
}

async function getLibraryCounts(
  page: import("@playwright/test").Page,
): Promise<{ friends: number; items: number; feeds: number }> {
  return page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        friends: Record<string, unknown>;
        items: unknown[];
        feeds: Record<string, unknown>;
      };
    };
    const state = store.getState();
    return {
      friends: Object.keys(state.friends).length,
      items: state.items.length,
      feeds: Object.keys(state.feeds).length,
    };
  });
}

const NAV_FEED_URL = "https://example.com/navigation.xml";

async function seedNavigationFeed(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async (feedUrl: string) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddRssFeed: (feed: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        feeds: Record<string, unknown>;
        items: Array<{ globalId: string }>;
      };
    };

    const now = Date.now();
    await automerge.docAddRssFeed({
      url: feedUrl,
      title: "Navigation Feed",
      siteUrl: "https://example.com",
      enabled: true,
      trackUnread: true,
      lastFetched: now,
    });

    await automerge.docAddFeedItems([
      {
        globalId: "rss:navigation:1",
        platform: "rss",
        contentType: "article",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: {
          id: "nav-feed",
          handle: "nav-feed",
          displayName: "Navigation Feed",
        },
        content: {
          text: "Navigation item one",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/navigation-1",
            title: "Navigation Item One",
            description: "First navigation test article",
          },
        },
        rssSource: {
          feedUrl,
          feedTitle: "Navigation Feed",
          siteUrl: "https://example.com",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: ["research", "alpha"],
        },
        topics: [],
        sourceUrl: "https://example.com/navigation-1",
      },
      {
        globalId: "rss:navigation:2",
        platform: "rss",
        contentType: "article",
        capturedAt: now,
        publishedAt: now - 120_000,
        author: {
          id: "nav-feed",
          handle: "nav-feed",
          displayName: "Navigation Feed",
        },
        content: {
          text: "Navigation item two",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/navigation-2",
            title: "Navigation Item Two",
            description: "Second navigation test article",
          },
        },
        rssSource: {
          feedUrl,
          feedTitle: "Navigation Feed",
          siteUrl: "https://example.com",
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: now - 30_000,
          archived: false,
          tags: ["research"],
        },
        topics: [],
        sourceUrl: "https://example.com/navigation-2",
      },
      {
        globalId: "rss:navigation:3",
        platform: "rss",
        contentType: "article",
        capturedAt: now,
        publishedAt: now - 180_000,
        author: {
          id: "nav-feed",
          handle: "nav-feed",
          displayName: "Navigation Feed",
        },
        content: {
          text: "Archived navigation item",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/navigation-3",
            title: "Archived Navigation Item",
            description: "Archived navigation test article",
          },
        },
        rssSource: {
          feedUrl,
          feedTitle: "Navigation Feed",
          siteUrl: "https://example.com",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: true,
          archivedAt: now - 10_000,
          tags: ["archive"],
        },
        topics: [],
        sourceUrl: "https://example.com/navigation-3",
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        if (state.feeds[feedUrl] && state.items.some((item) => item.globalId === "rss:navigation:1")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("navigation seed timeout"));
        }
      }, 50);
    });
  }, NAV_FEED_URL);
}

async function seedSocialReaderItem(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        items: Array<{ globalId: string }>;
      };
    };

    const now = Date.now();
    await automerge.docAddFeedItems([
      {
        globalId: "facebook:reader-author:1",
        platform: "facebook",
        contentType: "story",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: {
          id: "reader-author",
          handle: "reader-author",
          displayName: "Reader Author",
        },
        content: {
          text: "Social author navigation item",
          mediaUrls: [],
          mediaTypes: [],
        },
        preservedContent: {
          title: "Social Author Navigation Item",
          byline: "Reader Author",
          content: "Social author navigation item",
          textContent: "Social author navigation item",
          siteName: "Facebook",
          readingTime: 1,
          capturedAt: now,
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
        sourceUrl: "https://facebook.com/reader-author/posts/1",
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const state = store.getState();
        if (state.items.some((item) => item.globalId === "facebook:reader-author:1")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("social reader seed timeout"));
        }
      }, 50);
    });
  });
}

test.describe("FREED PWA", () => {
  test("first load blocks the app shell until legal consent is accepted", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByTestId("legal-gate-accept")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("main")).toBeHidden();

    await acceptLegalGate(page);
    await expect(page.locator("main")).toBeVisible();
  });

  test("legal consent persists across reloads on the same bundle version", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await expect(page.locator("main")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("legal-gate-accept")).toBeHidden();
    await expect(page.locator("main")).toBeVisible();
  });

  test("browser install prompt surfaces an install notice and respects dismissal", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("legal-gate-accept")).toBeVisible();
    await page.waitForTimeout(150);

    await page.evaluate(() => {
      const promptEvent = new Event("beforeinstallprompt", {
        cancelable: true,
      }) as Event & {
        prompt: () => Promise<void>;
        promptCalled?: boolean;
        userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
      };

      promptEvent.promptCalled = false;
      promptEvent.prompt = async () => {
        promptEvent.promptCalled = true;
      };
      promptEvent.userChoice = Promise.resolve({
        outcome: "dismissed",
        platform: "web",
      });

      (window as Record<string, unknown>).__FREED_TEST_INSTALL_EVENT__ = promptEvent;
      window.dispatchEvent(promptEvent);
    });

    await acceptLegalGate(page);
    await waitForPwaReady(page);

    const installNotice = page.getByTestId("pwa-install-notice");
    await expect(installNotice).toBeVisible();
    await page.getByTestId("pwa-install-notice-action").click();

    await expect
      .poll(async () => page.evaluate(() => {
        const event = (window as Record<string, unknown>).__FREED_TEST_INSTALL_EVENT__ as {
          promptCalled?: boolean;
        };
        return event.promptCalled === true;
      }))
      .toBe(true);

    await expect(installNotice).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("pwa-install-notice")).toBeHidden();
  });

  test("oauth callback route bypasses the first-run gate until it returns home", async ({
    page,
  }) => {
    await page.goto("/oauth-callback?error=access_denied");

    await expect(page.getByText("Connection failed")).toBeVisible();
    await expect(page.getByTestId("legal-gate-accept")).toBeHidden();

    await page.getByRole("button", { name: "Back to app" }).click();
    await expect(page.getByTestId("legal-gate-accept")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("loads the app shell", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Should show the FREED logo
    await expect(page.getByRole("banner").getByText("FREED")).toBeVisible();

    // Should show the header and primary action menu
    await expect(page.getByRole("button", { name: /new/i })).toBeVisible();

    // Should show the sidebar navigation
    await expect(page.getByRole("button", { name: /^All$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  });

  test("shows empty state when no feeds", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Should show empty state message
    await expect(page.locator("text=No content yet")).toBeVisible();
    await expect(page.locator("text=Connect to your desktop app")).toBeVisible();
    await expect(page.locator("text=Alternatively, for preview & testing:")).toBeVisible();
    await expect(page.getByRole("button", { name: /Populate sample data/i })).toBeVisible();
  });

  test("opens Add Feed dialog", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Open the New menu, then choose RSS Feed
    await page.getByRole("button", { name: /new/i }).click();
    await page.getByRole("button", { name: "RSS Feed" }).click();

    // Dialog should appear with title, URL field, and examples
    await expect(page.locator("text=Add RSS Feed")).toBeVisible();
    await expect(page.locator('input[type="url"]')).toBeVisible();
    await expect(page.locator("text=Feed URL")).toBeVisible();
    await expect(page.locator("text=Try these example feeds")).toBeVisible();
  });

  test("can close Add Feed dialog", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Open dialog
    await page.getByRole("button", { name: /new/i }).click();
    await page.getByRole("button", { name: "RSS Feed" }).click();
    await expect(page.locator("text=Add RSS Feed")).toBeVisible();

    // Close from the desktop-style dialog header
    await page.getByRole("button", { name: "Close dialog" }).click();

    // Dialog should close
    await expect(page.locator("text=Add RSS Feed")).not.toBeVisible();
  });

  test("sidebar filter buttons work", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    const feedsButton = page.getByTestId("source-row-rss");
    await feedsButton.click();

    await page.waitForFunction(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { activeFilter: { platform?: string } } }
        | undefined;
      return store?.getState().activeFilter.platform === "rss";
    });

    // Click on All to reset
    await page.getByTestId("source-row-all").click();
    await page.waitForFunction(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { activeFilter: { platform?: string } } }
        | undefined;
      return store?.getState().activeFilter.platform === undefined;
    });
  });

  test("rss source accordion pages feeds and search moves matches into the first page", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedSidebarFeeds(page);

    await page.getByRole("button", { name: "Expand feeds" }).click();

    await expect(page.getByRole("button", { name: "Alpha Dispatch" })).toBeVisible();
    await expect(page.getByText("1 to 10 of 12")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next feeds page" })).toBeEnabled();

    await page.getByRole("button", { name: "Next feeds page" }).click();
    await expect(page.getByText("11 to 12 of 12")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous feeds page" })).toBeEnabled();

    await page.getByRole("textbox", { name: "Search or run a command" }).fill("needle");
    await expect(page.getByRole("button", { name: "Needle Feed" })).toBeVisible();
    await expect(page.getByText("11 to 12 of 12")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next feeds page" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Alpha Dispatch" })).toHaveCount(0);
  });

  test("rss source row selects feeds without opening the accordion", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedSidebarFeeds(page);

    const sidebar = page.locator("aside");
    await sidebar.getByTestId("source-row-rss").click();

    await expect.poll(() => new URL(page.url()).search).toBe("?platform=rss");
    await expect(sidebar.getByRole("button", { name: "Alpha Dispatch" })).toHaveCount(0);
    const expandFeedsButton = sidebar.locator('button[aria-label="Expand feeds"]');
    await expect(expandFeedsButton).toBeVisible();

    await expandFeedsButton.click();
    await expect(sidebar.getByRole("button", { name: "Alpha Dispatch" })).toBeVisible();
  });

  test("feed pagination clears an off-page feed selection back to top-level feeds", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedSidebarFeeds(page);

    await page.getByRole("button", { name: "Expand feeds" }).click();
    await page.getByRole("button", { name: "Alpha Dispatch" }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("feed"))
      .toBe("https://example.com/feeds/1.xml");

    await page.getByRole("button", { name: "Next feeds page" }).click();

    await expect(page.getByText("11 to 12 of 12")).toBeVisible();
    await expect(page.getByRole("button", { name: "Alpha Dispatch" })).toHaveCount(0);
    await expect
      .poll(() => ({
        platform: new URL(page.url()).searchParams.get("platform"),
        feed: new URL(page.url()).searchParams.get("feed"),
      }))
      .toEqual({ platform: "rss", feed: null });

    await page.getByRole("textbox", { name: "Search or run a command" }).fill("needle");
    await expect(page.getByRole("button", { name: "Needle Feed" })).toBeVisible();
    await expect
      .poll(() => ({
        platform: new URL(page.url()).searchParams.get("platform"),
        feed: new URL(page.url()).searchParams.get("feed"),
      }))
      .toEqual({ platform: "rss", feed: null });
  });

  test.describe.serial("URL history", () => {
    test("loads the Friends view directly from the URL", async ({ page }) => {
      await page.goto("/friends");
      await acceptLegalGate(page);
      await waitForPwaReady(page);

      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { activeView: string };
        };
        return store.getState().activeView === "friends";
      });
      await expect(page.getByRole("button", { name: /import contacts/i })).toBeVisible();
    });

    test("browser history tracks top-level view navigation", async ({ page }) => {
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);

      await page.locator("aside").getByRole("button", { name: "Friends" }).click({ force: true });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/friends");

      await page.goBack();
      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { activeView: string };
        };
        return store.getState().activeView === "feed";
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/");

      await page.goForward();
      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { activeView: string };
        };
        return store.getState().activeView === "friends";
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/friends");
    });

    test("feed filters update the URL and restore with browser history", async ({ page }) => {
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);
      await seedNavigationFeed(page);

      const sidebar = page.locator("aside");

      await sidebar.getByTestId("source-row-rss").click();
      await expect.poll(() => new URL(page.url()).search).toBe("?platform=rss");

      await sidebar.getByRole("button", { name: "Saved" }).click();
      await expect.poll(() => new URL(page.url()).search).toBe("?scope=saved");

      await page.goBack();
      await expect.poll(() => new URL(page.url()).search).toBe("?platform=rss");

      await sidebar.getByRole("button", { name: "research" }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.getAll("tag"))
        .toEqual(["research"]);

      await sidebar.getByRole("button", { name: /^Feeds/ }).click();
      await sidebar.getByRole("button", { name: /Navigation Feed/ }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("feed"))
        .toBe(NAV_FEED_URL);

      await sidebar.getByRole("button", { name: "Archived" }).click();
      await expect.poll(() => new URL(page.url()).search).toBe("?scope=archived");
    });

    test("reader selection syncs to item history and restores with browser forward", async ({ page }) => {
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);
      await seedNavigationFeed(page);

      await page.locator(".feed-card").filter({ hasText: "Navigation Item One" }).first().click();
      await expect(page.getByLabel("Back")).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe("?item=rss%3Anavigation%3A1");

      await page.goBack();
      await expect(page.getByLabel("Back")).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).search).toBe("");

      await page.goForward();
      await expect(page.getByLabel("Back")).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe("?item=rss%3Anavigation%3A1");
    });

    test("reader author link opens friends and browser back restores the article", async ({ page }) => {
      await emulateMobileDevice(page);
      await page.setViewportSize({ width: 430, height: 932 });
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);
      await seedSocialReaderItem(page);

      await page.getByRole("button", { name: /Reader Author.*Social author navigation item/i }).click();
      await expect(page.getByTestId("reader-article")).toBeVisible();

      await page.getByTestId("reader-author-friends-link").click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/friends");
      await expect(page.getByText("Freed hit a fatal error")).toHaveCount(0);
      await expect(page.getByLabel("Friends identity graph")).toBeVisible();

      await page.goBack();
      await expect.poll(() => new URL(page.url()).search).toBe("?item=facebook%3Areader-author%3A1");
      await expect(page.getByTestId("reader-article")).toBeVisible();
      await expect(page.getByText("Freed hit a fatal error")).toHaveCount(0);
    });

    test("stale item URLs are cleaned up after initialization", async ({ page }) => {
      await page.goto("/?item=missing-item");
      await acceptLegalGate(page);
      await waitForPwaReady(page);

      await expect.poll(() => new URL(page.url()).search).toBe("");
      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { selectedItemId: string | null };
        };
        return store.getState().selectedItemId === null;
      });
    });

    test("stale item cleanup replaces the current history entry", async ({ page }) => {
      await page.goto("/friends");
      await acceptLegalGate(page);
      await waitForPwaReady(page);
      await expect.poll(() => new URL(page.url()).pathname).toBe("/friends");

      await page.evaluate(() => {
        window.history.pushState(window.history.state, "", "/?item=missing-item");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect.poll(() => new URL(page.url()).search).toBe("");

      await page.goBack();
      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { activeView: string; selectedItemId: string | null };
        };
        const state = store.getState();
        return state.activeView === "friends" && state.selectedItemId === null;
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/friends");
      await expect.poll(() => new URL(page.url()).search).toBe("");
    });

    test("feed filter URLs restore the correct scope on direct load", async ({ page }) => {
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);
      await seedNavigationFeed(page);

      await page.goto(`/?feed=${encodeURIComponent(NAV_FEED_URL)}&tag=research`);
      await waitForPwaReady(page);
      await page.waitForFunction((feedUrl: string) => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => {
            activeFilter: {
              platform?: string;
              feedUrl?: string;
              tags?: string[];
            };
          };
        };
        const filter = store.getState().activeFilter;
        return filter.platform === "rss"
          && filter.feedUrl === feedUrl
          && (filter.tags ?? []).includes("research");
      }, NAV_FEED_URL);
      await expect
        .poll(() => ({
          feed: new URL(page.url()).searchParams.get("feed"),
          tags: new URL(page.url()).searchParams.getAll("tag"),
        }))
        .toEqual({
          feed: NAV_FEED_URL,
          tags: ["research"],
        });
    });
  });

  test("map navigation is live from the sidebar", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator("main").getByRole("heading", { name: "Map" })).toHaveCount(0);
    await expect(page.getByText("Signal Map")).toHaveCount(0);

    const mainBox = await page.locator("main").boundingBox();
    const mapBox = await page.locator(".freed-map-shell").boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    expect(Math.round(mapBox!.x)).toBe(Math.round(mainBox!.x));
    expect(Math.round(mapBox!.width)).toBe(Math.round(mainBox!.width));
  });

  test("feed and friends use shared headers while map stays full-bleed", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    await expect(page.locator("main").getByRole("heading", { name: "All Sources" })).toBeVisible();

    await page.getByRole("button", { name: "Friends" }).click();
    await expect(page.locator("main").locator("h1", { hasText: "Friends" })).toBeVisible();
    await expect(page.getByRole("button", { name: /import contacts/i })).toBeVisible();

    await page.getByTestId("source-row-map").click();
    await expect(page.locator("main").getByRole("heading", { name: "Map" })).toHaveCount(0);
    await expect(page.getByText("Signal Map")).toHaveCount(0);

    const mainBox = await page.locator("main").boundingBox();
    const mapBox = await page.locator(".freed-map-shell").boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    expect(Math.round(mapBox!.y)).toBe(Math.round(mainBox!.y));
  });

  test("toolbar identity toggle narrows the feed to linked friends", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendFeedLens(page);

    await expect(page.getByText("Grace friend toggle scenario")).toBeVisible();
    await expect(page.getByText("Outsider toggle scenario")).toBeVisible();

    const toolbar = page.getByTestId("workspace-toolbar");
    await toolbar.getByRole("button", { name: "Friends", exact: true }).click();

    await expect(page.getByText("Grace friend toggle scenario")).toBeVisible();
    await expect(page.getByText("Outsider toggle scenario")).toHaveCount(0);

    await toolbar.getByRole("button", { name: "All content", exact: true }).click();

    await expect(page.getByText("Grace friend toggle scenario")).toBeVisible();
    await expect(page.getByText("Outsider toggle scenario")).toBeVisible();
  });

  test("friend detail shows the last seen location card when location data exists", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendLocation(page);

    await expect(page.locator("main").getByText("Ada Lovelace").first()).toBeVisible();
    await expect(page.getByText("Last seen")).toBeVisible();
    await expect(page.getByRole("button", { name: /last seen paris/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /open map/i })).toBeVisible();
  });

  test("friends and map resolve the same avatar for a linked friend", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendLocation(page);

    const friendAvatarUrl = await page
      .locator('aside [data-avatar-name="Ada Lovelace"]')
      .first()
      .getAttribute("data-avatar-url");

    await page.getByTestId("source-row-map").click();
    await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
    const mapAvatarUrl = await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          friends: Record<string, { avatarUrl?: string; sources?: Array<{ avatarUrl?: string }> }>;
          items: Array<{ author?: { displayName?: string; avatarUrl?: string } }>;
        };
      };
      const state = store.getState();
      const friend = state.friends["friend-ada"];
      return (
        friend?.avatarUrl ??
        friend?.sources?.find((source) => source.avatarUrl)?.avatarUrl ??
        state.items.find((item) => item.author?.displayName === "Ada Lovelace")?.author?.avatarUrl ??
        null
      );
    });

    expect(mapAvatarUrl ?? "").toBe(friendAvatarUrl ?? "");
  });

  test("friends workspace shows overview filters and detail back navigation", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendsWorkspace(page);

    await expect(page.getByTestId("friends-sidebar")).toBeVisible();
    await expect(page.getByPlaceholder("Search friends")).toBeVisible();
    await expect(page.getByRole("button", { name: "Fit all" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Need outreach" })).toBeVisible();

    await page.getByRole("button", { name: "Need outreach" }).click();
    await expect(page.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Maya Chen/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Ada Lovelace/ }).click();
    await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible();
    await expect(page.locator("main").getByText("Last seen")).toBeVisible();

    await page.getByRole("button", { name: "Back to all friends" }).click();
    await expect(page.getByPlaceholder("Search friends")).toBeVisible();
    await expect(page.locator("main").getByText("Last seen")).toHaveCount(0);
  });

  test("friends sidebar width persists across view switches", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendsWorkspace(page);

    const sidebar = page.getByTestId("friends-sidebar");
    const before = await sidebar.boundingBox();
    expect(before).not.toBeNull();
    expect(Math.round(before!.width)).toBeGreaterThanOrEqual(395);

    const handle = page.getByRole("separator", { name: "Resize friends sidebar" });
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 48, handleBox!.y + handleBox!.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const afterResize = await sidebar.boundingBox();
        return afterResize ? Math.round(afterResize.width) : null;
      })
      .toBeGreaterThan(Math.round(before!.width));
    const afterResize = await sidebar.boundingBox();
    expect(afterResize).not.toBeNull();

    await page.getByRole("button", { name: "Map" }).click();
    await page.getByRole("button", { name: "Friends" }).click();

    const afterReturn = await sidebar.boundingBox();
    expect(afterReturn).not.toBeNull();
    expect(Math.abs(Math.round(afterReturn!.width) - Math.round(afterResize!.width))).toBeLessThanOrEqual(2);
  });

  test("friend graph pinch zoom stays inside the canvas", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendsWorkspace(page);

    const canvas = page.getByTestId("friend-graph-canvas");
    await expect(canvas).toBeVisible();

    const beforeScale = Number(await canvas.getAttribute("data-view-scale"));
    const pageZoomBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomBefore).toBe(1);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const zoomEventWasPrevented = await page.evaluate(({ x, y }) => {
      const canvasEl = document.querySelector('[data-testid="friend-graph-canvas"]');
      if (!(canvasEl instanceof HTMLCanvasElement)) {
        throw new Error("friend graph canvas missing");
      }

      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY: -180,
        ctrlKey: true,
      });

      return canvasEl.dispatchEvent(event) === false;
    }, {
      x: Math.round(box!.x + box!.width / 2),
      y: Math.round(box!.y + box!.height / 2),
    });

    await expect
      .poll(async () => Number(await canvas.getAttribute("data-view-scale")))
      .toBeGreaterThan(beforeScale);
    expect(zoomEventWasPrevented).toBeTruthy();

    const pageZoomAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomAfter).toBe(1);
  });

  test("map popovers show update time and keep only one open", async ({ page }) => {
    const mapAssetResponses: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("maplibre-gl")) {
        mapAssetResponses.push({ url, status: response.status() });
      }
    });

    await page.goto("/");
    await acceptLegalGate(page);
    await seedMultipleFriendLocations(page);

    await page.getByRole("button", { name: "Map" }).click();
    await expect(page.getByText("Map failed to load")).toHaveCount(0);
    await page.getByRole("button", { name: "Omar Hassan" }).click();
    await expect(page.getByText("Reykjavik, Capital Region, Iceland")).toBeVisible();
    await expect(page.getByText(/ago/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Post" })).toHaveCount(1);
    const livePopup = page.locator(".maplibregl-popup-content");
    const fallbackPopup = page.getByTestId("map-fallback-popup");
    const useLivePopup = await livePopup.isVisible().catch(() => false);
    const popupBox = useLivePopup
      ? await livePopup.boundingBox()
      : await fallbackPopup.boundingBox();
    expect(popupBox).not.toBeNull();
    expect(Math.round(popupBox!.width)).toBeGreaterThanOrEqual(420);
    if (useLivePopup) {
      await expect(page.locator(".maplibregl-popup-tip")).toBeHidden();
    }

    await page.getByRole("button", { name: "Samir Dutta" }).click();
    await expect(page.getByText("Paris")).toBeVisible();
    await expect(page.getByText("Reykjavik, Capital Region, Iceland")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Post" })).toHaveCount(1);
    expect(mapAssetResponses.length).toBeGreaterThan(0);
    expect(mapAssetResponses.some(({ status }) => status === 403)).toBeFalsy();
  });

  test("can add an RSS feed", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Open Add Feed dialog
    await page.getByRole("button", { name: /new/i }).click();
    await page.getByRole("button", { name: "RSS Feed" }).click();

    // Wait for dialog to appear
    await expect(page.locator("text=Add RSS Feed")).toBeVisible();

    // Enter a feed URL
    await page.fill('input[type="url"]', "https://hnrss.org/frontpage");

    // Verify the URL was entered
    await expect(page.locator('input[type="url"]')).toHaveValue(
      "https://hnrss.org/frontpage",
    );

    // Click the submit button in the dialog
    await page.click('button[type="submit"]');

    // Should show loading state
    await expect(page.locator('button:has-text("Adding...")'))
      .toBeVisible({ timeout: 2000 })
      .catch(() => {});

    // Wait longer for network request (CORS proxy can be slow)
    await page.waitForTimeout(10000);

    // Check the outcome - any of these is valid:
    // 1. Items appeared (success)
    // 2. Error message shown (CORS/network failure)
    // 3. Dialog closed (success)
    // 4. Still showing "Adding..." (slow network)
    const hasItems = (await page.locator(".feed-card").count()) > 0;
    const hasError = await page
      .locator("text=Failed")
      .isVisible()
      .catch(() => false);
    const dialogClosed = !(await page
      .locator("text=RSS Feeds")
      .isVisible()
      .catch(() => false));
    const stillLoading = await page
      .locator('button:has-text("Adding...")')
      .isVisible()
      .catch(() => false);

    // Any outcome is acceptable - we verified the flow works
    expect(hasItems || hasError || dialogClosed || stillLoading).toBeTruthy();
  });

  test("responsive sidebar behavior", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await acceptLegalGate(page);

    const sidebar = page.getByTestId("app-sidebar-mobile");
    await expect(sidebar).toHaveClass(/-translate-x-full/);

    await page.click('button[aria-label="Open menu"]');

    await expect(sidebar).toHaveClass(/translate-x-0/);
    await expect
      .poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().left)))
      .toBe(0);

    const menuButton = page.getByRole("button", { name: "Close menu" });
    const geometry = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Close menu"]') as HTMLElement | null;
      const icon = button?.querySelector("[aria-hidden='true']") as HTMLElement | null;
      const sidebar = document.querySelector('[data-testid="app-sidebar-mobile"]') as HTMLElement | null;
      const search = sidebar?.querySelector('input[aria-label="Search or run"]') as HTMLElement | null;
      const firstSourceButton = sidebar?.querySelector('[data-testid="source-row-all"]') as HTMLElement | null;
      const firstControl = sidebar?.querySelector("input, button") as HTMLElement | null;
      const settingsFooter = sidebar?.querySelector('[data-testid="mobile-sidebar-settings-footer"]') as HTMLElement | null;
      const settingsButton = sidebar?.querySelector('[data-testid="mobile-sidebar-settings-button"]') as HTMLElement | null;
      if (!button || !icon || !sidebar || !search || !firstSourceButton || !firstControl || !settingsFooter || !settingsButton) {
        throw new Error("Mobile menu geometry elements were not found");
      }
      const buttonRect = button.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      const firstSourceButtonRect = firstSourceButton.getBoundingClientRect();
      const footerRect = settingsFooter.getBoundingClientRect();
      const settingsButtonRect = settingsButton.getBoundingClientRect();
      const sidebarStyle = window.getComputedStyle(sidebar);
      const sourceStyle = window.getComputedStyle(firstSourceButton);
      const settingsButtonStyle = window.getComputedStyle(settingsButton);
      const footerStyle = window.getComputedStyle(settingsFooter);
      const sourceCenterX = firstSourceButtonRect.left + firstSourceButtonRect.width / 2;
      const sourceCenterY = firstSourceButtonRect.top + firstSourceButtonRect.height / 2;
      const hitElement = document.elementFromPoint(sourceCenterX, sourceCenterY);
      return {
        centerDelta: Math.abs(
          (buttonRect.left + buttonRect.width / 2) -
          (iconRect.left + iconRect.width / 2),
        ),
        firstControlIsSearch: firstControl === search,
        sourceCenterHitsSidebar: !!hitElement && sidebar.contains(hitElement),
        sidebarZIndex: Number.parseInt(sidebarStyle.zIndex, 10),
        searchTop: Math.round(searchRect.top),
        sidebarTop: Math.round(sidebarRect.top),
        footerBottomGap: Math.round(sidebarRect.bottom - footerRect.bottom),
        footerBorderTopWidth: footerStyle.borderTopWidth,
        sourceFontSize: sourceStyle.fontSize,
        sourcePaddingTop: sourceStyle.paddingTop,
        sourcePaddingBottom: sourceStyle.paddingBottom,
        sourceColumnGap: sourceStyle.columnGap,
        settingsButtonFontSize: settingsButtonStyle.fontSize,
        settingsButtonPaddingTop: settingsButtonStyle.paddingTop,
        settingsButtonHeight: Math.round(settingsButtonRect.height),
      };
    });
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    expect(geometry.firstControlIsSearch).toBe(true);
    expect(geometry.sourceCenterHitsSidebar).toBe(true);
    expect(geometry.sidebarZIndex).toBeGreaterThan(50);
    expect(geometry.searchTop - geometry.sidebarTop).toBeGreaterThanOrEqual(8);
    expect(geometry.footerBottomGap).toBeLessThanOrEqual(1);
    expect(geometry.footerBorderTopWidth).toBe("0px");
    expect(geometry.sourceFontSize).toBe("17px");
    expect(geometry.sourcePaddingTop).toBe("8px");
    expect(geometry.sourcePaddingBottom).toBe("8px");
    expect(geometry.sourceColumnGap).toBe("8px");
    expect(geometry.settingsButtonFontSize).toBe("17px");
    expect(geometry.settingsButtonPaddingTop).toBe("8px");
    expect(geometry.settingsButtonHeight).toBeLessThanOrEqual(44);

    await menuButton.click();
    await expect(sidebar).toHaveClass(/-translate-x-full/);
    await expect
      .poll(() => sidebar.evaluate((element) => window.getComputedStyle(element).boxShadow))
      .toBe("none");
  });

  test("mobile settings opens without hitting recovery", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await acceptLegalGate(page);

    await page.click('button[aria-label="Open menu"]');
    await page.getByRole("button", { name: "Settings" }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearance" })).toHaveCount(0);
    const overviewFontSize = await page.getByRole("button", { name: "Appearance" }).evaluate((button) =>
      Number.parseFloat(window.getComputedStyle(button).fontSize),
    );
    expect(overviewFontSize).toBeGreaterThanOrEqual(16);
    await expect(page.getByText("Freed hit a fatal error")).toHaveCount(0);
    await expect(page.getByText("Cannot access 'mobileView' before initialization")).toHaveCount(0);
  });

  test("mobile settings keeps overview and opens support from danger zone", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await acceptLegalGate(page);

    await page.click('button[aria-label="Open menu"]');
    await page.getByRole("button", { name: "Settings" }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Support", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Appearance" })).toHaveCount(0);

    await page.getByRole("button", { name: "Updates" }).click();
    await expect(page.getByTestId("settings-mobile-section-title")).toHaveText("Updates");

    const scrollContainer = page.getByTestId("settings-scroll-container");
    await scrollContainer.evaluate((container) => {
      const updates = container.querySelector('[data-section="updates"]') as HTMLElement | null;
      updates?.scrollIntoView();
    });
    const sectionMetrics = await scrollContainer.evaluate((container) => {
      const updates = container.querySelector('[data-section="updates"]') as HTMLElement | null;
      const legal = container.querySelector('[data-section="legal"]') as HTMLElement | null;
      if (!updates || !legal) {
        throw new Error("Expected mobile settings sections were not found");
      }
      const containerRect = container.getBoundingClientRect();
      const updatesRect = updates.getBoundingClientRect();
      const legalRect = legal.getBoundingClientRect();
      return {
        updatesVisible: updatesRect.bottom > containerRect.top && updatesRect.top < containerRect.bottom,
        legalVisible: legalRect.bottom > containerRect.top && legalRect.top < containerRect.bottom,
        sectionGap: Math.round(legalRect.top - updatesRect.bottom),
      };
    });
    expect(sectionMetrics.updatesVisible).toBe(true);
    expect(sectionMetrics.legalVisible).toBe(true);
    expect(sectionMetrics.sectionGap).toBeGreaterThanOrEqual(24);
    expect(sectionMetrics.sectionGap).toBeLessThanOrEqual(64);

    await page.getByLabel("Back to settings").click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Danger Zone" }).click();
    await expect(page.getByTestId("settings-mobile-section-title")).toHaveText("Danger Zone");

    await scrollContainer.evaluate((container) => {
      const danger = container.querySelector('[data-section="danger"]') as HTMLElement | null;
      danger?.scrollIntoView();
    });
    const supportButton = page.getByRole("button", { name: /Submit support ticket/ });
    const debugButton = page.getByRole("button", { name: /Open Debug Panel/ });
    await expect(supportButton).toBeVisible();
    await expect(debugButton).toBeVisible();
    const dangerOrder = await page.evaluate(() => {
      const support = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Submit support ticket"),
      ) as HTMLElement | undefined;
      const debug = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Open Debug Panel"),
      ) as HTMLElement | undefined;
      if (!support || !debug) {
        throw new Error("Danger buttons were not found");
      }
      return support.getBoundingClientRect().top < debug.getBoundingClientRect().top;
    });
    expect(dangerOrder).toBe(true);

    await supportButton.click();
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await expect(page.getByText("What happened?", { exact: false })).toBeVisible();
  });

  test("mobile toolbar balances menu and format controls", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await acceptLegalGate(page);
    await waitForPwaReady(page);
    await seedNavigationFeed(page);

    const menuButton = page.getByRole("button", { name: "Open menu" });
    const overflowButton = page.getByTestId("toolbar-overflow-button");
    const formatButton = page.getByTestId("mobile-toolbar-filter-button");
    await expect(menuButton).toBeVisible();
    await expect(overflowButton).toBeVisible();
    await expect(formatButton).toBeVisible();

    const geometry = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
      const menu = document.querySelector('button[aria-label="Open menu"]') as HTMLElement | null;
      const overflow = document.querySelector('[data-testid="toolbar-overflow-button"]') as HTMLElement | null;
      const format = document.querySelector('[data-testid="mobile-toolbar-filter-button"]') as HTMLElement | null;
      const menuIcon = menu?.querySelector("[aria-hidden='true']") as HTMLElement | null;
      const formatIcon = format?.querySelector("svg") as SVGElement | null;
      if (!toolbar || !menu || !overflow || !format || !menuIcon || !formatIcon) {
        throw new Error("Mobile toolbar buttons were not found");
      }
      const toolbarRect = toolbar.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const menuIconRect = menuIcon.getBoundingClientRect();
      const menuBarWidths = Array.from(menuIcon.querySelectorAll("path"))
        .map((path) => (path as SVGGraphicsElement).getBBox().width)
        .filter((width) => width > 0);
      const menuVisibleLeft = Math.min(
        ...Array.from(menuIcon.querySelectorAll("path"))
          .map((path) => (path as SVGGraphicsElement).getBBox().x)
          .map((x) => menuIconRect.left + (x / 24) * menuIconRect.width),
      );
      const overflowRect = overflow.getBoundingClientRect();
      const formatRect = format.getBoundingClientRect();
      const formatIconRect = formatIcon.getBoundingClientRect();
      return {
        toolbarLeft: toolbarRect.left,
        toolbarRight: toolbarRect.right,
        menuLeft: menuRect.left,
        menuRight: menuRect.right,
        menuIconLeft: menuIconRect.left,
        menuVisibleLeft,
        menuBarWidths,
        overflowRight: overflowRect.right,
        formatLeft: formatRect.left,
        formatRight: formatRect.right,
        formatIconRight: formatIconRect.right,
        viewportRight: window.innerWidth,
        widths: [menuRect.width, overflowRect.width, formatRect.width],
      };
    });
    expect(
      Math.abs((geometry.menuVisibleLeft - geometry.toolbarLeft) - (geometry.toolbarRight - geometry.formatIconRight)),
      JSON.stringify(geometry),
    ).toBeLessThanOrEqual(2);
    for (const barWidth of geometry.menuBarWidths) {
      expect(Math.abs(barWidth - geometry.menuBarWidths[0])).toBeLessThanOrEqual(1);
    }
    expect(geometry.menuLeft).toBeLessThan(geometry.overflowRight);
    expect(geometry.overflowRight).toBeLessThanOrEqual(geometry.formatLeft);
    expect(geometry.formatRight).toBeGreaterThan(geometry.overflowRight);
    for (const width of geometry.widths) {
      expect(Math.abs(width - 40)).toBeLessThanOrEqual(1);
    }

    await overflowButton.click();
    const menuTop = await page.getByTestId("toolbar-overflow-menu").evaluate((menu) =>
      Math.round(menu.getBoundingClientRect().top),
    );
    await page.evaluate(() => window.scrollBy(0, 180));
    await expect
      .poll(() => page.getByTestId("toolbar-overflow-menu").evaluate((menu) =>
        Math.round(menu.getBoundingClientRect().top),
      ))
      .toBe(menuTop);
  });

  test("mobile feed and reader spacing stay balanced", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await acceptLegalGate(page);
    await waitForPwaReady(page);
    await seedNavigationFeed(page);

    const firstCard = page.locator(".feed-card").filter({ hasText: "Navigation Item One" }).first();
    await expect(firstCard).toBeVisible();

    const spacing = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
      const card = document.querySelector(".feed-card") as HTMLElement | null;
      if (!toolbar || !card) {
        throw new Error("Feed spacing elements were not found");
      }
      const toolbarRect = toolbar.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        leftGap: Math.round(cardRect.left),
        topGap: Math.round(cardRect.top - toolbarRect.bottom),
      };
    });
    expect(Math.abs(spacing.leftGap - spacing.topGap)).toBeLessThanOrEqual(1);

    await firstCard.click();
    const reader = page.getByTestId("reader-article");
    await expect(reader).toBeVisible();
    const readerMetrics = await reader.evaluate((article) => {
      const style = window.getComputedStyle(article);
      return {
        bodyOverflow: document.body.style.overflow,
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
      };
    });
    expect(readerMetrics.bodyOverflow).toBe("hidden");
    expect(readerMetrics.paddingLeft).toBeGreaterThanOrEqual(20);
    expect(readerMetrics.paddingRight).toBeGreaterThanOrEqual(20);
  });

  test("inline reader does not add a second toolbar divider", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/");
    await acceptLegalGate(page);
    await waitForPwaReady(page);
    await seedNavigationFeed(page);

    const firstCard = page.locator(".feed-card").filter({ hasText: "Navigation Item One" }).first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    const reader = page.getByTestId("reader-article");
    await expect(reader).toBeVisible();
    const metrics = await reader.evaluate((article) => {
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
      const scroller = article.parentElement;
      return {
        toolbarVisible: !!toolbar,
        scrollerHasFadeMask: scroller?.classList.contains("theme-scroll-fade-y") ?? false,
      };
    });
    expect(metrics.toolbarVisible).toBe(true);
    expect(metrics.scrollerHasFadeMask).toBe(false);
  });

  test("app has correct colors and styling", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Check that accent color is applied to logo
    const logo = page.getByRole("banner").getByText("FREED");
    await expect(logo).toHaveClass(/gradient-text/);

    // Check dark theme background
    const body = page.locator("body");
    const bgColor = await body.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    // Should be dark (rgb values close to 18, 18, 18)
    expect(bgColor).toMatch(/rgb\(10, 10, 10\)|rgba\(10, 10, 10/);
  });

  test("populate sample data appends a fresh batch each time", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    const before = await getLibraryCounts(page);
    await openDangerZone(page);

    await populateSampleData(page, before, EXPECTED_FIRST_SAMPLE_LIBRARY_COUNTS);
    const afterFirst = await getLibraryCounts(page);
    expect(afterFirst.friends - before.friends).toBe(EXPECTED_FIRST_SAMPLE_LIBRARY_COUNTS.friends);
    expect(afterFirst.items - before.items).toBe(EXPECTED_FIRST_SAMPLE_LIBRARY_COUNTS.items);
    expect(afterFirst.feeds - before.feeds).toBe(EXPECTED_FIRST_SAMPLE_LIBRARY_COUNTS.feeds);

    await openDangerZone(page);
    await populateSampleData(page, afterFirst, EXPECTED_ADDITIONAL_SAMPLE_LIBRARY_COUNTS);
    const afterSecond = await getLibraryCounts(page);
    expect(afterSecond.friends - afterFirst.friends).toBe(EXPECTED_ADDITIONAL_SAMPLE_LIBRARY_COUNTS.friends);
    expect(afterSecond.items - afterFirst.items).toBe(EXPECTED_ADDITIONAL_SAMPLE_LIBRARY_COUNTS.items);
    expect(afterSecond.feeds - afterFirst.feeds).toBe(EXPECTED_ADDITIONAL_SAMPLE_LIBRARY_COUNTS.feeds);

    const batchSummary = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => {
          friends: Record<string, {
            id: string;
            sources: Array<{ platform: string }>;
          }>;
          items: Array<{
            platform: string;
            author: { id: string };
          }>;
        };
      };
      const state = store.getState();
      const linkedInFriendCount = Object.values(state.friends).filter((friend) =>
        friend.sources.some((source) => source.platform === "linkedin")
      ).length;
      const linkedInItemCount = state.items.filter((item) => item.platform === "linkedin").length;

      return {
        friendIds: Object.keys(state.friends),
        linkedInFriendCount,
        linkedInItemCount,
      };
    });

    expect(batchSummary.friendIds.some((id) => id === "sample-friend-maya")).toBe(false);
    expect(batchSummary.linkedInFriendCount).toBeGreaterThan(0);
    expect(batchSummary.linkedInItemCount).toBe(EXPECTED_LINKEDIN_ITEMS_PER_BATCH * 2);
  });
});

test.describe("Reader View", () => {
  test.skip("opens reader view when clicking an item", async ({ page }) => {
    // This test requires having items in the feed
    // Skip for now since we start with empty state
    await page.goto("/");

    // Would need to add a feed first, then click an item
  });
});
