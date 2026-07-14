import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:pwa-register", () => ({
  registerSW: vi.fn(),
}));

import {
  quiescePwaServiceWorkerCacheWrites,
  resumePwaServiceWorkerCacheWrites,
} from "./pwa-updater";

function setServiceWorkerController(
  controller: { postMessage: (message: unknown, transfer: Transferable[]) => void } | null,
): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller },
  });
}

describe("PWA service worker factory reset", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("waits for the active service worker to acknowledge cache quiescence", async () => {
    const postMessage = vi.fn((message: unknown, transfer: Transferable[]) => {
      expect(message).toEqual({ type: "FREED_FACTORY_RESET_QUIESCE" });
      const responsePort = transfer[0] as MessagePort;
      responsePort.postMessage({ type: "FREED_FACTORY_RESET_QUIESCED" });
    });
    setServiceWorkerController({ postMessage });

    await quiescePwaServiceWorkerCacheWrites();

    expect(postMessage).toHaveBeenCalledOnce();
  });

  it("does not block reset when no service worker controls the page", async () => {
    setServiceWorkerController(null);

    await expect(quiescePwaServiceWorkerCacheWrites()).resolves.toBeUndefined();
  });

  it("waits for the active service worker to resume cache writes", async () => {
    const postMessage = vi.fn((message: unknown, transfer: Transferable[]) => {
      expect(message).toEqual({ type: "FREED_FACTORY_RESET_RESUME" });
      const responsePort = transfer[0] as MessagePort;
      responsePort.postMessage({ type: "FREED_FACTORY_RESET_RESUMED" });
    });
    setServiceWorkerController({ postMessage });

    await resumePwaServiceWorkerCacheWrites();

    expect(postMessage).toHaveBeenCalledOnce();
  });

  it("rejects deterministically when an older service worker cannot acknowledge", async () => {
    vi.useFakeTimers();
    setServiceWorkerController({ postMessage: vi.fn() });
    const quiesce = quiescePwaServiceWorkerCacheWrites();
    const rejection = expect(quiesce).rejects.toThrow(
      "The service worker did not stop cache writes within 10,000 ms.",
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});
