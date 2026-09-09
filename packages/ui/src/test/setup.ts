// jsdom does not implement layout observation. Component interaction tests
// use this inert observer; browser tests own real resize and geometry behavior.
if (!("ResizeObserver" in globalThis)) {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}
