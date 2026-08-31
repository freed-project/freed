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
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
} from "@freed/shared";
import { pwaOpfsE2eBaseUrl } from "./opfs-e2e-settings";

interface BrowserLibraryCore {
  facetSummary(): Promise<{
    rssFeedCount: number;
    sampleAccountCount: number;
    sampleFeedCount: number;
    sampleItemCount: number;
    samplePersonCount: number;
    totalCount: number;
  }>;
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

async function readFacetSummary(page: Page) {
  return page.evaluate(async () => {
    const library = (window as unknown as Record<string, unknown>)
      .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
    return library.facetSummary();
  });
}

async function expectShowcaseSampleData(
  page: Page,
  baseline: Awaited<ReturnType<typeof readFacetSummary>>,
): Promise<void> {
  await expect
    .poll(() => readFacetSummary(page), { timeout: 90_000 })
    .toMatchObject({
      rssFeedCount: SAMPLE_SHOWCASE_FEED_COUNT,
      sampleAccountCount: SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
      sampleFeedCount: SAMPLE_SHOWCASE_FEED_COUNT,
      sampleItemCount: SAMPLE_SHOWCASE_ITEM_COUNT,
      samplePersonCount: SAMPLE_SHOWCASE_FRIEND_COUNT,
      totalCount: baseline.totalCount + SAMPLE_SHOWCASE_ITEM_COUNT,
    });
}

async function openDangerZone(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings" }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(
    page.getByRole("heading", { name: "Freed Settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Danger Zone" }).click();
  await expect(page.getByTestId("settings-mobile-section-title")).toHaveText(
    "Freed SettingsDanger Zone",
  );
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

async function launchPersistentLibraryContext(
  profileRoot: string,
): Promise<BrowserContext> {
  const iphone = devices["iPhone 14"];
  return webkit.launchPersistentContext(profileRoot, {
    userAgent: iphone.userAgent,
    viewport: iphone.viewport,
    screen: iphone.screen,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
    baseURL: pwaOpfsE2eBaseUrl,
    headless: true,
  });
}

async function openPersistentLibrary(profileRoot: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await launchPersistentLibraryContext(profileRoot);
  const page = context.pages()[0] ?? (await context.newPage());
  await openLibrary(page);
  return { context, page };
}

async function inspectAcceptedOpfsDatabase(
  profileRoot: string,
  corrupt: boolean,
): Promise<
  ReadonlyArray<{
    currentByte: number;
    fileName: string;
    originalByte: number;
    size: number;
    virtualPath: string;
  }>
> {
  const context = await launchPersistentLibraryContext(profileRoot);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/favicon.svg");
    return await page.evaluate(async (shouldCorrupt) => {
      const root = await navigator.storage.getDirectory();
      const pool = await root.getDirectoryHandle(
        "freed-library-core-sqlite-opfs-v1",
      );
      const opaque = await pool.getDirectoryHandle(".opaque");
      const decoder = new TextDecoder();
      const dataOffset = 4_096;
      const files = [];
      for await (const entry of opaque.values()) {
        if (entry.kind !== "file") continue;
        const handle = entry as FileSystemFileHandle;
        const file = await handle.getFile();
        if (file.size <= dataOffset) continue;
        const metadata = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const terminator = metadata.indexOf(0);
        const virtualPath = decoder.decode(
          metadata.subarray(0, terminator < 0 ? metadata.length : terminator),
        );
        if (!virtualPath.startsWith("/freed-library-core-v1.sqlite3")) {
          continue;
        }
        const original = new Uint8Array(
          await file.slice(dataOffset, dataOffset + 1).arrayBuffer(),
        );
        if (original.byteLength !== 1) {
          throw new Error("accepted OPFS SQLite payload is unavailable");
        }
        const currentByte = shouldCorrupt ? original[0]! ^ 0xff : original[0]!;
        if (shouldCorrupt) {
          const writable = await handle.createWritable({
            keepExistingData: true,
          });
          await writable.seek(dataOffset);
          await writable.write(Uint8Array.of(currentByte));
          await writable.close();
        }
        files.push({
          currentByte,
          fileName: entry.name,
          originalByte: original[0]!,
          size: file.size,
          virtualPath,
        });
      }
      if (
        !files.some(
          (file) => file.virtualPath === "/freed-library-core-v1.sqlite3",
        )
      ) {
        throw new Error("accepted OPFS SQLite payload file was not found");
      }
      return files.sort((left, right) =>
        left.virtualPath.localeCompare(right.virtualPath),
      );
    }, corrupt);
  } finally {
    await context.close();
  }
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

async function verifyDurableOpfsLibrary(profileRoot: string): Promise<void> {
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
  }
}

test("iPhone WebKit persists, clears, and rebuilds the local sample Library", async () => {
  test.setTimeout(240_000);
  const profileRoot = await mkdtemp(
    join(tmpdir(), "freed-pwa-sample-webkit-"),
  );
  let context: BrowserContext | null = null;

  try {
    let opened = await openPersistentLibrary(profileRoot);
    context = opened.context;
    const page = opened.page;
    await expectShowcaseSampleData(page, {
      ...(await readFacetSummary(page)),
      rssFeedCount: 0,
      totalCount: 0,
    });
    const populated = await readFacetSummary(page);
    const baseline = {
      ...populated,
      rssFeedCount: populated.rssFeedCount - SAMPLE_SHOWCASE_FEED_COUNT,
      totalCount: populated.totalCount - SAMPLE_SHOWCASE_ITEM_COUNT,
    };
    await openDangerZone(page);
    await expect(
      page.getByRole("button", { name: /Sample data populated/ }),
    ).toBeDisabled();

    await context.close();
    context = null;
    opened = await openPersistentLibrary(profileRoot);
    context = opened.context;
    const reopened = opened.page;
    await expectShowcaseSampleData(reopened, baseline);
    await openDangerZone(reopened);
    await expect(
      reopened.getByRole("button", { name: /Sample data populated/ }),
    ).toBeDisabled();

    await reopened
      .getByRole("button", { name: /Clear sample data/ })
      .first()
      .click();
    await reopened
      .locator(".theme-elevated-overlay")
      .getByRole("button", { name: "Clear sample data" })
      .click();
    await expect
      .poll(() => readFacetSummary(reopened), { timeout: 90_000 })
      .toMatchObject({
        rssFeedCount: baseline.rssFeedCount,
        sampleAccountCount: 0,
        sampleFeedCount: 0,
        sampleItemCount: 0,
        samplePersonCount: 0,
        totalCount: baseline.totalCount,
      });

    const repopulate = reopened.getByRole("button", {
      name: /Populate sample data Adds/,
    });
    await expect(repopulate).toBeEnabled();
    await repopulate.click();
    await expectShowcaseSampleData(reopened, baseline);
    await expect(
      reopened.getByRole("button", {
        name: /Sample data populated/,
      }),
    ).toBeDisabled();
    await context.close();
    context = null;
    await verifyDurableOpfsLibrary(profileRoot);
  } finally {
    await context?.close();
    await rm(profileRoot, { force: true, recursive: true });
  }
});

test("iPhone WebKit completes interrupted sample population after restart", async () => {
  test.setTimeout(180_000);
  const profileRoot = await mkdtemp(
    join(tmpdir(), "freed-pwa-interrupted-sample-webkit-"),
  );
  let context: BrowserContext | null = null;

  try {
    let opened = await openPersistentLibrary(profileRoot);
    context = opened.context;
    await expect(
      opened.page.getByText("Adding items: 30%", { exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    const interrupted = await readFacetSummary(opened.page);
    expect(interrupted).toMatchObject({
      rssFeedCount: SAMPLE_SHOWCASE_FEED_COUNT,
      sampleFeedCount: SAMPLE_SHOWCASE_FEED_COUNT,
      sampleItemCount: 0,
      samplePersonCount: 0,
    });

    await context.close();
    context = null;
    opened = await openPersistentLibrary(profileRoot);
    context = opened.context;
    await expectShowcaseSampleData(opened.page, {
      rssFeedCount: 0,
      sampleAccountCount: 0,
      sampleFeedCount: 0,
      sampleItemCount: 0,
      samplePersonCount: 0,
      totalCount: 0,
    });
  } finally {
    await context?.close();
    await rm(profileRoot, { force: true, recursive: true });
  }
});

test("iPhone WebKit rejects a corrupted accepted OPFS SQLite generation", async () => {
  test.setTimeout(180_000);
  const profileRoot = await mkdtemp(
    join(tmpdir(), "freed-pwa-corrupt-sqlite-webkit-"),
  );
  let context: BrowserContext | null = null;

  try {
    const opened = await openPersistentLibrary(profileRoot);
    context = opened.context;
    await expectShowcaseSampleData(opened.page, {
      ...(await readFacetSummary(opened.page)),
      rssFeedCount: 0,
      totalCount: 0,
    });
    expect(await setContactSyncError(opened.page)).toMatchObject({
      changed: true,
    });
    await context.close();
    context = null;

    const corrupted = await inspectAcceptedOpfsDatabase(profileRoot, true);
    expect(corrupted.length).toBeGreaterThan(0);
    expect(corrupted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          virtualPath: "/freed-library-core-v1.sqlite3",
        }),
      ]),
    );
    for (const file of corrupted) {
      expect(file.currentByte).not.toBe(file.originalByte);
      expect(file.size).toBeGreaterThan(4_096);
    }
    const corruptedReadback = await inspectAcceptedOpfsDatabase(
      profileRoot,
      false,
    );
    expect(corruptedReadback).toEqual(
      corrupted.map((file) => ({
        ...file,
        originalByte: file.currentByte,
      })),
    );

    context = await launchPersistentLibraryContext(profileRoot);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/");
    await acceptLegalGate(page);
    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, unknown>)
        .__FREED_STORE__ as
        | { getState(): { error: string | null; isInitialized: boolean } }
        | undefined;
      const state = store?.getState();
      return state?.isInitialized === true || typeof state?.error === "string";
    });
    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>)
        .__FREED_STORE__ as
        | { getState(): { error: string | null; isInitialized: boolean } }
        | undefined;
      return store?.getState();
    });
    expect(state).toMatchObject({
      isInitialized: false,
    });
    expect(state?.error).toMatch(/PWA Library SQLite could not/);
    await expect(
      page.getByRole("heading", { name: "Freed hit a fatal error" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/PWA Library SQLite could not/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Replace local Library" }),
    ).toBeVisible();
    await context.close();
    context = null;

    const preserved = await inspectAcceptedOpfsDatabase(profileRoot, false);
    expect(preserved).toEqual(
      corrupted.map((file) => ({
        ...file,
        originalByte: file.currentByte,
      })),
    );
  } finally {
    await context?.close();
    await rm(profileRoot, { force: true, recursive: true });
  }
});
