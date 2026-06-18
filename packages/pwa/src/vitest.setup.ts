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

if (
  typeof window.localStorage?.getItem !== "function" ||
  typeof window.localStorage?.clear !== "function"
) {
  const storage = new Map<string, string>();
  const localStorageMock: Storage = {
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
    value: localStorageMock,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
}

if (!("matchMedia" in window)) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      const maxWidthMatch = /\(max-width:\s*(\d+)px\)/.exec(query);
      const minWidthMatch = /\(min-width:\s*(\d+)px\)/.exec(query);
      const matches =
        (maxWidthMatch ? window.innerWidth <= Number(maxWidthMatch[1]) : true) &&
        (minWidthMatch ? window.innerWidth >= Number(minWidthMatch[1]) : true);

      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

if (!("ResizeObserver" in globalThis)) {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    value: MockResizeObserver,
    writable: true,
    configurable: true,
  });
}
