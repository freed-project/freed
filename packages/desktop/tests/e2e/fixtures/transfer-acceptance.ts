import type { Page } from "@playwright/test";
import { test as base, expect, resolveViteFsModulePath } from "./app";

const capabilityModule = resolveViteFsModulePath("../../../src/lib/library-transfer-capability.ts", import.meta.url);

/** Acceptance fixtures have no provider or cloud network authority. */
export async function blockExternalRequests(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:")
      && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
    } else {
      await route.continue();
    }
  });
}

export const test = base.extend({
  app: async ({ app }, use) => {
    await blockExternalRequests(app.page);
    const goto = app.goto.bind(app);
    app.goto = async (path = "/") => {
      await goto(path);
      const enabled = await app.page.evaluate(async (modulePath) =>
        (await import(modulePath)).LIBRARY_TRANSFER_ENABLED, capabilityModule);
      expect(enabled, "Transfer fixtures require the mocked library-transfer-acceptance server; ordinary builds remain gated.").toBe(true);
    };
    await use(app);
  },
});

export { expect, resolveViteFsModulePath };
