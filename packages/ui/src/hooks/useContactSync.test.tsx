/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTACT_SYNC_STORAGE_KEY, type ContactSyncState } from "@freed/shared";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext";
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
    localStorage.removeItem(CONTACT_SYNC_STORAGE_KEY);
    vi.restoreAllMocks();
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

    await act(async () => {
      resolveFetch?.({ contacts: [], nextSyncToken: "next-token", deleted: [] });
      await firstSync;
    });

    expect(actions?.getSyncState()).toMatchObject({
      authStatus: "connected",
      syncStatus: "idle",
      syncToken: "next-token",
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
});
