import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyContactSyncState } from "@freed/shared";
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
    const syncState = createEmptyContactSyncState();

    const platformValue = {
      googleContacts: {
        getToken: () => null,
        connect,
      },
    } as unknown as PlatformConfig;

    const contactSyncValue: ContactSyncContextValue = {
      syncState,
      getSyncState: () => syncState,
      syncNow,
      dismissSuggestion: vi.fn(),
      getMatchForSuggestion: vi.fn(() => null),
      openReview: vi.fn(async () => {}),
    };

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
    const syncState = createEmptyContactSyncState();
    const platformValue = {
      googleContacts: {
        getToken: () => null,
        connect,
      },
    } as unknown as PlatformConfig;

    const contactSyncValue: ContactSyncContextValue = {
      syncState,
      getSyncState: () => syncState,
      syncNow,
      dismissSuggestion: vi.fn(),
      getMatchForSuggestion: vi.fn(() => null),
      openReview: vi.fn(async () => {}),
    };

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
