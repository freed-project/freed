(() => {
  const QUIESCE_MESSAGE = "FREED_FACTORY_RESET_QUIESCE";
  const QUIESCED_MESSAGE = "FREED_FACTORY_RESET_QUIESCED";
  const RESUME_MESSAGE = "FREED_FACTORY_RESET_RESUME";
  const RESUMED_MESSAGE = "FREED_FACTORY_RESET_RESUMED";
  const originalPut = Cache.prototype.put;
  const drainWaiters = new Set();
  let quiesced = false;
  let activeCacheWrites = 0;

  function settleDrainWaiters() {
    if (activeCacheWrites !== 0) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  Cache.prototype.put = function guardedCachePut(request, response) {
    if (quiesced) return Promise.resolve();

    activeCacheWrites += 1;
    return Promise.resolve(originalPut.call(this, request, response)).finally(() => {
      activeCacheWrites -= 1;
      settleDrainWaiters();
    });
  };

  self.addEventListener("message", (event) => {
    const responsePort = event.ports?.[0];
    if (event.data?.type === RESUME_MESSAGE) {
      quiesced = false;
      responsePort?.postMessage({ type: RESUMED_MESSAGE });
      return;
    }
    if (event.data?.type !== QUIESCE_MESSAGE) return;

    quiesced = true;
    const drained = activeCacheWrites === 0
      ? Promise.resolve()
      : new Promise((resolve) => drainWaiters.add(resolve));

    event.waitUntil(drained);
    void drained.then(() => {
      responsePort?.postMessage({ type: QUIESCED_MESSAGE });
    });
  });
})();
