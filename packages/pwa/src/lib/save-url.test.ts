import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDocAddStubItem = vi.fn(async () => undefined);

vi.mock("./automerge", () => ({
  docAddStubItem: mockDocAddStubItem,
}));

vi.mock("@freed/capture-save/normalize", () => ({
  hashSavedUrl: (url: string) => url === "https://example.com/article" ? "abc123" : "stub123",
}));

describe("saveUrlInPwa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a saved stub without foreground article fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { saveUrlInPwa } = await import("./save-url");

    const result = await saveUrlInPwa("https://example.com/article", { tags: ["research"] });

    expect(fetch).not.toHaveBeenCalled();
    expect(mockDocAddStubItem).toHaveBeenCalledWith("https://example.com/article", ["research"]);
    expect(result).toEqual({ globalId: "saved:abc123" });
    vi.unstubAllGlobals();
  });

  it("rejects invalid URLs instead of silently creating a stub", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("notaurl")).rejects.toThrow("Invalid URL");
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("rejects unsupported protocols with a specific error", async () => {
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("ftp://example.com/article")).rejects.toThrow(
      "Only http and https URLs are supported",
    );
    expect(mockDocAddStubItem).not.toHaveBeenCalled();
  });

  it("propagates Automerge persistence failures", async () => {
    mockDocAddStubItem.mockRejectedValueOnce(new Error("Automerge unavailable"));
    const { saveUrlInPwa } = await import("./save-url");

    await expect(saveUrlInPwa("https://example.com/article")).rejects.toThrow(
      "Automerge unavailable",
    );
  });
});
