/**
 * Playwright test fixtures for the Freed Desktop E2E suite.
 *
 * Usage:
 *   import { test, expect } from './fixtures/app';
 *   test('my test', async ({ app, ipc }) => { ... });
 *
 * Fixtures:
 *   app  - AppFixture wrapping the Playwright Page. Provides waitForReady()
 *           and helpers for injecting mock RSS data at scale.
 *   ipc  - IpcFixture for overriding and asserting on invoke() calls.
 */

import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";
import { tauriInitScript } from "./tauri-init";

// ─── Types mirrored from @freed/shared so fixtures have no build dep ─────────

interface MockFeedItem {
  globalId: string;
  platform: string;
  contentType: string;
  capturedAt: number;
  publishedAt: number;
  author: { id: string; handle: string; displayName: string };
  content: {
    text: string;
    mediaUrls: string[];
    mediaTypes: string[];
    linkPreview: { url: string; title: string; description: string };
  };
  userState: { hidden: boolean; saved: boolean; archived: boolean; tags: string[] };
  topics: string[];
  rssSource: { feedUrl: string; feedTitle: string };
}

// ─── AppFixture ───────────────────────────────────────────────────────────────

export async function setDeviceDisplayPreferences(
  page: Page,
  update: Readonly<Record<string, unknown>>,
): Promise<void> {
  await page.evaluate((values) => {
    const key = "freed-device-display-preferences-v1";
    const oldValue = window.localStorage.getItem(key);
    let current: Record<string, unknown> = {};
    if (oldValue !== null) {
      try {
        const parsed = JSON.parse(oldValue) as {
          version?: unknown;
          values?: unknown;
        };
        if (
          parsed.version === 1 &&
          typeof parsed.values === "object" &&
          parsed.values !== null &&
          !Array.isArray(parsed.values)
        ) {
          current = parsed.values as Record<string, unknown>;
        }
      } catch {
        current = {};
      }
    }
    const newValue = JSON.stringify({
      version: 1,
      values: { ...current, ...values },
    });
    window.localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", {
      key,
      newValue,
      oldValue,
      storageArea: window.localStorage,
      url: window.location.href,
    }));
  }, update);
}

export class AppFixture {
  constructor(public readonly page: Page) {}

  async setDeviceDisplayPreferences(
    update: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await setDeviceDisplayPreferences(this.page, update);
  }

  async acceptLegalGateIfPresent(timeout = 5_000): Promise<boolean> {
    const acceptButton = this.page.getByTestId("legal-gate-accept");
    const gateVisible = await acceptButton.isVisible({ timeout }).catch(() => false);

    if (!gateVisible) return false;

    const checkboxes = this.page.getByRole("checkbox");
    const checkboxCount = await checkboxes.count();
    for (let index = 0; index < checkboxCount; index += 1) {
      await checkboxes.nth(index).check();
    }
    await acceptButton.waitFor({ state: "attached", timeout });
    await this.page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="legal-gate-accept"]');
      return !!button && !button.disabled;
    }, { timeout });
    await acceptButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(this.page.locator("main")).toBeVisible({ timeout });
    return true;
  }

  async acceptProviderRiskIfPresent(
    provider:
      | "x"
      | "facebook"
      | "instagram"
      | "linkedin"
      | "substack"
      | "medium"
      | "youtube",
    timeout = 10_000,
  ): Promise<boolean> {
    const dialog = this.page.getByTestId(`provider-risk-dialog-${provider}`);
    const acceptButton = this.page.getByTestId(`provider-risk-accept-${provider}`);
    const dialogVisible = await acceptButton.isVisible({ timeout }).catch(() => false);

    if (!dialogVisible) return false;

    let checked = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const dialog = this.page.getByTestId(`provider-risk-dialog-${provider}`);
        const checkbox = dialog.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: "visible", timeout });
        await checkbox.evaluate((element) => {
          (element as HTMLInputElement).click();
        });
        checked = true;
        break;
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
        await this.page.waitForTimeout(150);
      }
    }

    if (!checked) return false;

    await expect(acceptButton).toBeEnabled({ timeout });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const button = this.page.getByTestId(`provider-risk-accept-${provider}`);
        await button.waitFor({ state: "visible", timeout });
        await button.evaluate((element) => {
          (element as HTMLButtonElement).click();
        });
        break;
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
        await this.page.waitForTimeout(150);
      }
    }
    await expect(acceptButton).toBeHidden({ timeout });
    return true;
  }

  /** Navigate to the app root and wait until the React tree fully initialises. */
  async goto(path = "/"): Promise<void> {
    await this.page.goto(path);
  }

  /**
   * Block until the app store reports isInitialized = true and the first
   * render of <main> is visible. Typically resolves in under 500 ms with an
   * empty SQLite Library.
   */
  async waitForReady(timeout = 15_000): Promise<void> {
    await this.acceptLegalGateIfPresent();
    await this.page.waitForFunction(
      () => {
        const w = window as Record<string, unknown>;
        const store = w.__FREED_STORE__ as
          | { getState: () => { isInitialized: boolean } }
          | undefined;
        return store?.getState().isInitialized === true;
      },
      { timeout },
    );
    await this.page.locator("main").waitFor({ state: "visible", timeout });
    await this.page.evaluate(() => {
      const w = window as Window & {
        __freed?: {
          debug?: () => { setVisible: (visible: boolean) => void };
        };
      };
      w.__freed?.debug?.()?.setVisible(false);
    });
    await expect(this.page.getByTestId("debug-panel-drawer")).toHaveCSS("width", "0px", {
      timeout,
    });
  }

  /**
   * Generate and inject `count` mock RSS feed items through the typed SQLite
   * import mutation.
   *
   * Call waitForReady() before this so the Library is initialized.
   */
  async injectRssItems(count: number, feedUrl = "https://bench.example/feed.xml"): Promise<void> {
    await this.page.evaluate(
      async ({ count, feedUrl }) => {
        const w = window as Record<string, unknown>;
        const libraryCore = w.__FREED_LIBRARY_CORE__ as {
          importLibraryItems: (items: unknown[]) => Promise<unknown>;
        };

        const now = Date.now();
        const items: MockFeedItem[] = Array.from({ length: count }, (_, i) => ({
          globalId: `rss:${feedUrl}:bench-item-${i}`,
          platform: "rss",
          contentType: "article",
          capturedAt: now - i * 60_000,
          publishedAt: now - i * 60_000,
          author: {
            id: "bench-feed",
            handle: "bench-feed",
            displayName: "Benchmark Feed",
          },
          content: {
            text: `Article ${i.toLocaleString()}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: {
              url: `https://bench.example/article-${i}`,
              title: `Benchmark Article ${i.toLocaleString()}`,
              description: `This is benchmark article number ${i.toLocaleString()} for performance testing.`,
            },
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          rssSource: {
            feedUrl,
            feedTitle: "Benchmark Feed",
          },
        }));

        await libraryCore.importLibraryItems(items);
      },
      { count, feedUrl },
    );

    // SQLite keeps the corpus out of Zustand. Wait for the native mock rows and
    // the bounded aggregate consumed by the visible store.
    await this.page.waitForFunction(
      (expectedCount: number) => {
        const w = window as Record<string, unknown>;
        const sqlite = w.__TAURI_MOCK_SQLITE_LIBRARY__ as
          | { active?: boolean; items?: Record<string, { __deleted?: boolean }> }
          | undefined;
        const store = w.__FREED_STORE__ as
          | {
              getState: () => {
                itemCountByPlatform: Record<string, number>;
                items: unknown[];
              };
            }
          | undefined;
        if (sqlite?.active) {
          return (
            Object.values(sqlite.items ?? {}).filter((item) => !item.__deleted)
              .length >= expectedCount &&
            (store?.getState().itemCountByPlatform.rss ?? 0) >= expectedCount
          );
        }
        return false;
      },
      count,
      { timeout: 30_000 },
    );
  }

  async seedFriendLocation(): Promise<void> {
    await this.page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const libraryCore = w.__FREED_LIBRARY_CORE__ as {
        upsertLibraryPerson: (person: unknown) => Promise<void>;
        upsertLibraryAccount: (account: unknown) => Promise<void>;
        addLibraryFeedItems: (items: unknown[]) => Promise<void>;
      };
      const store = w.__FREED_STORE__ as {
        getState: () => {
          setActiveView: (view: string) => void;
          setSelectedPerson: (id: string | null) => void;
        };
      };

      const now = Date.now();
      await libraryCore.upsertLibraryPerson({
        id: "friend-ada",
        name: "Ada Lovelace",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: now,
        updatedAt: now,
      });
      await libraryCore.upsertLibraryAccount({
        id: "friend-ada:instagram:ada-ig",
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

      await libraryCore.addLibraryFeedItems([
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
          const sqlite = w.__TAURI_MOCK_SQLITE_LIBRARY__ as {
            accounts: Record<string, unknown>;
            items: Record<string, unknown>;
            persons: Record<string, unknown>;
          };
          if (
            sqlite.persons["friend-ada"] &&
            sqlite.accounts["friend-ada:instagram:ada-ig"] &&
            sqlite.items["ig:ada:paris"]
          ) {
            clearInterval(interval);
            resolve();
            return;
          }
          if (Date.now() - startedAt > 5_000) {
            clearInterval(interval);
            const sqlite = w.__TAURI_MOCK_SQLITE_LIBRARY__ as
              | { active?: boolean; items?: Record<string, unknown>; shell?: Record<string, unknown> }
              | undefined;
            reject(new Error(`seed timeout ${JSON.stringify({
              sqliteActive: sqlite?.active,
              sqliteItems: Object.keys(sqlite?.items ?? {}),
              sqliteShellKeys: Object.keys(sqlite?.shell ?? {}),
            })}`));
          }
        }, 50);
      });
    });
  }

  async seedAllContentLocationsWithoutFriends(): Promise<void> {
    await this.page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const libraryCore = w.__FREED_LIBRARY_CORE__ as {
        addLibraryFeedItems: (items: unknown[]) => Promise<void>;
      };
      const now = Date.now();
      await libraryCore.addLibraryFeedItems([
        {
          globalId: "ig:nora:paris",
          platform: "instagram",
          contentType: "post",
          capturedAt: now - 120_000,
          publishedAt: now - 120_000,
          author: {
            id: "nora-ig",
            handle: "nora",
            displayName: "Nora Quinn",
          },
          content: {
            text: "Earlier stop in Paris",
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
        {
          globalId: "ig:nora:story",
          platform: "instagram",
          contentType: "story",
          capturedAt: now - 60_000,
          publishedAt: now - 60_000,
          author: {
            id: "nora-ig",
            handle: "nora",
            displayName: "Nora Quinn",
          },
          content: {
            text: "Recoverable story location",
            mediaUrls: [],
            mediaTypes: [],
          },
          location: {
            name: "Locations",
            coordinates: { lat: 34.2439, lng: -116.9114 },
            url: "https://www.instagram.com/explore/locations/123456789/big-bear-california/",
            source: "sticker",
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
          globalId: "ig:ghost:story",
          platform: "instagram",
          contentType: "story",
          capturedAt: now - 30_000,
          publishedAt: now - 30_000,
          author: {
            id: "ghost-ig",
            handle: "ghost",
            displayName: "Ghost Noise",
          },
          content: {
            text: "Should not show on the map",
            mediaUrls: [],
            mediaTypes: [],
          },
          location: {
            name: "Check registration",
            source: "sticker",
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
          const sqlite = w.__TAURI_MOCK_SQLITE_LIBRARY__ as {
            items: Record<string, unknown>;
          };
          const hasNora = Boolean(sqlite.items["ig:nora:story"]);
          const hasGhost = Boolean(sqlite.items["ig:ghost:story"]);
          if (hasNora && hasGhost) {
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
    });
  }
}

export async function acceptLegalGate(page: Page, timeout = 5_000): Promise<boolean> {
  const app = new AppFixture(page);
  return app.acceptLegalGateIfPresent(timeout);
}

export function resolveViteFsModulePath(relativePath: string, baseUrl: string): string {
  const fsPath = fileURLToPath(new URL(relativePath, baseUrl));
  return `/@fs${fsPath}`;
}

// ─── IpcFixture ───────────────────────────────────────────────────────────────

export class IpcFixture {
  constructor(private readonly page: Page) {}

  /** Override the handler for a specific invoke() command. */
  async setHandler(cmd: string, handler: (args: unknown) => unknown): Promise<void> {
    await this.page.evaluate(
      ({ cmd, handlerStr }) => {
        const w = window as Record<string, unknown>;
        const handlers = w.__TAURI_MOCK_HANDLERS__ as Record<string, unknown>;
        // eslint-disable-next-line no-new-func
        handlers[cmd] = new Function("return (" + handlerStr + ")")();
      },
      { cmd, handlerStr: handler.toString() },
    );
  }

  /** Return all recorded invoke() calls as { cmd, args } pairs. */
  async invocations(): Promise<Array<{ cmd: string; args: unknown }>> {
    return this.page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__TAURI_MOCK_INVOCATIONS__ as Array<{ cmd: string; args: unknown }>) ?? [];
    });
  }

  /** Return URLs passed to plugin-shell open(). */
  async openedUrls(): Promise<string[]> {
    return this.page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__TAURI_MOCK_OPENED_URLS__ as string[]) ?? [];
    });
  }
}

// ─── Fixture wiring ───────────────────────────────────────────────────────────

type Fixtures = {
  app: AppFixture;
  ipc: IpcFixture;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    // Inject the IPC shim before page JS fires so mock globals are ready.
    await page.addInitScript(tauriInitScript());
    await page.addInitScript(() => {
      (window as Window & { __FREED_E2E_FORCE_MAP_FALLBACK__?: boolean })
        .__FREED_E2E_FORCE_MAP_FALLBACK__ = true;
    });
    await use(new AppFixture(page));
  },

  ipc: async ({ page }, use) => {
    await use(new IpcFixture(page));
  },
});

export { expect };

// Re-export MockFeedItem so spec files can extend it without a re-import.
export type { MockFeedItem };
