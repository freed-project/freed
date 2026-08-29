import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  devices,
  expect,
  test,
  webkit,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { pwaOpfsE2eBaseUrl } from "./opfs-e2e-settings";

interface BrowserLibraryCore {
  mutateDeviceContactSync(mutation: unknown): Promise<{
    changed: boolean;
    revision: number;
  }>;
  queryDeviceContacts(query: unknown): Promise<{
    authStatus: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    revision: number;
    syncStartedAt: number | null;
    syncStatus: string;
    updatedAt: number;
  }>;
}

async function acceptLegalGate(page: Page): Promise<void> {
  const acceptButton = page.getByTestId("legal-gate-accept");
  if (!(await acceptButton.isVisible({ timeout: 5_000 }).catch(() => false))) {
    return;
  }
  await page.getByRole("checkbox").check();
  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
}

async function waitForLibrary(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const current = window as unknown as Record<string, unknown>;
    const store = current.__FREED_STORE__ as
      | { getState(): { isInitialized: boolean } }
      | undefined;
    return (
      store?.getState().isInitialized === true &&
      typeof current.__FREED_LIBRARY_CORE__ === "object"
    );
  });
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/");
  await acceptLegalGate(page);
  await waitForLibrary(page);
}

async function openPersistentLibrary(profileRoot: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const iphone = devices["iPhone 14"];
  const context = await webkit.launchPersistentContext(profileRoot, {
    userAgent: iphone.userAgent,
    viewport: iphone.viewport,
    screen: iphone.screen,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
    baseURL: pwaOpfsE2eBaseUrl,
    headless: true,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await openLibrary(page);
  return { context, page };
}

async function setContactSyncError(page: Page): Promise<{
  changed: boolean;
  revision: number;
}> {
  return page.evaluate(async () => {
    const library = (window as unknown as Record<string, unknown>)
      .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
    return library.mutateDeviceContactSync({
      authStatus: "reconnect_required",
      errorCode: "network",
      errorMessage: "OPFS restart proof",
      mutationKind: "device_contact_status_set_v1",
      schemaVersion: 1,
      syncStartedAt: null,
      syncStatus: "error",
      updatedAt: 101,
    });
  });
}

async function setContactSyncIdle(page: Page): Promise<{
  changed: boolean;
  revision: number;
}> {
  return page.evaluate(async () => {
    const library = (window as unknown as Record<string, unknown>)
      .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
    return library.mutateDeviceContactSync({
      authStatus: "connected",
      errorCode: null,
      errorMessage: null,
      mutationKind: "device_contact_status_set_v1",
      schemaVersion: 1,
      syncStartedAt: null,
      syncStatus: "idle",
      updatedAt: 102,
    });
  });
}

async function readContactSyncStatus(page: Page) {
  return page.evaluate(async () => {
    const library = (window as unknown as Record<string, unknown>)
      .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
    return library.queryDeviceContacts({
      queryId: "device_contact_status_v1",
      schemaVersion: 1,
    });
  });
}

test("WebKit reopens the same durable OPFS SQLite Library after document termination", async () => {
  const profileRoot = await mkdtemp(
    join(tmpdir(), "freed-pwa-opfs-webkit-"),
  );
  let context: BrowserContext | null = null;

  try {
    let opened = await test.step("write through the first WebKit lifecycle", () =>
      openPersistentLibrary(profileRoot),
    );
    context = opened.context;
    const page = opened.page;

    const capabilities = await page.evaluate(() => ({
      getDirectory: typeof navigator.storage?.getDirectory === "function",
      storageEstimate: typeof navigator.storage?.estimate === "function",
    }));
    expect(capabilities).toEqual({ getDirectory: true, storageEstimate: true });

    const baseline = await setContactSyncIdle(page);
    const writtenRevision = baseline.revision + 1;
    expect(await setContactSyncError(page)).toMatchObject({
      changed: true,
      revision: writtenRevision,
    });

    const sqliteFiles = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(
        "freed-library-core-sqlite-opfs-v1",
      );
      const names: string[] = [];
      for await (const name of directory.keys()) names.push(name);
      return names.sort();
    });
    expect(sqliteFiles.length).toBeGreaterThan(0);

    await context.close();
    context = null;
    opened = await test.step("reopen the same OPFS Library after WebKit exits", () =>
      openPersistentLibrary(profileRoot),
    );
    context = opened.context;
    const reopened = opened.page;
    expect(await readContactSyncStatus(reopened)).toMatchObject({
      authStatus: "reconnect_required",
      lastErrorCode: "network",
      lastErrorMessage: "OPFS restart proof",
      revision: writtenRevision,
      syncStartedAt: null,
      syncStatus: "error",
      updatedAt: 101,
    });
    expect(await setContactSyncError(reopened)).toMatchObject({
      changed: false,
      revision: writtenRevision,
    });

    const clearedRevision = writtenRevision + 1;
    expect(await setContactSyncIdle(reopened)).toMatchObject({
      changed: true,
      revision: clearedRevision,
    });

    await context.close();
    context = null;
    opened = await test.step(
      "reopen the cleared row after a second WebKit exit",
      () => openPersistentLibrary(profileRoot),
    );
    context = opened.context;
    const reopenedAfterDelete = opened.page;
    expect(await readContactSyncStatus(reopenedAfterDelete)).toMatchObject({
      authStatus: "connected",
      lastErrorCode: null,
      lastErrorMessage: null,
      revision: clearedRevision,
      syncStartedAt: null,
      syncStatus: "idle",
      updatedAt: 102,
    });
    expect(await setContactSyncIdle(reopenedAfterDelete)).toMatchObject({
      changed: false,
      revision: clearedRevision,
    });
  } finally {
    await context?.close();
    await rm(profileRoot, { force: true, recursive: true });
  }
});
