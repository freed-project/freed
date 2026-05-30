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
});
