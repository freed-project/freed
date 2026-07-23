import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      eventName: string,
      listener: (event: { payload: unknown }) => void,
    ) => {
      mocks.listeners.set(eventName, listener);
      return () => mocks.listeners.delete(eventName);
    },
  ),
}));
vi.mock("./user-agent", () => ({
  clearPlatformUA: vi.fn(),
  selectPlatformUA: vi.fn(() => "test-user-agent"),
}));

import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";
import {
  checkFbAuth,
  disconnectFbForFactoryReset,
  storeFbAuthState,
} from "./fb-auth";
import {
  quiesceDesktopProviderAuthForFactoryReset,
  registerDesktopProviderAuthQuiesceHandler,
  resetDesktopProviderAuthLifecycleForTests,
  runDesktopProviderAuthRequest,
} from "./provider-auth-lifecycle";
import {
  desktopXLoginResetController,
  registerDesktopXLoginResetHandler,
} from "./x-login-reset-controller";
import { storeCookies } from "./x-auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resetOperations(clearProviderDataAndConnections: () => Promise<void>) {
  return {
    quiesceLocalWriters: [quiesceDesktopProviderAuthForFactoryReset],
    clearDeviceStores: () => [true],
    clearLocalSettings: [],
    clearLocalData: [],
    clearProviderDataAndConnections,
    clearDocument: async () => undefined,
  };
}

describe("provider auth factory reset drain", () => {
  beforeEach(() => {
    resetDesktopProviderAuthLifecycleForTests();
    resetFactoryResetStateForTests();
    window.localStorage.clear();
    mocks.invoke.mockReset();
    mocks.listeners.clear();
  });

  afterEach(() => {
    resetDesktopProviderAuthLifecycleForTests();
    resetFactoryResetStateForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the normal Facebook auth timeout bounded when native IPC stalls", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockImplementation(() => new Promise(() => undefined));

    const auth = checkFbAuth();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(auth).resolves.toBe(false);
  });

  it("fails reset before provider cleanup when an auth quiesce handler rejects", async () => {
    const providerCleanup = vi.fn(async () => undefined);
    registerDesktopProviderAuthQuiesceHandler(async () => {
      throw new Error("login window did not close");
    });

    await expect(
      runFactoryResetOperations(resetOperations(providerCleanup)),
    ).rejects.toThrow("login window did not close");

    expect(providerCleanup).not.toHaveBeenCalled();
  });

  it("tracks and observes a late async handler after provider auth is closed", async () => {
    const finishLateHandler = deferred<void>();
    const providerCleanup = vi.fn(async () => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await quiesceDesktopProviderAuthForFactoryReset();
    registerDesktopProviderAuthQuiesceHandler(async () => {
      await finishLateHandler.promise;
      throw new Error("late login cleanup failed");
    });

    const reset = runFactoryResetOperations(resetOperations(providerCleanup));
    await Promise.resolve();
    expect(providerCleanup).not.toHaveBeenCalled();

    finishLateHandler.resolve(undefined);
    await reset;

    expect(providerCleanup).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "[provider-auth] late reset quiesce handler failed",
      expect.objectContaining({ message: "late login cleanup failed" }),
    );
  });

  it("waits for an issued Facebook auth request and rejects its late login result", async () => {
    const authInvoke = deferred<void>();
    const events: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      events.push(command);
      if (command === "fb_check_auth") return authInvoke.promise;
      return Promise.resolve();
    });
    let lateAuthPersisted = false;
    const runSync = vi.fn(async () => undefined);

    const auth = checkFbAuth();
    const authConsumer = auth.then(async (loggedIn) => {
      lateAuthPersisted = loggedIn;
      storeFbAuthState({
        isAuthenticated: loggedIn,
        lastCheckedAt: Date.now(),
      });
      if (loggedIn) await runSync();
    });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("fb_check_auth"),
    );

    const reset = runFactoryResetOperations(
      resetOperations(async () => {
        events.push("provider-cleanup");
        await disconnectFbForFactoryReset();
      }),
    );
    await Promise.resolve();
    expect(events).not.toContain("provider-cleanup");

    mocks.listeners.get("fb-auth-result")?.({ payload: { loggedIn: true } });
    authInvoke.resolve();

    await expect(authConsumer).rejects.toThrow("Factory reset is in progress");
    await reset;

    expect(events.indexOf("fb_check_auth")).toBeLessThan(
      events.indexOf("provider-cleanup"),
    );
    expect(lateAuthPersisted).toBe(false);
    expect(runSync).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem("fb_auth_state")!),
    ).toMatchObject({
      isAuthenticated: false,
    });
  });

  it("closes an opening X login window once and rejects late cookies before cleanup", async () => {
    const openInvoke = deferred<void>();
    const cookieInvoke = deferred<{
      status: "ready";
      ct0: string;
      auth_token: string;
    }>();
    const events: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      events.push(command);
      if (command === "open_x_login_window") return openInvoke.promise;
      if (command === "check_x_login_cookies") return cookieInvoke.promise;
      return Promise.resolve();
    });
    registerDesktopXLoginResetHandler();

    desktopXLoginResetController.markOpening();
    const opening = runDesktopProviderAuthRequest(async () => {
      await mocks.invoke("open_x_login_window");
    });
    desktopXLoginResetController.trackOpening(opening);
    const cookieCheck = runDesktopProviderAuthRequest(
      async () =>
        mocks.invoke("check_x_login_cookies") as Promise<{
          status: "ready";
          ct0: string;
          auth_token: string;
        }>,
    );
    const cookieConsumer = cookieCheck.then((result) => {
      storeCookies({ ct0: result.ct0, authToken: result.auth_token });
    });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("check_x_login_cookies"),
    );

    const reset = runFactoryResetOperations(
      resetOperations(async () => {
        events.push("provider-cleanup");
      }),
    );
    await Promise.resolve();
    expect(events).not.toContain("close_x_login_window");
    expect(events).not.toContain("provider-cleanup");

    openInvoke.resolve();
    await vi.waitFor(() => expect(events).toContain("close_x_login_window"));
    expect(events).not.toContain("provider-cleanup");

    cookieInvoke.resolve({
      status: "ready",
      ct0: "late-ct0",
      auth_token: "late-token",
    });
    await expect(cookieConsumer).rejects.toThrow(
      "Factory reset is in progress",
    );
    await reset;

    expect(
      events.filter((event) => event === "close_x_login_window"),
    ).toHaveLength(1);
    expect(events.indexOf("close_x_login_window")).toBeLessThan(
      events.indexOf("provider-cleanup"),
    );
    expect(window.localStorage.getItem("x_auth_cookies")).toBeNull();
  });
});
