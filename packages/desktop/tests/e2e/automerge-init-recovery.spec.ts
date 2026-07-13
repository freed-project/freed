import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const DB_NAME = "freed";
const STORE_NAME = "automerge";
const DOC_KEY = "feed";
const CORRUPT_DOC_RECOVERY_KEY = "feed-corrupt-recovery";

async function replaceStoredDocument(
  page: Page,
  bytes: number[],
): Promise<void> {
  await page.evaluate(
    async ({ dbName, storeName, docKey, recoveryKey, storedBytes }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        store.put(new Uint8Array(storedBytes).buffer, docKey);
        store.delete(recoveryKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    },
    {
      dbName: DB_NAME,
      storeName: STORE_NAME,
      docKey: DOC_KEY,
      recoveryKey: CORRUPT_DOC_RECOVERY_KEY,
      storedBytes: bytes,
    },
  );
}

async function readStoredDocument(
  page: Page,
  key: string,
): Promise<number[]> {
  return page.evaluate(
    async ({ dbName, storeName, storageKey }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const value = await new Promise<ArrayBuffer | Uint8Array | undefined>(
        (resolve, reject) => {
          const transaction = db.transaction(storeName, "readonly");
          const request = transaction.objectStore(storeName).get(storageKey);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        },
      );
      db.close();
      if (value instanceof Uint8Array) return Array.from(value);
      if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
      return [];
    },
    {
      dbName: DB_NAME,
      storeName: STORE_NAME,
      storageKey: key,
    },
  );
}

test("preserves a corrupt local document before startup recovery", async ({
  app,
  page,
}) => {
  const corruptBytes = [222, 173, 190, 239, 1, 2, 3, 4];

  await app.goto();
  await app.waitForReady();
  await replaceStoredDocument(page, corruptBytes);

  await page.reload();
  await app.waitForReady(30_000);

  await expect(page.locator("main")).toBeVisible();
  await expect
    .poll(() => readStoredDocument(page, CORRUPT_DOC_RECOVERY_KEY))
    .toEqual(corruptBytes);

  const recoveredLiveDocument = await readStoredDocument(page, DOC_KEY);
  expect(recoveredLiveDocument).not.toEqual(corruptBytes);
  expect(recoveredLiveDocument.length).toBeGreaterThan(0);
});
