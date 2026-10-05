import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  LibraryCoreSha256,
  createLibraryCoreContentRangeStorageKeyV1,
  digestLibraryCoreMediaBlobBytesV1,
} from "@freed/shared/library-core";

const quote = "\ufeffExact\r\ne\u0301\0🦉";
const bytes = new TextEncoder().encode(quote);
const digest = digestLibraryCoreMediaBlobBytesV1(bytes);
const key = createLibraryCoreContentRangeStorageKeyV1(digest, 0, digest);
const generation = "a".repeat(64);
const source = { generationId: generation, projectionRevision: 0, transitionSequence: 0 };
const vaultDirectory = "freed-library-content-vault-v1";
const map = new LibraryCoreSha256();
map.update(new TextEncoder().encode("freed.library-core.v1/digest-records/content-range-map\0"));
map.update(new TextEncoder().encode(digest));
for (const number of [bytes.length, 1, 0, 0, bytes.length]) {
  const encoded = new Uint8Array(8);
  new DataView(encoded.buffer).setBigUint64(0, BigInt(number));
  map.update(encoded);
}
map.update(new TextEncoder().encode(digest));
const rootDigest = map.digestLowerHex();

async function openClient(context: BrowserContext): Promise<Page> {
  // Serve a blank same-origin document so production app startup cannot run.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:1435") return route.abort();
    if (url.pathname === "/annotation-test") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Annotation fixture</title>" });
    return route.fallback();
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://127.0.0.1:1435/annotation-test");
  await page.evaluate(async () => {
    const modulePath = "/src/lib/library-core-sqlite-client.ts";
    const { PwaLibraryCoreSqliteClient } = await import(modulePath);
    const client = new PwaLibraryCoreSqliteClient();
    (window as unknown as { fixtureClient: typeof client }).fixtureClient = client;
    await client.open();
  });
  return page;
}
async function read(page: Page, limitBytes = 65_536) {
  return page.evaluate(async ({ source, limitBytes }) => {
    const client = (window as unknown as { fixtureClient: import("../src/lib/library-core-sqlite-client").PwaLibraryCoreSqliteClient }).fixtureClient;
    const original = await client.query({ queryId: "item_annotations_v1", schemaVersion: 1, globalId: "item" });
    const result = await client.query({ queryId: "item_annotation_text_range_v1", schemaVersion: 1, globalId: "item", annotationIndex: 0, expectedSource: source as typeof original.source, offsetBytes: 0, limitBytes });
    return { original, result };
  }, { source, limitBytes });
}

test("shipping worker authenticates OPFS quotes after browser restart and refuses corrupt suffixes", async () => {
  const profile = await mkdtemp(resolve("../../.cache/annotation-browser-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: "block" });
    // Inject only fixture creation into the worker after its normal vault reconciliation.
    // The second browser opens the untouched shipping worker and the same OPFS files.
    await context.route("**/src/lib/library-core-sqlite-worker.ts*", async route => {
      const response = await route.fetch();
      const body = await response.text();
      const marker = "await nextContentVault.reconcile();";
      expect(body).toContain(marker);
      const sql = `INSERT INTO library_meta(singleton_id,library_id,schema_version,authority_epoch,source_revision,updated_at) VALUES(1,'${generation}',1,'epoch',0,0);
        INSERT INTO library_materialization_generation VALUES(1,'${generation}');
        INSERT INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at) VALUES('item','saved','article',0,0,'a','a','a',0,1,0,0);
        INSERT INTO library_blobs(content_digest,byte_length,storage_layout,chunk_bytes,chunk_count,range_count,range_granularity,range_index_root_digest,rendition_id,cloud_availability_commitment,media_type) VALUES('${digest}',${bytes.length},'authenticated_ranges',0,0,1,${bytes.length},'${rootDigest}','text','${digest}','text/plain');
        INSERT INTO library_content_ranges VALUES('${digest}',0,0,${bytes.length},'${digest}');
        INSERT INTO library_device_content_ranges VALUES('${digest}',0,${bytes.length},'${digest}','opfs','${key}',1);
        INSERT INTO library_feed_item_highlights VALUES('item',7,NULL,'${digest}','keep',1);`;
      const seed = `
        database.exec(${JSON.stringify(sql)});
        const fixtureRoot = await navigator.storage.getDirectory();
        const fixtureDirectory = await fixtureRoot.getDirectoryHandle(${JSON.stringify(vaultDirectory)}, {create:true});
        const fixtureFile = await fixtureDirectory.getFileHandle(${JSON.stringify(key)}, {create:true});
        const fixtureHandle = await fixtureFile.createSyncAccessHandle();
        fixtureHandle.write(new Uint8Array(${JSON.stringify([...bytes])})); fixtureHandle.flush(); fixtureHandle.close();
      `;
      await route.fulfill({ response, body: body.replace(marker, marker + seed) });
    });
    // Add the local-only route before the more specific fixture injection.
    // Playwright evaluates routes newest first; fall back keeps the injection active.
    const page = await openClient(context);
    const initial = await read(page);
    expect(initial.result.state).toBe("ready");
    expect(Buffer.from(initial.result.text!.bytesBase64, "base64")).toEqual(Buffer.from(bytes));
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: "block" });
    const restarted = await openClient(context);
    expect(await read(restarted)).toEqual(initial);
    await restarted.evaluate(async ({ key, vaultDirectory, bytes }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(vaultDirectory);
      const file = await directory.getFileHandle(key);
      const writer = await file.createWritable();
      const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1] ^= 1;
      await writer.write(corrupt); await writer.close();
    }, { key, vaultDirectory, bytes: [...bytes] });
    const corrupt = await read(restarted, 1);
    expect(corrupt.result.state).toBe("corrupt");
    expect(corrupt.result.text).toBeNull();
    expect(corrupt.original).toEqual(initial.original);
    await restarted.evaluate(async ({ key, vaultDirectory }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(vaultDirectory);
      await directory.removeEntry(key);
    }, { key, vaultDirectory });
    const absent = await read(restarted);
    expect(absent.result.state).toBe("unavailable");
    expect(absent.result.text).toBeNull();
    expect(absent.original).toEqual(initial.original);

  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const resident of [true, false]) {
  test(`annotation UI preserves original provenance through ${resident ? "resident" : "cold"} selection`, async ({ page }) => {
    const external: string[] = [];
    page.on("pageerror", error => console.error("Annotation fixture page error:", error.message));
    page.on("crash", () => console.error("Annotation fixture renderer crashed"));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:1435") { external.push(url.href); return route.abort(); }
      if (url.pathname === "/annotation-ui") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Annotation UI fixture</title>" });
      return route.fallback();
    });
    await page.goto("/annotation-ui");
    await page.evaluate(async resident => {
      const refreshPath = "/@react-refresh";
      const refresh = (await import(refreshPath)).default;
      refresh.injectIntoGlobalHook(window);
      (window as any).$RefreshReg$ = () => {};
      (window as any).$RefreshSig$ = () => (type: unknown) => type;
      (window as any).__vite_plugin_react_preamble_installed__ = true;
      const path = "/tests/fixtures/annotation-ui.tsx";
      (window as any).annotationUi = (await import(path)).mount(resident);
    }, resident);
    if (resident) await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeDisabled();
    else await expect(page.getByText("Loading item...", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).annotationUi.ready());
    await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Edit save", exact: true }).click();
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Original note");
    await page.getByLabel("Notes", { exact: true }).fill("Edited note");
    await page.getByRole("button", { name: "Update save", exact: true }).click();
    await expect(page.getByText("LOCAL_ADMISSION_SOURCE_STALE: reopen the item", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).annotationUi.submissions[0].annotationSnapshot.originals.source.projectionRevision)).toBe(2);
    await page.evaluate(() => (window as any).annotationUi.close());
    await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).annotationUi.event(false));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).annotationUi.event(true));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Original note");
    await page.evaluate(() => (window as any).annotationUi.close());
    await page.evaluate(() => (window as any).annotationUi.openWithoutSnapshot());
    await page.getByRole("button", { name: "Update save", exact: true }).click();
    await expect(page.getByText("Annotations are not ready for editing; reopen the item", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).annotationUi.submissions.length)).toBe(1);
    await page.evaluate(() => { (window as any).annotationUi.close(); (window as any).annotationUi.fail("corrupt"); });
    await expect(page.getByText("Saved annotation text is corrupt. Saved annotations have not changed.", { exact: true }).first()).toBeVisible();
    if (resident) await expect(page.getByRole("button", { name: "Edit save", exact: true })).toBeDisabled();
    expect(external).toEqual([]);
  });
}
