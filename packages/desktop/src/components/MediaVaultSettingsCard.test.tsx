import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockArchiveLibraryCoreProviderMedia,
  mockImportMetaExportFiles,
  mockScanProviderItems,
  mockSummary,
} = vi.hoisted(() => ({
  mockArchiveLibraryCoreProviderMedia: vi.fn(),
  mockImportMetaExportFiles: vi.fn(),
  mockScanProviderItems: vi.fn(),
  mockSummary: {
    enabled: false,
    fileCount: 0,
    byteSize: 0,
    failureCount: 0,
    ownerHandles: [] as string[],
    lastSuccessAt: undefined as number | undefined,
    lastError: undefined as string | undefined,
  },
}));

vi.mock("@tauri-apps/plugin-shell", async () => {
  const actual = await import("../__mocks__/@tauri-apps/plugin-shell/index");
  return actual;
});

vi.mock("../lib/meta-export-import", () => ({
  importMetaExportFiles: mockImportMetaExportFiles,
}));

vi.mock("../lib/library-core-provider-settings-runtime", () => ({
  scanLibraryCoreProviderItems: mockScanProviderItems,
}));

vi.mock("../lib/media-vault", () => ({
  archiveLibraryCoreProviderMedia: mockArchiveLibraryCoreProviderMedia,
  getMediaVaultProviderDir: vi.fn(
    async (provider: string) => `/mock/app-data/media-vault/${provider}`,
  ),
  setMediaVaultEnabled: vi.fn(async (_provider: string, enabled: boolean) => {
    mockSummary.enabled = enabled;
  }),
  subscribeMediaVault: vi.fn(() => () => {}),
  summarizeMediaVault: vi.fn(async () => ({
    ...mockSummary,
    ownerHandles: [...mockSummary.ownerHandles],
  })),
}));

import { useToastStore } from "@freed/ui/components/Toast";
import { MediaVaultSettingsCard } from "./MediaVaultSettingsCard";

describe("MediaVaultSettingsCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockImportMetaExportFiles.mockReset();
    mockArchiveLibraryCoreProviderMedia.mockReset();
    mockScanProviderItems.mockReset();
    mockScanProviderItems.mockImplementation(async () => {});
    Object.assign(mockSummary, {
      enabled: false,
      fileCount: 0,
      byteSize: 0,
      failureCount: 0,
      ownerHandles: [],
      lastSuccessAt: undefined,
      lastError: undefined,
    });
    useToastStore.setState({ toasts: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderCard(authenticated = true) {
    await act(async () => {
      root.render(
        <MediaVaultSettingsCard
          provider="instagram"
          providerLabel="Instagram"
          authenticated={authenticated}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("renders disabled controls before the archive is enabled", async () => {
    await renderCard(false);

    expect(container.textContent).toContain("(Beta) Back up my uploaded media");
    expect(container.textContent).toContain("Files 0");
    expect(container.textContent).toContain("Last backup Never");
    expect(
      container
        .querySelector("button[aria-label='(Beta) Back up my uploaded media']")
        ?.getAttribute("aria-checked"),
    ).toBe("false");

    const backfill = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Backfill from profile"),
    );
    expect(backfill).toBeInstanceOf(HTMLButtonElement);
    expect((backfill as HTMLButtonElement | undefined)?.disabled).toBe(true);
  });

  it("shows enabled archive state and saved counts", async () => {
    Object.assign(mockSummary, {
      enabled: true,
      fileCount: 1,
      byteSize: 3,
      ownerHandles: ["ada"],
    });

    await renderCard(true);

    expect(
      container
        .querySelector("button[aria-label='(Beta) Back up my uploaded media']")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.textContent).toContain("Files 1");
    expect(container.textContent).toContain("Size 3 B");
    expect(container.textContent).toContain("Known account @ada");
  });

  it("shows import progress and success state", async () => {
    let finishImport: (() => void) | undefined;
    mockImportMetaExportFiles.mockReturnValue(
      new Promise((resolve) => {
        finishImport = () =>
          resolve({
            provider: "instagram",
            filesScanned: 1,
            mediaFilesFound: 1,
            imported: 1,
            skipped: 0,
            failed: 0,
            ownerHandles: ["ada"],
          });
      }),
    );
    await renderCard(true);
    const input = container.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["zip"], "instagram.zip", { type: "application/zip" })],
      configurable: true,
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Importing...");

    await act(async () => {
      finishImport?.();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Importing...");
    expect(useToastStore.getState().toasts[0]?.message).toContain(
      "Imported 1 Instagram media file",
    );
  });

  it("uses the source-fenced SQLite archiver", async () => {
    Object.assign(mockSummary, {
      enabled: true,
      ownerHandles: ["ada"],
    });
    mockArchiveLibraryCoreProviderMedia.mockResolvedValue(3);
    await renderCard(true);

    const backup = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Back up now"),
    );
    await act(async () => {
      backup?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockArchiveLibraryCoreProviderMedia).toHaveBeenCalledWith(
      "instagram",
      "continuous",
      mockScanProviderItems,
    );
    expect(useToastStore.getState().toasts[0]?.message).toContain(
      "Archived 3 Instagram media files",
    );
  });

  it("surfaces a SQLite scan failure instead of reporting a false success", async () => {
    Object.assign(mockSummary, {
      enabled: true,
      ownerHandles: ["ada"],
    });
    mockArchiveLibraryCoreProviderMedia.mockRejectedValue(
      new Error("Library source changed during scan."),
    );
    await renderCard(true);

    const backup = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Back up now"),
    );
    await act(async () => {
      backup?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useToastStore.getState().toasts[0]?.message).toBe(
      "Library source changed during scan.",
    );
    expect(useToastStore.getState().toasts[0]?.message).not.toContain(
      "Archived 0",
    );
  });

  it("shows the most recent archive error", async () => {
    Object.assign(mockSummary, {
      enabled: true,
      lastError: "Provider CDN expired",
      failureCount: 1,
    });

    await renderCard(true);

    expect(container.textContent).toContain("Provider CDN expired");
    expect(container.textContent).toContain(
      "1 media download failure will retry later.",
    );
  });
});
