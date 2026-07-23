/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTACT_SYNC_STORAGE_KEY,
  parseContactSyncState,
  type ContactSyncState,
} from "@freed/shared";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext";
import { useBackgroundActivityStore } from "../lib/background-activity-store";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "../lib/factory-reset";
import { useContactSync } from "./useContactSync";

type ContactSyncActions = ReturnType<typeof useContactSync>;

function ContactSyncHarness({ onReady }: { onReady: (actions: ContactSyncActions) => void }) {
  const actions = useContactSync();

  useEffect(() => {
    onReady(actions);
  }, [actions, onReady]);

  return null;
}

describe("useContactSync", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
    resetFactoryResetStateForTests();
    useBackgroundActivityStore.getState().clearBackgroundActivity();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("coalesces overlapping Google Contacts sync requests", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    let resolveFetch: ((value: { contacts: []; nextSyncToken: string; deleted: [] }) => void) | null = null;
    const getToken = vi.fn(async () => "google-access-token");
    const fetchContacts = vi.fn(() => new Promise<{ contacts: []; nextSyncToken: string; deleted: [] }>((resolve) => {
      resolveFetch = resolve;
    }));
    const setPendingMatchCount = vi.fn();
    const store = <T,>(selector: (state: unknown) => T): T => selector({
      persons: {},
      accounts: {},
      items: [],
      setPendingMatchCount,
    });
    const platformValue = {
      store,
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    let firstSync: Promise<ContactSyncState> | null = null;
    let secondSync: Promise<ContactSyncState> | null = null;
    await act(async () => {
      firstSync = actions!.syncNow();
      secondSync = actions!.syncNow();
      await Promise.resolve();
    });

    expect(firstSync).toBe(secondSync);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expect(fetchContacts).toHaveBeenCalledWith("google-access-token", null);
    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(1);
    expect(useBackgroundActivityStore.getState().active["channel:googleContacts"]).toMatchObject({
      channelId: "googleContacts",
      label: "Google Contacts",
      message: "Fetching Google Contacts.",
    });

    await act(async () => {
      resolveFetch?.({ contacts: [], nextSyncToken: "next-token", deleted: [] });
      await firstSync;
    });

    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "idle",
      syncToken: "next-token",
    });
    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(0);
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "success",
      channelId: "googleContacts",
    });
  });

  it("drains an issued Contacts request without restoring state after reset", async () => {
    const corruptRaw = "{damaged-contact-sync-state";
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, corruptRaw);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    let resolveFetch!: (value: { contacts: []; nextSyncToken: string; deleted: [] }) => void;
    const fetchContacts = vi.fn(() =>
      new Promise<{ contacts: []; nextSyncToken: string; deleted: [] }>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const getToken = vi.fn(async () => "google-access-token");
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    await act(async () => {
      await actions!.syncNow();
    });
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(corruptRaw);

    let sync!: Promise<ContactSyncState>;
    await act(async () => {
      sync = actions!.syncNow({ force: true });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetchContacts).toHaveBeenCalledOnce());
    expect(getToken).toHaveBeenCalledOnce();
    const clearContactState = vi.fn(() => {
      localStorage.removeItem(CONTACT_SYNC_STORAGE_KEY);
    });
    const reset = runFactoryResetOperations({
      quiesceLocalWriters: [],
      clearDeviceStores: () => [],
      clearLocalSettings: [clearContactState],
      clearLocalData: [],
      clearProviderDataAndConnections: async () => undefined,
      clearDocument: async () => undefined,
    });
    await Promise.resolve();
    expect(clearContactState).not.toHaveBeenCalled();

    await act(async () => {
      resolveFetch({ contacts: [], nextSyncToken: "late-token", deleted: [] });
      await sync;
      await reset;
    });

    expect(clearContactState).toHaveBeenCalledOnce();
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBeNull();
    await actions!.syncNow({ force: true });
    expect(fetchContacts).toHaveBeenCalledOnce();
  });

  it.each([
    ["corrupt JSON", "{not-json"],
    ["structurally malformed state", JSON.stringify({ version: 1, cachedContacts: "not-an-array" })],
    ["an unsupported version", JSON.stringify({ version: 99, syncToken: "future-token" })],
  ])("blocks automatic interval and focus sync for %s", async (_label, raw) => {
    vi.useFakeTimers();
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, raw);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const getToken = vi.fn(async () => "google-access-token");
    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    expect(actions?.getSyncState()).toMatchObject({
      syncStatus: "error",
      lastErrorCode: "unknown",
    });
    expect(actions?.getSyncState().lastErrorMessage).toContain("Sync Now");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(getToken).not.toHaveBeenCalled();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(raw);
  });

  it("rechecks the persisted ledger before automatic provider work", async () => {
    vi.useFakeTimers();
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify({
      authStatus: "connected",
      syncStatus: "idle",
      syncToken: "stale-token",
      lastSyncedAt: Date.now() - 60 * 60 * 1000,
      cachedContacts: [],
      pendingSuggestions: [],
      dismissedSuggestionIds: [],
      createdFriendCount: 0,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const getToken = vi.fn(async () => "google-access-token");
    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    const corruptRaw = "{corrupted-after-mount";
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, corruptRaw);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(getToken).not.toHaveBeenCalled();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(actions?.getSyncState()).toMatchObject({
      syncStatus: "error",
      lastErrorCode: "unknown",
    });
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(corruptRaw);
  });

  it("repairs malformed state only during an explicit sync", async () => {
    const malformedRaw = JSON.stringify({ version: 1, cachedContacts: "not-an-array" });
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, malformedRaw);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const getToken = vi.fn(async () => "google-access-token");
    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "repaired-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(malformedRaw);

    await act(async () => {
      await actions!.syncNow({ force: true });
    });

    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchContacts).toHaveBeenCalledWith("google-access-token", null);
    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "idle",
      syncToken: "repaired-token",
    });
    const repaired = parseContactSyncState(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY));
    expect(repaired).toMatchObject({
      status: "valid",
      format: "current",
      state: { syncToken: "repaired-token" },
    });
    const recoveryKey = Array.from({ length: localStorage.length }, (_unused, index) =>
      localStorage.key(index),
    ).find((key) => key?.startsWith(`${CONTACT_SYNC_STORAGE_KEY}.recovery.`));
    expect(recoveryKey).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(recoveryKey ?? "") ?? "{}")).toMatchObject({
      reason: "corrupt",
      raw: malformedRaw,
    });
  });

  it("keeps the repair latch closed when explicit repair cannot be persisted", async () => {
    const corruptRaw = "{contact-sync-write-failure";
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, corruptRaw);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const getToken = vi.fn(async () => "google-access-token");
    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("local storage write failed");
    });
    await act(async () => {
      await actions!.syncNow({ force: true });
    });

    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(actions?.getSyncState()).toMatchObject({
      syncStatus: "error",
      lastErrorCode: "unknown",
    });
    expect(actions?.getSyncState().lastErrorMessage).toContain("could not be read or saved");
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(corruptRaw);

    setItem.mockRestore();
    await act(async () => {
      await actions!.syncNow();
    });

    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(corruptRaw);
  });

  it("keeps Google token lookup failures recoverable in sync state", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const getToken = vi.fn(async () => {
      throw new Error("Google token refresh failed (400): client_secret is missing.");
    });
    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const setPendingMatchCount = vi.fn();
    const store = <T,>(selector: (state: unknown) => T): T => selector({
      persons: {},
      accounts: {},
      items: [],
      setPendingMatchCount,
    });
    const platformValue = {
      store,
      googleContacts: {
        getToken,
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;
    let result: ContactSyncState | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    await act(async () => {
      result = await actions!.syncNow({ force: true });
    });

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      authStatus: "reconnect_required",
      syncStatus: "error",
      syncStartedAt: null,
      lastErrorCode: "auth",
    });
    expect(result?.lastErrorMessage).toContain("client_secret is missing");
    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(0);
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "error",
      channelId: "googleContacts",
    });
  });

  it("recovers a stale persisted syncing state after a successful sync", async () => {
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify({
      authStatus: "connected",
      syncStatus: "syncing",
      syncStartedAt: Date.now() - 180_000,
      syncToken: "old-token",
      lastSyncedAt: 1_700_000_000_000,
      cachedContacts: [],
      pendingSuggestions: [],
      dismissedSuggestionIds: [],
      createdFriendCount: 0,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken: vi.fn(async () => "google-access-token"),
        connect: vi.fn(async () => {}),
        fetchContacts: vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] })),
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    expect(actions?.getSyncState()).toMatchObject({
      syncStatus: "idle",
      syncStartedAt: null,
      lastSyncedAt: 1_700_000_000_000,
    });

    await act(async () => {
      await actions!.syncNow({ force: true });
    });

    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "idle",
      syncStartedAt: null,
      syncToken: "next-token",
    });
  });

  it("times out stalled People API requests instead of leaving the UI syncing", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken: vi.fn(async () => "google-access-token"),
        connect: vi.fn(async () => {}),
        fetchContacts: vi.fn(() => new Promise(() => undefined)),
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    let syncPromise: Promise<ContactSyncState> | null = null;
    await act(async () => {
      syncPromise = actions!.syncNow({ force: true });
      await Promise.resolve();
    });

    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "syncing",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await syncPromise;
    });

    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "error",
      syncStartedAt: null,
      lastErrorCode: "network",
    });
    expect(actions?.getSyncState().lastErrorMessage).toContain("Google Contacts sync timed out");
    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(0);
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "error",
      channelId: "googleContacts",
    });
  });

  it("skips automatic focus syncs when Contacts synced recently", async () => {
    const lastSyncedAt = Date.now();
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify({
      authStatus: "connected",
      syncStatus: "idle",
      syncStartedAt: null,
      syncToken: "recent-token",
      lastSyncedAt,
      cachedContacts: [],
      pendingSuggestions: [],
      dismissedSuggestionIds: [],
      createdFriendCount: 0,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken: vi.fn(async () => "google-access-token"),
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;
    let actions: ContactSyncActions | null = null;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={(nextActions) => {
            actions = nextActions;
          }} />
        </PlatformProvider>,
      );
    });

    await act(async () => {
      await actions!.syncNow();
    });

    expect(fetchContacts).not.toHaveBeenCalled();

    await act(async () => {
      await actions!.syncNow({ force: true });
    });

    expect(fetchContacts).toHaveBeenCalledOnce();
  });

  it("skips automatic focus syncs during the launch grace period", async () => {
    vi.useFakeTimers();
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, JSON.stringify({
      authStatus: "connected",
      syncStatus: "idle",
      syncStartedAt: null,
      syncToken: "stale-token",
      lastSyncedAt: Date.now() - 60 * 60 * 1000,
      cachedContacts: [],
      pendingSuggestions: [],
      dismissedSuggestionIds: [],
      createdFriendCount: 0,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const fetchContacts = vi.fn(async () => ({ contacts: [], nextSyncToken: "next-token", deleted: [] }));
    const platformValue = {
      store: <T,>(selector: (state: unknown) => T): T => selector({
        persons: {},
        accounts: {},
        items: [],
        setPendingMatchCount: vi.fn(),
      }),
      googleContacts: {
        getToken: vi.fn(async () => "google-access-token"),
        connect: vi.fn(async () => {}),
        fetchContacts,
      },
    } as unknown as PlatformConfig;

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncHarness onReady={() => {}} />
        </PlatformProvider>,
      );
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(fetchContacts).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      window.dispatchEvent(new Event("focus"));
    });

    expect(fetchContacts).toHaveBeenCalledOnce();
  });
});
