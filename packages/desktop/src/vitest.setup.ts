/**
 * Vitest global setup for the jsdom environment.
 *
 * jsdom 28 implements the older Blob spec (slice/size/type only) and does not
 * expose Blob.prototype.text() or arrayBuffer(). FileReader IS available in
 * jsdom, so we polyfill text() with it so that `await file.text()` works the
 * same way it does in a real browser.
 */
if (!("text" in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, "text", {
    value(): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this as Blob);
      });
    },
    writable: true,
    configurable: true,
  });
}

if (!("arrayBuffer" in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    value(): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this as Blob);
      });
    },
    writable: true,
    configurable: true,
  });
}

const storage = new Map<string, string>();
const testLocalStorage: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key: string) => {
    storage.delete(key);
  },
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
};

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});

// Browser source uses the unqualified `localStorage` global. Node 24 and newer
// may expose a separate experimental implementation on globalThis, so every
// test gets the same deterministic in-memory browser storage object.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});

if (!("Worker" in globalThis)) {
  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  Object.defineProperty(globalThis, "Worker", {
    value: MockWorker,
    writable: true,
    configurable: true,
  });
}
