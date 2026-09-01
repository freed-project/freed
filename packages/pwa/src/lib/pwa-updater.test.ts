import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordBugReportEvent: vi.fn(),
  registerSW: vi.fn(() => vi.fn()),
}));

vi.mock("virtual:pwa-register", () => ({
  registerSW: mocks.registerSW,
}));

vi.mock("@freed/ui/lib/bug-report", () => ({
  recordBugReportEvent: mocks.recordBugReportEvent,
}));

class MutableServiceWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
}

type MutableRegistration = EventTarget & {
  installing: MutableServiceWorker | null;
  waiting: ServiceWorker | null;
  update: ReturnType<typeof vi.fn>;
};

function createRegistration(): MutableRegistration {
  const registration = new EventTarget() as MutableRegistration;
  registration.installing = null;
  registration.waiting = null;
  registration.update = vi.fn();
  return registration;
}

function installServiceWorkerRegistration(registration: MutableRegistration) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
}

async function loadUpdateChecker() {
  const { checkForPwaUpdate } = await import("./pwa-updater");
  return checkForPwaUpdate;
}

describe("checkForPwaUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.recordBugReportEvent.mockReset();
    mocks.registerSW.mockClear();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it("finishes as soon as a completed browser check finds no update", async () => {
    const registration = createRegistration();
    const removeListener = vi.spyOn(registration, "removeEventListener");
    registration.update.mockResolvedValue(registration);
    installServiceWorkerRegistration(registration);
    const checkForPwaUpdate = await loadUpdateChecker();

    let settled = false;
    const result = checkForPwaUpdate().then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    await expect(result).resolves.toBeNull();
    expect(removeListener).toHaveBeenCalledWith(
      "updatefound",
      expect.any(Function),
    );
  });

  it("reports a worker that is already waiting", async () => {
    const registration = createRegistration();
    registration.waiting = new MutableServiceWorker() as ServiceWorker;
    installServiceWorkerRegistration(registration);
    const checkForPwaUpdate = await loadUpdateChecker();

    await expect(checkForPwaUpdate()).resolves.toBe("new version");
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("reports an update after its installing worker reaches installed", async () => {
    const registration = createRegistration();
    const worker = new MutableServiceWorker();
    const removeWorkerListener = vi.spyOn(worker, "removeEventListener");
    registration.update.mockImplementation(async () => {
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
      return registration;
    });
    installServiceWorkerRegistration(registration);
    const checkForPwaUpdate = await loadUpdateChecker();

    const result = checkForPwaUpdate();
    await vi.advanceTimersByTimeAsync(0);
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));

    await expect(result).resolves.toBe("new version");
    expect(removeWorkerListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
  });

  it("finishes safely when the browser rejects the update check", async () => {
    const registration = createRegistration();
    registration.update.mockRejectedValue(new Error("offline"));
    installServiceWorkerRegistration(registration);
    const checkForPwaUpdate = await loadUpdateChecker();

    await expect(checkForPwaUpdate()).resolves.toBeNull();
    expect(mocks.recordBugReportEvent).toHaveBeenCalledWith(
      "pwa:updater",
      "warn",
      "Manual update check failed",
    );
  });

  it("keeps the deadline only for a browser check that never settles", async () => {
    const registration = createRegistration();
    registration.update.mockReturnValue(new Promise(() => {}));
    installServiceWorkerRegistration(registration);
    const checkForPwaUpdate = await loadUpdateChecker();

    let settled = false;
    const result = checkForPwaUpdate().then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(result).resolves.toBeNull();
  });
});
