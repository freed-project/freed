import { afterEach, describe, expect, it, vi } from "vitest";
import { deletePwaLibraryCoreSqliteStorage } from "./library-core-sqlite-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PWA Library Core SQLite storage", () => {
  it("removes the SQLite pool and content vault during factory reset", async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockResolvedValue({ removeEntry }) },
    });

    await deletePwaLibraryCoreSqliteStorage();

    expect(removeEntry).toHaveBeenCalledWith(
      "freed-library-core-sqlite-opfs-v1",
      { recursive: true },
    );
    expect(removeEntry).toHaveBeenCalledWith(
      "freed-library-content-vault-v1",
      { recursive: true },
    );
  });

  it("is idempotent when the private OPFS pool does not exist", async () => {
    const removeEntry = vi
      .fn()
      .mockRejectedValue(new DOMException("missing", "NotFoundError"));
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockResolvedValue({ removeEntry }) },
    });

    await expect(deletePwaLibraryCoreSqliteStorage()).resolves.toBeUndefined();
  });
});
