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
