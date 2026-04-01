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

export class AppFixture {
  constructor(public readonly page: Page) {}

  async acceptLegalGateIfPresent(timeout = 5_000): Promise<boolean> {
    const acceptButton = this.page.getByTestId("legal-gate-accept");
    const gateVisible = await acceptButton.isVisible({ timeout }).catch(() => false);

    if (!gateVisible) return false;

    const checkbox = this.page.getByRole("checkbox");
    await checkbox.check();
    await expect(acceptButton).toBeEnabled({ timeout });
    await acceptButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(this.page.locator("main")).toBeVisible({ timeout });
    return true;
  }

  async acceptProviderRiskIfPresent(
    provider: "x" | "facebook" | "instagram" | "linkedin",
    timeout = 5_000,
  ): Promise<boolean> {
    const acceptButton = this.page.getByTestId(`provider-risk-accept-${provider}`);
    const dialogVisible = await acceptButton.isVisible({ timeout }).catch(() => false);

    if (!dialogVisible) return false;

    const checkbox = this.page
      .locator("div.fixed")
      .filter({ has: acceptButton })
      .getByRole("checkbox");

    await checkbox.check();
    await expect(acceptButton).toBeEnabled({ timeout });
    await acceptButton.click();
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
   * empty Automerge doc.
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
  }

  /**
   * Generate and inject `count` mock RSS feed items into the live Automerge doc
   * via docBatchImportItems(). Items are chunked at 500 per the existing helper.
   *
   * Call waitForReady() before this so the doc is initialised.
   */
  async injectRssItems(count: number, feedUrl = "https://bench.example/feed.xml"): Promise<void> {
    await this.page.evaluate(
      async ({ count, feedUrl }) => {
        const w = window as Record<string, unknown>;
        const automerge = w.__FREED_AUTOMERGE__ as {
          docBatchImportItems: (items: unknown[]) => Promise<unknown>;
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

        // docBatchImportItems chunks at 500 items per Automerge change.
        await automerge.docBatchImportItems(items);
      },
      { count, feedUrl },
    );

    // Wait for the store to hydrate the new items into the UI.
    await this.page.waitForFunction(
      (expectedCount: number) => {
        const w = window as Record<string, unknown>;
        const store = w.__FREED_STORE__ as
          | { getState: () => { items: unknown[] } }
          | undefined;
        return (store?.getState().items.length ?? 0) >= expectedCount;
      },
      count,
      { timeout: 30_000 },
    );
  }

  async seedFriendLocation(): Promise<void> {
    await this.page.evaluate(async () => {
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
    });
  }
}

export async function acceptLegalGate(page: Page, timeout = 5_000): Promise<boolean> {
  const app = new AppFixture(page);
  return app.acceptLegalGateIfPresent(timeout);
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
    await use(new AppFixture(page));
  },

  ipc: async ({ page }, use) => {
    await use(new IpcFixture(page));
  },
});

export { expect };

// Re-export MockFeedItem so spec files can extend it without a re-import.
export type { MockFeedItem };
