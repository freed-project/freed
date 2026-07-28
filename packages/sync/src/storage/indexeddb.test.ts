import { describe, expect, it } from "vitest";
import {
  IndexedDBStorage,
  StaleStorageRevisionError,
} from "./indexeddb.js";

type RequestHandler<T> =
  ((this: IDBRequest<T>, event: Event) => unknown) | null;

interface MutableRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: RequestHandler<T>;
  onerror: RequestHandler<T>;
  onblocked?: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
  onupgradeneeded?:
    ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
  transaction?: IDBTransaction | null;
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
  private readonly workingRecords: Map<IDBValidKey, unknown>;
  private pendingRequests = 0;
  private completed = false;
  private aborted = false;

  constructor(
    private readonly records: Map<IDBValidKey, unknown>,
    private readonly mode: IDBTransactionMode,
    private readonly autoComplete: boolean,
    private readonly afterComplete?: () => void,
    private readonly afterAbort?: () => void,
  ) {
    this.workingRecords = new Map(records);
  }

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
        if (this.aborted) return;
        try {
          request.result = operation();
          this.requestSuccessCount += 1;
          request.onsuccess?.call(requestAsIdb(request), {} as Event);
        } catch (error) {
          request.error = new DOMException(String(error), "UnknownError");
          request.onerror?.call(requestAsIdb(request), {} as Event);
          this.error = request.error;
          this.abort();
          return;
        } finally {
          this.pendingRequests -= 1;
        }
        if (this.autoComplete && this.pendingRequests === 0) {
          queueMicrotask(() => this.complete());
        }
      });
      return requestAsIdb(request);
    };

    return {
      get: (key: IDBValidKey) =>
        enqueue(() => this.workingRecords.get(key)),
      count: (key?: IDBValidKey | IDBKeyRange) =>
        enqueue(() =>
          key !== undefined &&
          this.workingRecords.has(key as IDBValidKey)
            ? 1
            : 0,
        ),
      put: (value: unknown, key?: IDBValidKey) =>
        enqueue(() => {
          if (this.mode === "readonly") {
            throw new Error("Readonly transaction cannot write");
          }
          if (key === undefined) {
            throw new Error("Fake IndexedDB requires an explicit key");
          }
          this.workingRecords.set(key, value);
          return key;
        }),
      delete: (key: IDBValidKey | IDBKeyRange) =>
        enqueue(() => {
          if (this.mode === "readonly") {
            throw new Error("Readonly transaction cannot delete");
          }
          this.workingRecords.delete(key as IDBValidKey);
        }),
    } as unknown as IDBObjectStore;
  }

  abort(): void {
    if (this.completed || this.aborted) return;
    this.aborted = true;
    this.onabort?.call(this as unknown as IDBTransaction, {} as Event);
    this.afterAbort?.();
  }

  complete(): void {
    if (this.completed || this.aborted) return;
    this.completed = true;
    if (this.mode !== "readonly") {
      this.records.clear();
      for (const [key, value] of this.workingRecords) {
        this.records.set(key, value);
      }
    }
    this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
    this.afterComplete?.();
  }
}

class FakeDatabase {
  readonly records = new Map<IDBValidKey, unknown>();
  readonly transactions: FakeTransaction[] = [];
  autoCompleteTransactions = true;
  closeCount = 0;
  onversionchange:
    ((this: IDBDatabase, event: IDBVersionChangeEvent) => unknown) | null =
    null;
  storeExists: boolean;
  upgradeTransaction: FakeTransaction | null = null;

  constructor(
    public version: number,
    records: Iterable<readonly [IDBValidKey, unknown]> = [],
  ) {
    this.storeExists = version > 0;
    for (const [key, value] of records) this.records.set(key, value);
  }

  get objectStoreNames(): DOMStringList {
    return {
      contains: (name: string) =>
        name === "automerge" && this.storeExists,
    } as DOMStringList;
  }

  createObjectStore(): IDBObjectStore {
    this.storeExists = true;
    if (!this.upgradeTransaction) {
      throw new Error("Object store creation requires an upgrade transaction");
    }
    return this.upgradeTransaction.objectStore();
  }

  transaction(
    _storeNames?: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): IDBTransaction {
    const transaction = new FakeTransaction(
      this.records,
      mode,
      this.autoCompleteTransactions,
    );
    this.transactions.push(transaction);
    return transaction as unknown as IDBTransaction;
  }

  close(): void {
    this.closeCount += 1;
  }
}

class FakeIndexedDBFactory {
  readonly openVersions: number[] = [];
  blocked = false;

  constructor(readonly database: FakeDatabase) {}

  open(_name: string, version?: number): IDBOpenDBRequest {
    const requestedVersion = version ?? this.database.version;
    this.openVersions.push(requestedVersion);
    const request: MutableRequest<IDBDatabase> = {
      result: this.database as unknown as IDBDatabase,
      error: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      onupgradeneeded: null,
      transaction: null,
    };

    queueMicrotask(() => {
      if (this.blocked) {
        request.onblocked?.call(
          request as unknown as IDBOpenDBRequest,
          {} as Event,
        );
        return;
      }

      if (this.database.version < requestedVersion) {
        const oldVersion = this.database.version;
        const upgrade = new FakeTransaction(
          this.database.records,
          "versionchange",
          true,
          () => {
            this.database.version = requestedVersion;
            this.database.upgradeTransaction = null;
            request.onsuccess?.call(
              requestAsIdb(request),
              {} as Event,
            );
          },
          () => {
            request.error = new DOMException(
              "Versionchange transaction aborted",
              "AbortError",
            );
            request.onerror?.call(requestAsIdb(request), {} as Event);
          },
        );
        this.database.upgradeTransaction = upgrade;
        request.transaction = upgrade as unknown as IDBTransaction;
        request.onupgradeneeded?.call(
          request as unknown as IDBOpenDBRequest,
          {
            oldVersion,
            newVersion: requestedVersion,
            target: request,
          } as unknown as IDBVersionChangeEvent,
        );
        return;
      }

      request.onsuccess?.call(requestAsIdb(request), {} as Event);
    });

    return request as unknown as IDBOpenDBRequest;
  }
}

function createStorage(
  database = new FakeDatabase(2, [
    ["feed:installation-generation", 0],
    ["feed:save-revision", 0],
  ]),
): {
  database: FakeDatabase;
  factory: FakeIndexedDBFactory;
  storage: IndexedDBStorage;
} {
  const factory = new FakeIndexedDBFactory(database);
  return {
    database,
    factory,
    storage: new IndexedDBStorage(factory as unknown as IDBFactory),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("IndexedDBStorage", () => {
  it("creates v2 metadata and returns an exact empty revision", async () => {
    const { database, factory, storage } = createStorage(
      new FakeDatabase(0),
    );

    await expect(storage.load()).resolves.toEqual({
      data: null,
      revision: { generation: 0, saveRevision: 0 },
    });
    expect(factory.openVersions).toEqual([2]);
    expect(database.records.get("feed:installation-generation")).toBe(0);
    expect(database.records.get("feed:save-revision")).toBe(0);
  });

  it("upgrades v1 bytes exactly and starts save revision zero", async () => {
    const legacy = new Uint8Array([4, 5, 6]).buffer;
    const { database, storage } = createStorage(
      new FakeDatabase(1, [
        ["feed", legacy],
        ["feed:installation-generation", 7],
      ]),
    );

    await expect(storage.load()).resolves.toEqual({
      data: new Uint8Array([4, 5, 6]),
      revision: { generation: 7, saveRevision: 0 },
    });
    expect(database.records.get("feed")).toBe(legacy);
    expect(database.records.get("feed:save-revision")).toBe(0);
  });

  it("fails closed when another connection blocks the v2 upgrade", async () => {
    const database = new FakeDatabase(1, [
      ["feed", new Uint8Array([1]).buffer],
    ]);
    const { factory, storage } = createStorage(database);
    factory.blocked = true;

    await expect(storage.load()).rejects.toThrow(
      "IndexedDB v2 upgrade is blocked by another open Freed connection",
    );
  });

  it("closes its connection when a later database version arrives", async () => {
    const { database, storage } = createStorage();
    await storage.load();

    database.onversionchange?.call(
      database as unknown as IDBDatabase,
      {} as IDBVersionChangeEvent,
    );

    expect(database.closeCount).toBe(1);
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

  it("rejects a partial record with a save revision but no document bytes", async () => {
    const { storage } = createStorage(
      new FakeDatabase(2, [
        ["feed:installation-generation", 0],
        ["feed:save-revision", 1],
      ]),
    );

    await expect(storage.load()).rejects.toThrow(
      "Stored Automerge data is corrupt: save revision exists without document bytes",
    );
  });

  it("saves only the view bytes and returns the committed next revision", async () => {
    const { database, storage } = createStorage();
    const source = new Uint8Array([99, 1, 2, 3, 88]);

    await expect(
      storage.save(source.subarray(1, 4), {
        generation: 0,
        saveRevision: 0,
      }),
    ).resolves.toEqual({ generation: 0, saveRevision: 1 });

    const stored = database.records.get("feed");
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(stored as ArrayBuffer))).toEqual([
      1, 2, 3,
    ]);
    expect((stored as ArrayBuffer).byteLength).toBe(3);
    expect(database.records.get("feed:save-revision")).toBe(1);
  });

  it("rejects a stale save revision without replacing newer bytes", async () => {
    const database = new FakeDatabase(2, [
      ["feed:installation-generation", 0],
      ["feed:save-revision", 0],
    ]);
    const first = createStorage(database).storage;
    const stale = createStorage(database).storage;
    const firstLoad = await first.load();
    const staleLoad = await stale.load();
    await first.save(new Uint8Array([1]), firstLoad.revision);

    const saving = stale.save(new Uint8Array([9]), staleLoad.revision);

    await expect(saving).rejects.toBeInstanceOf(
      StaleStorageRevisionError,
    );
    await expect(saving).rejects.toThrow(
      "IndexedDB document revision is stale: expected 0:0, current 0:1",
    );
    expect(
      Array.from(
        new Uint8Array(database.records.get("feed") as ArrayBuffer),
      ),
    ).toEqual([1]);
  });

  it("clears bytes, advances generation, resets revision, and fences old writers", async () => {
    const database = new FakeDatabase(2, [
      ["feed", new Uint8Array([1]).buffer],
      ["feed:installation-generation", 3],
      ["feed:save-revision", 8],
    ]);
    const resetter = createStorage(database).storage;
    const oldWriter = createStorage(database).storage;
    const resetRevision = (await resetter.load()).revision;
    const oldRevision = (await oldWriter.load()).revision;

    await expect(resetter.clear(resetRevision)).resolves.toEqual({
      generation: 4,
      saveRevision: 0,
    });
    await expect(
      oldWriter.save(new Uint8Array([9]), oldRevision),
    ).rejects.toBeInstanceOf(StaleStorageRevisionError);

    expect(database.records.has("feed")).toBe(false);
    expect(database.records.get("feed:installation-generation")).toBe(4);
    expect(database.records.get("feed:save-revision")).toBe(0);
  });

  it("resolves writes only after the atomic transaction commits", async () => {
    const database = new FakeDatabase(2, [
      ["feed:installation-generation", 0],
      ["feed:save-revision", 0],
    ]);
    database.autoCompleteTransactions = false;
    const { storage } = createStorage(database);
    let resolved = false;

    const saving = storage
      .save(new Uint8Array([1, 2, 3]), {
        generation: 0,
        saveRevision: 0,
      })
      .then(() => {
        resolved = true;
      });
    await flushMicrotasks();

    const transaction = database.transactions.at(-1);
    expect(transaction?.requestSuccessCount).toBe(4);
    expect(resolved).toBe(false);
    expect(database.records.has("feed")).toBe(false);

    transaction?.complete();
    await saving;
    expect(resolved).toBe(true);
    expect(database.records.has("feed")).toBe(true);
  });
});
