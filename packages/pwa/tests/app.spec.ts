import { test, expect } from "@playwright/test";

interface BrowserLibraryFacetSummary {
  readonly platformCounts: readonly {
    readonly platform: string;
    readonly totalCount: number;
  }[];
  readonly rssFeedCount: number;
  readonly totalCount: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (
      globalThis as typeof globalThis & {
        __FREED_PWA_SQLITE_MEMORY_E2E__?: boolean;
      }
    ).__FREED_PWA_SQLITE_MEMORY_E2E__ = true;
  });
});

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
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      addFeed: (feed: unknown) => Promise<void>;
      facetSummary: () => Promise<{ rssFeedCount: number }>;
      removeAllFeeds: (includeItems: boolean) => Promise<void>;
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

    await libraryCore.removeAllFeeds(false);

    for (const [index, title] of feedTitles.entries()) {
      await libraryCore.addFeed({
        url: `https://example.com/feeds/${index + 1}.xml`,
        title,
        enabled: true,
        trackUnread: false,
      });
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(async () => {
        const facets = await libraryCore.facetSummary();
        if (facets.rssFeedCount >= feedTitles.length) {
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
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      replacePerson: (person: unknown, accounts: unknown[]) => Promise<void>;
      addAccount: (account: unknown) => Promise<void>;
      addItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setActiveView: (view: string) => void;
        setSelectedPerson: (id: string | null) => void;
      };
    };

    const now = Date.now();
    await libraryCore.replacePerson({
      id: "friend-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    }, []);
    await libraryCore.addAccount({
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

    await libraryCore.addItems([
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

    const state = store.getState();
    state.setActiveView("friends");
    state.setSelectedPerson("friend-ada");
  });
}

async function seedFriendFeedLens(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      replacePerson: (person: unknown, accounts: unknown[]) => Promise<void>;
      addAccount: (account: unknown) => Promise<void>;
      addItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setActiveView: (view: string) => void;
        setSelectedPerson: (id: string | null) => void;
        setSelectedItem: (id: string | null) => void;
      };
    };

    const now = Date.now();
    await libraryCore.replacePerson({
      id: "friend-grace",
      name: "Grace Hopper",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    }, []);
    await libraryCore.addAccount({
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

    await libraryCore.addItems([
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

    const state = store.getState();
    state.setActiveView("feed");
    state.setSelectedPerson(null);
    state.setSelectedItem(null);
  });
}

async function seedMultipleFriendLocations(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      replacePerson: (person: unknown, accounts: unknown[]) => Promise<void>;
      addItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setActiveView: (view: string) => void;
      };
    };
    const now = Date.now();
    await libraryCore.replacePerson({
      id: "friend-omar",
      name: "Omar Hassan",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    }, [{
      id: "social:instagram:omar-ig",
      personId: "friend-omar",
      kind: "social",
      provider: "instagram",
      externalId: "omar-ig",
      handle: "omar",
      displayName: "Omar Hassan",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }]);

    await libraryCore.replacePerson({
      id: "friend-samir",
      name: "Samir Dutta",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    }, [{
      id: "social:linkedin:samir-li",
      personId: "friend-samir",
      kind: "social",
      provider: "linkedin",
      externalId: "samir-li",
      handle: "samir-dutta",
      displayName: "Samir Dutta",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }]);

    await libraryCore.addItems([
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
          name: "McMurdo Station, Antarctica",
          coordinates: { lat: -77.8419, lng: 166.6863 },
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
          name: "Rothera Research Station, Antarctica",
          coordinates: { lat: -67.5681, lng: -68.125 },
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

    store.getState().setActiveView("map");
  });
}

async function seedFriendsWorkspace(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForPwaDocumentReady(page);
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      replacePerson: (person: unknown, accounts: unknown[]) => Promise<void>;
      appendReachOut: (personId: string, entry: unknown) => Promise<void>;
      addItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setActiveView: (view: string) => void;
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };

    const now = Date.now();
    await libraryCore.replacePerson({
      id: "friend-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 5,
      createdAt: now,
      updatedAt: now,
    }, [{
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
    }]);
    await libraryCore.appendReachOut("friend-ada", {
      loggedAt: now - 45 * 24 * 60 * 60_000,
      channel: "text",
    });
    await libraryCore.replacePerson({
      id: "friend-maya",
      name: "Maya Chen",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    }, [{
      id: "social:linkedin:maya-li",
      personId: "friend-maya",
      kind: "social",
      provider: "linkedin",
      externalId: "maya-li",
      handle: "maya-chen",
      displayName: "Maya Chen",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }]);
    await libraryCore.replacePerson({
      id: "friend-jules",
      name: "Jules Rivera",
      relationshipStatus: "friend",
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    }, [{
      id: "social:instagram:jules-ig",
      personId: "friend-jules",
      kind: "social",
      provider: "instagram",
      externalId: "jules-ig",
      handle: "jules",
      displayName: "Jules Rivera",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }]);

    await libraryCore.addItems([
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

    await store.getState().updatePreferences({
      display: {
        friendsSidebarWidth: 340,
      },
    });

    store.getState().setActiveView("friends");
  });
}

const NAV_FEED_URL = "https://example.com/navigation.xml";

async function seedNavigationFeed(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async (feedUrl: string) => {
    const w = window as Record<string, unknown>;
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      addFeed: (feed: unknown) => Promise<void>;
      addItems: (items: unknown[]) => Promise<void>;
      facetSummary: () => Promise<BrowserLibraryFacetSummary>;
    };

    const now = Date.now();
    await libraryCore.addFeed({
      url: feedUrl,
      title: "Navigation Feed",
      siteUrl: "https://example.com",
      enabled: true,
      trackUnread: true,
      lastFetched: now,
    });

    await libraryCore.addItems([
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
          tags: [],
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
          tags: [],
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
          tags: [],
        },
        topics: [],
        sourceUrl: "https://example.com/navigation-3",
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(async () => {
        const facets = await libraryCore.facetSummary();
        if (facets.rssFeedCount >= 1 && facets.totalCount >= 3) {
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
    const libraryCore = w.__FREED_LIBRARY_CORE__ as {
      addItems: (items: unknown[]) => Promise<void>;
      facetSummary: () => Promise<BrowserLibraryFacetSummary>;
    };

    const now = Date.now();
    await libraryCore.addItems([
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
      const interval = window.setInterval(async () => {
        const facets = await libraryCore.facetSummary();
        const facebook = facets.platformCounts.find(
          (entry) => entry.platform === "facebook",
        );
        if ((facebook?.totalCount ?? 0) >= 1) {
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
    await expect(page.locator("text=Connect to Freed Desktop")).toBeVisible();
    await expect(page.locator("text=Alternatively, for preview & testing:")).toBeVisible();
    await expect(page.getByRole("button", { name: /Populate sample data/i })).toBeVisible();
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

    await page
      .getByTestId("source-row-rss")
      .getByRole("button", { name: "Expand feeds", exact: true })
      .click();

    await expect(page.getByRole("button", { name: "Alpha Dispatch", exact: true })).toBeVisible();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next feeds page" })).toBeEnabled();

    await page.getByRole("button", { name: "Next feeds page" }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous feeds page" })).toBeEnabled();

    await page.getByRole("textbox", { name: "Search or run" }).fill("needle");
    await expect(page.getByRole("button", { name: "Needle Feed", exact: true })).toBeVisible();
    await expect(page.getByText("Page 2", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next feeds page" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Alpha Dispatch", exact: true })).toHaveCount(0);
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
    await expect(sidebar.getByRole("button", { name: "Alpha Dispatch", exact: true })).toHaveCount(0);
    const expandFeedsButton = sidebar.locator('button[aria-label="Expand feeds"]');
    await expect(expandFeedsButton).toBeVisible();

    await expandFeedsButton.click();
    await expect(sidebar.getByRole("button", { name: "Alpha Dispatch", exact: true })).toBeVisible();
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
      await expect(page.getByRole("region", { name: "Friends galaxy" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Friends", level: 2 })).toBeVisible();
    });

    test("browser history tracks top-level view navigation", async ({ page }) => {
      await page.goto("/");
      await acceptLegalGate(page);
      await waitForPwaReady(page);

      await page.getByTestId("source-row-friends").click({ force: true });
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

      await sidebar
        .getByTestId("source-row-rss")
        .getByRole("button", { name: "Expand feeds", exact: true })
        .click();
      await sidebar.getByRole("button", { name: "Navigation Feed", exact: true }).click();
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
      await expect(page.getByLabel("Friends galaxy")).toBeVisible();

      await page.goBack();
      await expect.poll(() => new URL(page.url()).search).toBe("?item=facebook%3Areader-author%3A1");
      await expect(page.getByTestId("reader-article")).toBeVisible();
      await expect(page.getByText("Freed hit a fatal error")).toHaveCount(0);
    });

    test("item URLs survive a temporarily unavailable SQLite source", async ({ page }) => {
      await page.goto("/?item=missing-item");
      await acceptLegalGate(page);
      await waitForPwaReady(page);

      await expect(page.getByText("Item temporarily unavailable")).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe("?item=missing-item");
      await page.waitForFunction(() => {
        const store = (window as Record<string, unknown>).__FREED_STORE__ as {
          getState: () => { selectedItemId: string | null };
        };
        return store.getState().selectedItemId === "missing-item";
      });
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
    expect(Math.round(mapBox!.x)).toBe(0);
    expect(Math.round(mapBox!.width)).toBe(page.viewportSize()!.width);
  });

  test("feed and friends use shared headers while map stays full-bleed", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    await expect(page.getByRole("banner").getByText(/^All Sources•/)).toBeVisible();

    await page.getByTestId("source-row-friends").click();
    await expect(page.getByRole("banner").getByText(/^Friends•/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Friends galaxy" })).toBeVisible();

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
    const mapAvatarUrl = await page
      .locator('.freed-map-marker[data-avatar-name="Ada Lovelace"]')
      .first()
      .getAttribute("data-avatar-url");

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
    expect(Math.round(before!.width)).toBeGreaterThan(300);

    const handle = page.getByRole("separator", { name: "Resize friends sidebar" });
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 120, handleBox!.y + handleBox!.height / 2, { steps: 8 });
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
    await page.getByTestId("source-row-friends").click();

    const afterReturn = await sidebar.boundingBox();
    expect(afterReturn).not.toBeNull();
    expect(Math.abs(Math.round(afterReturn!.width) - Math.round(afterResize!.width))).toBeLessThanOrEqual(2);
  });

  test("friend graph handles browser-generated two-finger pinch without page zoom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const browserSession = await page.context().newCDPSession(page);
    await browserSession.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 2,
    });
    await page.goto("/");
    await acceptLegalGate(page);
    await seedFriendsWorkspace(page);

    const canvas = page.getByTestId("friend-graph-canvas");
    await expect(canvas).toBeVisible();
    const viewport = page.getByTestId("friend-graph-viewport");
    await expect(viewport).toHaveAttribute("data-graph-quality-mode", "settled", {
      timeout: 10_000,
    });
    await expect.poll(() => viewport.evaluate((element) => (
      Number((element as HTMLElement).dataset.graphNodeCount ?? "0")
    )), { timeout: 10_000 }).toBeGreaterThan(0);
    const readGraphScale = () => page.evaluate(() => (
      window as typeof window & {
        __FREED_GRAPH_PERF__?: { transformScale?: number };
      }
    ).__FREED_GRAPH_PERF__?.transformScale ?? 0);
    await expect.poll(readGraphScale).toBeGreaterThan(0);
    const beforeScale = await readGraphScale();
    const pageZoomBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomBefore).toBe(1);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const centerX = Math.round(box!.x + box!.width / 2);
    const centerY = Math.round(box!.y + box!.height / 2);
    const touchPoints = (distance: number) => [
      {
        x: centerX - distance,
        y: centerY,
        radiusX: 8,
        radiusY: 8,
        force: 1,
        id: 0,
      },
      {
        x: centerX + distance,
        y: centerY,
        radiusX: 8,
        radiusY: 8,
        force: 1,
        id: 1,
      },
    ];

    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touchPoints(48),
    });
    for (const distance of [60, 74, 90, 108]) {
      await browserSession.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touchPoints(distance),
      });
    }
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect.poll(readGraphScale).toBeGreaterThan(beforeScale);
    const firstPinchScale = await readGraphScale();

    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touchPoints(52),
    });
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touchPoints(48),
    });
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoints(96),
    });
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(readGraphScale).toBeGreaterThan(firstPinchScale);
    const secondPinchScale = await readGraphScale();

    const fitAllButton = page.getByRole("button", { name: "Fit all" });
    await fitAllButton.click();
    await expect.poll(readGraphScale).toBeLessThan(secondPinchScale);

    const pageZoomAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomAfter).toBe(1);
  });

  test("map loads its bundled worker without asset failures", async ({ page }) => {
    const mapAssetResponses: Array<{ url: string; status: number }> = [];
    const workerUrls: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("maplibre-gl")) {
        mapAssetResponses.push({ url, status: response.status() });
      }
    });
    page.on("worker", (worker) => workerUrls.push(worker.url()));

    await page.goto("/");
    await acceptLegalGate(page);
    await page.getByRole("button", { name: "Map" }).click();

    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect.poll(() => workerUrls.length).toBeGreaterThan(0);
    expect(mapAssetResponses.length).toBeGreaterThan(0);
    expect(mapAssetResponses.every(({ status }) => status < 400)).toBeTruthy();
  });

  test("map popovers show update time and keep only one open", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __FREED_E2E_FORCE_MAP_FALLBACK__?: boolean })
        .__FREED_E2E_FORCE_MAP_FALLBACK__ = true;
    });

    await page.goto("/");
    await acceptLegalGate(page);
    await seedMultipleFriendLocations(page);

    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.getByText("Map failed to load")).toHaveCount(0);
    await page.getByRole("button", { name: "Omar Hassan" }).evaluate((element) => {
      (element as HTMLElement).click();
    });
    await expect(page.getByText("McMurdo Station, Antarctica")).toBeVisible();
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

    await page.getByRole("button", { name: "Samir Dutta" }).evaluate((element) => {
      (element as HTMLElement).click();
    });
    await expect(page.getByText("Rothera Research Station, Antarctica")).toBeVisible();
    await expect(page.getByText("McMurdo Station, Antarctica")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Post" })).toHaveCount(1);
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
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
      const button = document.querySelector('button[aria-label="Close menu"]') as HTMLElement | null;
      const icon = button?.querySelector("[aria-hidden='true']") as HTMLElement | null;
      const sidebar = document.querySelector('[data-testid="app-sidebar-mobile"]') as HTMLElement | null;
      const search = sidebar?.querySelector('input[aria-label="Search or run"]') as HTMLElement | null;
      const firstSourceButton = sidebar?.querySelector('[data-testid="source-row-all"]') as HTMLElement | null;
      const firstControl = sidebar?.querySelector("input, button") as HTMLElement | null;
      const settingsFooter = sidebar?.querySelector('[data-testid="mobile-sidebar-settings-footer"]') as HTMLElement | null;
      const settingsButton = sidebar?.querySelector('[data-testid="mobile-sidebar-settings-button"]') as HTMLElement | null;
      if (!toolbar || !button || !icon || !sidebar || !search || !firstSourceButton || !firstControl || !settingsFooter || !settingsButton) {
        throw new Error("Mobile menu geometry elements were not found");
      }
      const toolbarRect = toolbar.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      const firstSourceButtonRect = firstSourceButton.getBoundingClientRect();
      const footerRect = settingsFooter.getBoundingClientRect();
      const settingsButtonRect = settingsButton.getBoundingClientRect();
      const toolbarStyle = window.getComputedStyle(toolbar);
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
        menuEdgeGap: Math.round(buttonRect.left - toolbarRect.left),
        firstControlIsSearch: firstControl === search,
        sourceCenterHitsSidebar: !!hitElement && sidebar.contains(hitElement),
        toolbarBorderBottomColor: toolbarStyle.borderBottomColor,
        sidebarZIndex: Number.parseInt(sidebarStyle.zIndex, 10),
        sidebarWidth: Math.round(sidebarRect.width),
        viewportWidth: window.innerWidth,
        sidebarBoxShadow: sidebarStyle.boxShadow,
        searchEdgeGap: Math.round(searchRect.left - sidebarRect.left),
        searchHeight: Math.round(searchRect.height),
        sourceEdgeGap: Math.round(firstSourceButtonRect.left - sidebarRect.left),
        settingsEdgeGap: Math.round(settingsButtonRect.left - sidebarRect.left),
        searchTop: Math.round(searchRect.top),
        sidebarTop: Math.round(sidebarRect.top),
        searchToFirstRowGap: Math.round(firstSourceButtonRect.top - searchRect.bottom),
        footerBottomGap: Math.round(sidebarRect.bottom - footerRect.bottom),
        settingsButtonBottomGap: Math.round(sidebarRect.bottom - settingsButtonRect.bottom),
        footerBorderTopWidth: footerStyle.borderTopWidth,
        sourceFontSize: sourceStyle.fontSize,
        sourceButtonHeight: Math.round(firstSourceButtonRect.height),
        sourcePaddingTop: sourceStyle.paddingTop,
        sourcePaddingBottom: sourceStyle.paddingBottom,
        sourceColumnGap: sourceStyle.columnGap,
        settingsButtonFontSize: settingsButtonStyle.fontSize,
        settingsButtonPaddingTop: settingsButtonStyle.paddingTop,
        settingsButtonHeight: Math.round(settingsButtonRect.height),
      };
    });
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    expect(geometry.menuEdgeGap).toBeGreaterThanOrEqual(8);
    expect(geometry.firstControlIsSearch).toBe(true);
    expect(geometry.sourceCenterHitsSidebar).toBe(true);
    expect(geometry.toolbarBorderBottomColor).toBe("rgba(0, 0, 0, 0)");
    expect(geometry.sidebarZIndex).toBeGreaterThan(50);
    expect(geometry.sidebarWidth).toBe(geometry.viewportWidth);
    expect(geometry.sidebarBoxShadow).toBe("none");
    expect(geometry.searchEdgeGap).toBe(geometry.menuEdgeGap);
    expect(Math.abs(geometry.searchHeight - geometry.sourceButtonHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.sourceEdgeGap - geometry.menuEdgeGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.settingsEdgeGap - geometry.menuEdgeGap)).toBeLessThanOrEqual(1);
    expect(geometry.searchTop - geometry.sidebarTop).toBeGreaterThanOrEqual(8);
    expect(geometry.searchToFirstRowGap).toBeGreaterThanOrEqual(16);
    expect(geometry.footerBottomGap).toBeLessThanOrEqual(1);
    expect(geometry.settingsButtonBottomGap).toBeGreaterThanOrEqual(8);
    expect(geometry.footerBorderTopWidth).toBe("0px");
    expect(geometry.sourceFontSize).toBe("17px");
    expect(geometry.sourcePaddingTop).toBe("8px");
    expect(geometry.sourcePaddingBottom).toBe("8px");
    expect(geometry.sourceColumnGap).toBe("8px");
    expect(geometry.settingsButtonFontSize).toBe("17px");
    expect(geometry.settingsButtonPaddingTop).toBe("8px");
    expect(geometry.settingsButtonHeight).toBeGreaterThanOrEqual(geometry.sourceButtonHeight);

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

    await expect(page.getByRole("heading", { name: "Freed Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearance" })).toHaveCount(0);
    await expect(page.getByTestId("settings-nav-panel")).toHaveCSS("border-bottom-width", "0px");
    const settingsSearchHeight = await page.getByLabel("Search settings").evaluate((input) =>
      Math.round(input.getBoundingClientRect().height),
    );
    const appearanceButtonHeight = await page.getByRole("button", { name: "Appearance" }).evaluate((button) =>
      Math.round(button.getBoundingClientRect().height),
    );
    expect(settingsSearchHeight).toBe(appearanceButtonHeight);
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
    await expect(page.getByRole("heading", { name: "Freed Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Support", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Appearance" })).toHaveCount(0);

    await page.getByRole("button", { name: "Updates" }).click();
    await expect(page.getByTestId("settings-mobile-section-title")).toHaveText("Freed SettingsUpdates");
    await expect(page.getByTestId("settings-mobile-breadcrumb-caret")).toHaveCount(1);

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
    await expect(page.getByRole("heading", { name: "Freed Settings" })).toBeVisible();
    await page.getByTestId("settings-nav-panel").getByRole("button", { name: "Saved" }).click();
    await expect(page.getByTestId("settings-mobile-section-title")).toHaveText("Freed SettingsSourcesSaved");
    await expect(page.getByTestId("settings-mobile-breadcrumb-caret")).toHaveCount(2);

    await page.getByLabel("Back to settings").click();
    await expect(page.getByRole("heading", { name: "Freed Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Danger Zone" }).click();
    await expect(page.getByTestId("settings-mobile-section-title")).toHaveText("Freed SettingsDanger Zone");
    await expect(page.getByTestId("settings-mobile-breadcrumb-caret")).toHaveCount(1);

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



  test("mobile story cards open on first tap without quick actions", async ({ page }) => {
    await emulateMobileDevice(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await acceptLegalGate(page);
    await waitForPwaReady(page);
    await seedSocialReaderItem(page);

    const storyCard = page.getByRole("button", {
      name: /Reader Author.*Social author navigation item/i,
    });
    await expect(storyCard).toBeVisible();
    await expect(storyCard.locator('button[aria-label="Bookmark"]')).toHaveCount(0);
    await expect(storyCard.locator('button[aria-label="Archive"]')).toHaveCount(0);

    await storyCard.click();
    await expect(page.getByTestId("reader-article")).toBeVisible();
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

});
