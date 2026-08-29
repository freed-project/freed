import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { GoogleContactsSection } from "@freed/ui/components/settings/GoogleContactsSection";
import {
  getLastFatalRuntimeError,
  installGlobalBugReportCapture,
  resetBugReportState,
} from "@freed/ui/lib/bug-report";
import {
  ContactSyncContext,
  type ContactSyncContextValue,
} from "../../ui/src/context/ContactSyncContext";

function createContactSyncValue(
  overrides: Partial<ContactSyncContextValue> = {},
): ContactSyncContextValue {
  const status = {
    activeContactCount: 0,
    activeGenerationId: null,
    authStatus: "reconnect_required" as const,
    createdFriendCount: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncedAt: null,
    pendingSuggestionCount: 0,
    queryId: "device_contact_status_v1" as const,
    revision: 0,
    schemaVersion: 1 as const,
    syncStartedAt: null,
    syncStatus: "idle" as const,
    syncToken: null,
    updatedAt: 0,
  };
  return {
    dismissSuggestion: vi.fn(async () => {}),
    loadNextSuggestionPage: vi.fn(async () => ({
      nextCursor: null,
      queryId: "device_contact_suggestion_page_v1" as const,
      revision: 0,
      rows: [],
      schemaVersion: 1 as const,
    })),
    loadNextUnmatchedPage: vi.fn(async () => ({
      nextCursor: null,
      queryId: "device_contact_unmatched_page_v1" as const,
      revision: 0,
      rows: [],
      schemaVersion: 1 as const,
    })),
    openReview: vi.fn(async () => {}),
    refreshReview: vi.fn(async () => {}),
    resetSuggestionPage: vi.fn(async () => ({
      nextCursor: null,
      queryId: "device_contact_suggestion_page_v1" as const,
      revision: 0,
      rows: [],
      schemaVersion: 1 as const,
    })),
    resetUnmatchedPage: vi.fn(async () => ({
      nextCursor: null,
      queryId: "device_contact_unmatched_page_v1" as const,
      revision: 0,
      rows: [],
      schemaVersion: 1 as const,
    })),
    suggestionPage: {
      nextCursor: null,
      queryId: "device_contact_suggestion_page_v1",
      revision: 0,
      rows: [],
      schemaVersion: 1,
    },
    syncNow: vi.fn(async () => status),
    syncState: status,
    unmatchedPage: {
      nextCursor: null,
      queryId: "device_contact_unmatched_page_v1",
      revision: 0,
      rows: [],
      schemaVersion: 1,
    },
    ...overrides,
  };
}

describe("GoogleContactsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetBugReportState();
    installGlobalBugReportCapture("desktop");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
    resetBugReportState();
  });

  it("keeps OAuth token exchange failures recoverable instead of promoting them to fatal errors", async () => {
    const connect = vi.fn().mockRejectedValue(
      new Error('Token exchange failed (400): { "error_description": "client_secret is missing." }'),
    );
    const syncNow = vi.fn();

    const platformValue = {
      googleContacts: {
        getToken: () => null,
        connect,
      },
    } as unknown as PlatformConfig;

    const contactSyncValue = createContactSyncValue({ syncNow });

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncContext.Provider value={contactSyncValue}>
            <GoogleContactsSection />
          </ContactSyncContext.Provider>
        </PlatformProvider>,
      );
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Reconnect Google"),
    );

    expect(connectButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(syncNow).not.toHaveBeenCalled();
    expect(container.textContent).toContain("client_secret is missing.");
    expect(getLastFatalRuntimeError()).toBeNull();
  });

  it("keeps manual Google Contacts sync failures recoverable in settings", async () => {
    const syncNow = vi.fn().mockRejectedValue(
      new Error("Google token refresh failed (400): client_secret is missing."),
    );
    const baseContactSync = createContactSyncValue();
    const syncState = {
      ...baseContactSync.syncState,
      authStatus: "connected" as const,
    };

    const platformValue = {
      googleContacts: {
        getToken: () => null,
        connect: vi.fn(async () => {}),
      },
    } as unknown as PlatformConfig;

    const contactSyncValue = createContactSyncValue({ syncNow, syncState });

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncContext.Provider value={contactSyncValue}>
            <GoogleContactsSection />
          </ContactSyncContext.Provider>
        </PlatformProvider>,
      );
    });

    const syncButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sync Now"),
    );

    expect(syncButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(syncNow).toHaveBeenCalledWith({ force: true });
    expect(container.textContent).toContain("client_secret is missing.");
    expect(getLastFatalRuntimeError()).toBeNull();
  });

  it("confirms and cancels a pending Google Contacts connection", async () => {
    const captured: { signal: AbortSignal | null } = { signal: null };
    const connect = vi.fn(({ signal }: { signal?: AbortSignal } = {}) => {
      captured.signal = signal ?? null;
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("Google connection canceled.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    const syncNow = vi.fn();
    const platformValue = {
      googleContacts: {
        getToken: () => null,
        connect,
      },
    } as unknown as PlatformConfig;

    const contactSyncValue = createContactSyncValue({ syncNow });

    await act(async () => {
      root.render(
        <PlatformProvider value={platformValue}>
          <ContactSyncContext.Provider value={contactSyncValue}>
            <GoogleContactsSection />
          </ContactSyncContext.Provider>
        </PlatformProvider>,
      );
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Reconnect Google"),
    );

    expect(connectButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(captured.signal?.aborted).toBe(false);
    expect(connectButton?.textContent).toContain("Cancel Connection");

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cancel Google Contacts connection?");
    const confirmCancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel Connection" && button !== connectButton,
    );
    expect(confirmCancelButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      confirmCancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(captured.signal?.aborted).toBe(true);
    expect(syncNow).not.toHaveBeenCalled();
    expect(connectButton?.textContent).toContain("Reconnect Google");
    expect(container.textContent).toContain("Google Contacts connection canceled.");
  });
});
