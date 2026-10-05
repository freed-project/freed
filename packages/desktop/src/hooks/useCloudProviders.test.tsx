import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudProviders } from "./useCloudProviders";

const mocks = vi.hoisted(() => ({
  clearCloudProvider: vi.fn(),
  getCloudToken: vi.fn((_provider: string): string | null => null),
  initiateDesktopOAuth: vi.fn(),
  isOAuthCanceledError: vi.fn((error: unknown) => error instanceof Error && error.name === "AbortError"),
  startCloudSync: vi.fn(),
  captureCloudLifecycle: vi.fn((): { isCurrent: () => boolean } => ({ isCurrent: () => true })),
  storeCloudToken: vi.fn(),
  updateCloudProvider: vi.fn(),
}));

vi.mock("../lib/sync", () => ({
  clearCloudProvider: mocks.clearCloudProvider,
  getCloudToken: mocks.getCloudToken,
  initiateDesktopOAuth: mocks.initiateDesktopOAuth,
  isOAuthCanceledError: mocks.isOAuthCanceledError,
  startCloudSync: mocks.startCloudSync,
  captureCloudLifecycle: mocks.captureCloudLifecycle,
  storeCloudToken: mocks.storeCloudToken,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  updateCloudProvider: mocks.updateCloudProvider,
}));

function Harness({ credentialsOnly = false }: { credentialsOnly?: boolean }) {
  const { providers, connect, cancelConnect } = useCloudProviders({ credentialsOnly });

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
    mocks.captureCloudLifecycle.mockReturnValue({ isCurrent: () => true });
    mocks.getCloudToken.mockReturnValue(null);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("stores credentials without starting sync for a fenced transfer", async () => {
    mocks.captureCloudLifecycle.mockReturnValue({ isCurrent: () => true });
    mocks.initiateDesktopOAuth.mockResolvedValue({ accessToken: "new-token" });
    await act(async () => root.render(<Harness credentialsOnly />));
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.storeCloudToken).toHaveBeenCalledWith("gdrive", { accessToken: "new-token" });
    expect(mocks.startCloudSync).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("connected");
    expect(mocks.clearCloudProvider).not.toHaveBeenCalled();
  });

  it.each(["cancel", "unmount", "superseded"] as const)("discards late credentials and preserves existing credentials after %s", async (mode) => {
    let finish!: (token: { accessToken: string }) => void;
    let current = true;
    mocks.captureCloudLifecycle.mockReturnValue({ isCurrent: () => current });
    mocks.initiateDesktopOAuth.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<Harness credentialsOnly />));
    await act(async () => container.querySelector("button")!.click());
    await act(async () => {
      if (mode === "cancel") container.querySelectorAll("button")[1].click();
      else if (mode === "unmount") root.render(<div />);
      else current = false;
    });
    await act(async () => finish({ accessToken: "late-token" }));
    expect(mocks.storeCloudToken).not.toHaveBeenCalled();
    expect(mocks.startCloudSync).not.toHaveBeenCalled();
    expect(mocks.clearCloudProvider).not.toHaveBeenCalled();
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

  it("does not call a stored token connected before startup reconciliation", async () => {
    mocks.getCloudToken.mockImplementation((provider: string) =>
      provider === "gdrive" ? "test-access-token" : null,
    );

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("connecting");
    expect(mocks.updateCloudProvider).not.toHaveBeenCalled();
  });

  it("stays connecting until the initial cloud reconciliation completes", async () => {
    let finishSync: (() => void) | null = null;
    mocks.initiateDesktopOAuth.mockResolvedValue({ accessToken: "token" });
    mocks.startCloudSync.mockImplementation(
      () => new Promise<void>((resolve) => { finishSync = resolve; }),
    );

    await act(async () => {
      root.render(<Harness />);
    });
    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect Google Drive",
    );
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("connecting");
    expect(mocks.startCloudSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSync?.();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("connected");
  });

  it("clears the token and cloud loop when setup is canceled during initial reconciliation", async () => {
    let finishSync: (() => void) | null = null;
    mocks.initiateDesktopOAuth.mockResolvedValue({ accessToken: "token" });
    mocks.startCloudSync.mockImplementation(
      () => new Promise<void>((resolve) => { finishSync = resolve; }),
    );

    await act(async () => {
      root.render(<Harness />);
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const connectButton = buttons.find((button) => button.textContent === "Connect Google Drive");
    const cancelButton = buttons.find((button) => button.textContent === "Cancel Google Drive");

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.storeCloudToken).toHaveBeenCalledTimes(1);
    expect(mocks.startCloudSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("idle");
    expect(mocks.clearCloudProvider).toHaveBeenCalledWith("gdrive");

    await act(async () => {
      finishSync?.();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='gdrive-status']")?.textContent).toBe("idle");
  });

  it("does not store credentials when the cloud lifecycle changes during OAuth", async () => {
    let finishOAuth: ((token: { accessToken: string }) => void) | null = null;
    let lifecycleCurrent = true;
    mocks.captureCloudLifecycle.mockReturnValue({
      isCurrent: () => lifecycleCurrent,
    });
    mocks.initiateDesktopOAuth.mockImplementation(
      () => new Promise((resolve) => { finishOAuth = resolve; }),
    );

    await act(async () => {
      root.render(<Harness />);
    });
    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect Google Drive",
    );
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    lifecycleCurrent = false;
    await act(async () => {
      finishOAuth?.({ accessToken: "stale-token" });
      await Promise.resolve();
    });

    expect(mocks.storeCloudToken).not.toHaveBeenCalled();
    expect(mocks.startCloudSync).not.toHaveBeenCalled();
  });

  it("shows native string failures instead of a generic connection error", async () => {
    mocks.captureCloudLifecycle.mockReturnValue({ isCurrent: () => true });
    mocks.initiateDesktopOAuth.mockResolvedValue({ accessToken: "token" });
    mocks.startCloudSync.mockRejectedValue(
      "load local writer authority failed: Library Core could not read its authority key",
    );

    await act(async () => {
      root.render(<Harness />);
    });
    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Connect Google Drive",
    );
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.updateCloudProvider).toHaveBeenLastCalledWith("gdrive", {
        status: "error",
        error:
          "load local writer authority failed: Library Core could not read its authority key",
      });
    });
  });
});
