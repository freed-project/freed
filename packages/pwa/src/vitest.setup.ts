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
