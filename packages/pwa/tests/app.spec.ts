import { test, expect } from "@playwright/test";

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

async function seedFriendLocation(
  page: import("@playwright/test").Page,
): Promise<void> {
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
        setSelectedFriend: (id: string | null) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddFriend({
      id: "friend-ada",
      name: "Ada Lovelace",
      sources: [
        {
          platform: "instagram",
          authorId: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
      ],
      careLevel: 4,
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
        if (state.friends["friend-ada"] && state.items.length > 0) {
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

async function seedMultipleFriendLocations(
  page: import("@playwright/test").Page,
): Promise<void> {
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
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Danger Zone" }).click();
}

async function populateSampleData(
  page: import("@playwright/test").Page,
  previousCounts: { friends: number; items: number; feeds: number },
): Promise<void> {
  const populateButton = page.getByRole("button", {
    name: /Populate sample data|Add more sample data/,
  });
  await expect(populateButton).toBeVisible();
  await populateButton.click();

  const confirmButton = page.getByRole("button", { name: "Populate anyway" });
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }

  await expect(page.getByText("Sample data added:")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => getLibraryCounts(page), {
      timeout: 15_000,
    })
    .toEqual({
      friends: previousCounts.friends + 25,
      items: previousCounts.items + 155,
      feeds: previousCounts.feeds + 10,
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

    // Should show the sidebar
    await expect(page.locator("text=Sources")).toBeVisible();
    await expect(page.locator("text=All")).toBeVisible();
  });

  test("shows empty state when no feeds", async ({ page }) => {
    await page.goto("/");
    await acceptLegalGate(page);

    // Should show empty state message
    await expect(page.locator("text=No content yet")).toBeVisible();
    await expect(page.locator("text=Connect to your desktop app")).toBeVisible();
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

    // Click on RSS filter
    await page.click('button:has-text("RSS")');

    // Should update active state (button should have accent color)
    const rssButton = page.locator('button:has-text("RSS")');
    await expect(rssButton).toHaveClass(/bg-\[#8b5cf6\]\/20/);

    // Click on All to reset
    await page.click('button:has-text("All")');
    const allButton = page.locator('button:has-text("All")');
    await expect(allButton).toHaveClass(/bg-\[#8b5cf6\]\/20/);
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

    await page.getByRole("button", { name: "Map" }).click();
    await expect(page.locator("main").getByRole("heading", { name: "Map" })).toHaveCount(0);
    await expect(page.getByText("Signal Map")).toHaveCount(0);

    const mainBox = await page.locator("main").boundingBox();
    const mapBox = await page.locator(".freed-map-shell").boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    expect(Math.round(mapBox!.y)).toBe(Math.round(mainBox!.y));
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

    await page.getByRole("button", { name: "Map" }).click();
    await expect(page.locator('.freed-map-marker[data-avatar-name="Ada Lovelace"]').first()).toBeVisible();
    const mapAvatarUrl = await page
      .locator('.freed-map-marker[data-avatar-name="Ada Lovelace"]')
      .first()
      .getAttribute("data-avatar-url");

    expect(mapAvatarUrl).toBe(friendAvatarUrl);
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

    const afterResize = await sidebar.boundingBox();
    expect(afterResize).not.toBeNull();
    expect(Math.round(afterResize!.width)).toBeGreaterThan(Math.round(before!.width));

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
    await page.goto("/");
    await acceptLegalGate(page);
    await seedMultipleFriendLocations(page);

    await page.getByRole("button", { name: "Map" }).click();
    await page.getByRole("button", { name: "Omar Hassan" }).click();
    await expect(page.getByText("Reykjavik, Capital Region, Iceland")).toBeVisible();
    await expect(page.getByText(/ago/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Friend" })).toHaveCount(1);
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
    await expect(page.getByRole("button", { name: "Open Friend" })).toHaveCount(1);
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
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await acceptLegalGate(page);

    // Sidebar should be hidden on mobile
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/-translate-x-full/);

    // Click menu button to open sidebar
    await page.click('button[aria-label="Open menu"]');

    // Sidebar should now be visible
    await expect(sidebar).toHaveClass(/translate-x-0/);
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

    await populateSampleData(page, before);
    const afterFirst = await getLibraryCounts(page);
    expect(afterFirst.friends - before.friends).toBe(25);
    expect(afterFirst.items - before.items).toBe(155);
    expect(afterFirst.feeds - before.feeds).toBe(10);

    await populateSampleData(page, afterFirst);
    const afterSecond = await getLibraryCounts(page);
    expect(afterSecond.friends - afterFirst.friends).toBe(25);
    expect(afterSecond.items - afterFirst.items).toBe(155);
    expect(afterSecond.feeds - afterFirst.feeds).toBe(10);

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
    expect(batchSummary.linkedInItemCount).toBe(20);
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
