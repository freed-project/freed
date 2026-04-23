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
