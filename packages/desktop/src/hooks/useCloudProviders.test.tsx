import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudProviders } from "./useCloudProviders";

const mocks = vi.hoisted(() => ({
  clearCloudProvider: vi.fn(),
  getCloudToken: vi.fn(() => null),
  initiateDesktopOAuth: vi.fn(),
  isOAuthCanceledError: vi.fn((error: unknown) => error instanceof Error && error.name === "AbortError"),
  setCloudProviders: vi.fn(),
  startCloudSync: vi.fn(),
  storeCloudToken: vi.fn(),
}));

vi.mock("../lib/sync", () => ({
  clearCloudProvider: mocks.clearCloudProvider,
  getCloudToken: mocks.getCloudToken,
  initiateDesktopOAuth: mocks.initiateDesktopOAuth,
  isOAuthCanceledError: mocks.isOAuthCanceledError,
  startCloudSync: mocks.startCloudSync,
  storeCloudToken: mocks.storeCloudToken,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  setCloudProviders: mocks.setCloudProviders,
}));

function Harness() {
  const { providers, connect, cancelConnect } = useCloudProviders();

  return (
    <div>
      <p data-testid="gdrive-status">{providers.gdrive.status}</p>
      <button type="button" onClick={() => void connect("gdrive")}>Connect Google Drive</button>
      <button type="button" onClick={() => cancelConnect("gdrive")}>Cancel Google Drive</button>
    </div>
  );
}

describe("useCloudProviders", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("confirms and cancels a pending Google Drive connection", async () => {
    const captured: { signal: AbortSignal | null } = { signal: null };
    mocks.initiateDesktopOAuth.mockImplementation((_provider, options: { signal?: AbortSignal } = {}) => {
      captured.signal = options.signal ?? null;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("Google connection canceled.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    await act(async () => {
      root.render(<Harness />);
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect Google Drive",
    );
    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel Google Drive",
    );

    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    expect(cancelButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("connecting");
    expect(captured.signal?.aborted).toBe(false);

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(captured.signal?.aborted).toBe(true);
    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("idle");
    expect(mocks.storeCloudToken).not.toHaveBeenCalled();
    expect(mocks.startCloudSync).not.toHaveBeenCalled();
  });
});
