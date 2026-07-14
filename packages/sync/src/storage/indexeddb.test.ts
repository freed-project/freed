import { describe, expect, it } from "vitest";
import { IndexedDBStorage } from "./indexeddb.js";

type RequestHandler<T> =
  ((this: IDBRequest<T>, event: Event) => unknown) | null;

interface MutableRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: RequestHandler<T>;
  onerror: RequestHandler<T>;
  onupgradeneeded?:
    ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
}

function requestAsIdb<T>(request: MutableRequest<T>): IDBRequest<T> {
  return request as unknown as IDBRequest<T>;
}

class FakeTransaction {
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  error: DOMException | null = null;
  requestSuccessCount = 0;
  private pendingRequests = 0;
  private completed = false;

  constructor(
    private readonly records: Map<IDBValidKey, unknown>,
    private readonly autoComplete: boolean,
  ) {}

  objectStore(): IDBObjectStore {
    const enqueue = <T>(operation: () => T): IDBRequest<T> => {
      const request: MutableRequest<T> = {
        result: undefined as T,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      this.pendingRequests += 1;
      queueMicrotask(() => {
        request.result = operation();
        this.requestSuccessCount += 1;
        request.onsuccess?.call(requestAsIdb(request), {} as Event);
        this.pendingRequests -= 1;
        if (this.autoComplete && this.pendingRequests === 0) {
          queueMicrotask(() => this.complete());
        }
      });
      return requestAsIdb(request);
    };

    return {
      get: (key: IDBValidKey) => enqueue(() => this.records.get(key)),
      count: (key?: IDBValidKey | IDBKeyRange) =>
        enqueue(() =>
          key !== undefined && this.records.has(key as IDBValidKey) ? 1 : 0,
        ),
      put: (value: unknown, key?: IDBValidKey) =>
        enqueue(() => {
          if (key === undefined)
            throw new Error("Fake IndexedDB requires an explicit key");
          this.records.set(key, value);
          return key;
        }),
      delete: (key: IDBValidKey | IDBKeyRange) =>
        enqueue(() => {
          this.records.delete(key as IDBValidKey);
        }),
    } as unknown as IDBObjectStore;
  }

  complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
  }
}

class FakeDatabase {
  readonly records = new Map<IDBValidKey, unknown>();
  readonly transactions: FakeTransaction[] = [];
  autoCompleteTransactions = true;

  transaction(): IDBTransaction {
    const transaction = new FakeTransaction(
      this.records,
      this.autoCompleteTransactions,
    );
    this.transactions.push(transaction);
    return transaction as unknown as IDBTransaction;
  }
}

function createStorage(database = new FakeDatabase()): {
  database: FakeDatabase;
  storage: IndexedDBStorage;
} {
  const openRequest: MutableRequest<IDBDatabase> = {
    result: database as unknown as IDBDatabase,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  const factory = {
    open: () => {
      queueMicrotask(() => {
        const event = {
          target: openRequest,
        } as unknown as IDBVersionChangeEvent;
        openRequest.onsuccess?.call(
          requestAsIdb(openRequest),
          event as unknown as Event,
        );
      });
      return openRequest as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { database, storage: new IndexedDBStorage(factory) };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("IndexedDBStorage", () => {
  it("returns null only when the document key is absent", async () => {
    const { database, storage } = createStorage();

    await expect(storage.load()).resolves.toBeNull();
    expect(database.records.get("feed:installation-generation")).toBe(0);
  });

  it("migrates a legacy document without changing its bytes", async () => {
    const { database, storage } = createStorage();
    const legacy = new Uint8Array([4, 5, 6]).buffer;
    database.records.set("feed", legacy);

    await expect(storage.load()).resolves.toEqual(new Uint8Array([4, 5, 6]));

    expect(database.records.get("feed")).toBe(legacy);
    expect(database.records.get("feed:installation-generation")).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["String", "not binary"],
  ])("rejects a stored %s value as corruption", async (storedType, value) => {
    const { database, storage } = createStorage();
    database.records.set("feed", value);

    await expect(storage.load()).rejects.toThrow(
      `Stored Automerge data is corrupt: expected binary data, found ${storedType}`,
    );
  });

  it("stores only the bytes visible through a Uint8Array view", async () => {
    const { database, storage } = createStorage();
    const source = new Uint8Array([99, 1, 2, 3, 88]);

    await storage.save(source.subarray(1, 4));

    const stored = database.records.get("feed");
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(stored as ArrayBuffer))).toEqual([
      1, 2, 3,
    ]);
    expect((stored as ArrayBuffer).byteLength).toBe(3);
  });

  it("rejects an old worker save after reset advances the document generation", async () => {
    const database = new FakeDatabase();
    const oldWorker = createStorage(database).storage;
    const resetStorage = createStorage(database).storage;
    await oldWorker.save(new Uint8Array([1, 2, 3]));

    await resetStorage.clear();
    await expect(oldWorker.save(new Uint8Array([9, 9, 9]))).rejects.toThrow(
      "IndexedDB document generation is stale: expected 0, current 1",
    );

    expect(database.records.has("feed")).toBe(false);
    expect(database.records.get("feed:installation-generation")).toBe(1);
  });

  it("allows the current generation to persist after clear", async () => {
    const database = new FakeDatabase();
    const storage = createStorage(database).storage;
    await storage.save(new Uint8Array([1]));
    await storage.clear();

    await storage.save(new Uint8Array([7, 8]));

    await expect(storage.load()).resolves.toEqual(new Uint8Array([7, 8]));
    expect(database.records.get("feed:installation-generation")).toBe(1);
  });

  it("rejects an old worker clear without deleting the current generation", async () => {
    const database = new FakeDatabase();
    const oldWorker = createStorage(database).storage;
    const resetStorage = createStorage(database).storage;
    const currentWorker = createStorage(database).storage;
    await oldWorker.save(new Uint8Array([1]));
    await resetStorage.clear();
    await currentWorker.save(new Uint8Array([7, 8]));

    await expect(oldWorker.clear()).rejects.toThrow(
      "IndexedDB document generation is stale: expected 0, current 1",
    );

    await expect(currentWorker.load()).resolves.toEqual(new Uint8Array([7, 8]));
    expect(database.records.get("feed:installation-generation")).toBe(1);
  });

  it("retains the cleared generation across a crash and reload", async () => {
    const database = new FakeDatabase();
    const oldWorker = createStorage(database).storage;
    await oldWorker.save(new Uint8Array([1, 2, 3]));

    await createStorage(database).storage.clear();

    const reloadedWorker = createStorage(database).storage;
    await expect(reloadedWorker.load()).resolves.toBeNull();
    await reloadedWorker.save(new Uint8Array([4, 5, 6]));
    await expect(reloadedWorker.load()).resolves.toEqual(
      new Uint8Array([4, 5, 6]),
    );
    await expect(oldWorker.save(new Uint8Array([9]))).rejects.toThrow(
      "IndexedDB document generation is stale: expected 0, current 1",
    );
    expect(database.records.get("feed:installation-generation")).toBe(1);
  });

  it("does not resolve save until its readwrite transaction completes", async () => {
    const database = new FakeDatabase();
    database.autoCompleteTransactions = false;
    const { storage } = createStorage(database);
    let resolved = false;

    const saving = storage.save(new Uint8Array([1, 2, 3])).then(() => {
      resolved = true;
    });
    await flushMicrotasks();

    const transaction = database.transactions.at(-1);
    expect(transaction?.requestSuccessCount).toBe(3);
    expect(resolved).toBe(false);

    transaction?.complete();
    await saving;
    expect(resolved).toBe(true);
  });

  it("does not resolve clear until its readwrite transaction completes", async () => {
    const database = new FakeDatabase();
    database.records.set("feed", new Uint8Array([1]).buffer);
    database.autoCompleteTransactions = false;
    const { storage } = createStorage(database);
    let resolved = false;

    const clearing = storage.clear().then(() => {
      resolved = true;
    });
    await flushMicrotasks();

    const transaction = database.transactions.at(-1);
    expect(transaction?.requestSuccessCount).toBe(3);
    expect(resolved).toBe(false);

    transaction?.complete();
    await clearing;
    expect(resolved).toBe(true);
    expect(database.records.has("feed")).toBe(false);
  });
});
