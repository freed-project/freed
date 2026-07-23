import { describe, expect, it, vi } from "vitest";
import { fetchPublicHtml, isPublicAddress } from "../../api/fetch-url";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

describe("article fetch proxy security", () => {
  it.each([
    ["8.8.8.8", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["169.254.169.254", false],
    ["192.168.1.10", false],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["::ffff:127.0.0.1", false],
  ])("classifies %s public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("fetches bounded public HTML with pinned public DNS", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html><body>Article</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await fetchPublicHtml(new URL("https://example.com/article"), {
      resolveHost: publicDns,
      fetchImpl,
    });

    expect(result).toEqual({
      html: "<html><body>Article</body></html>",
      status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects a redirect into loopback before a second request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:3000/secrets" },
      }),
    );

    await expect(
      fetchPublicHtml(new URL("https://example.com/redirect"), {
        resolveHost: publicDns,
        fetchImpl,
      }),
    ).rejects.toThrow(/public network/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed public and private DNS answers", async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchPublicHtml(new URL("https://rebinding.example/article"), {
        resolveHost: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        fetchImpl,
      }),
    ).rejects.toThrow(/public network/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects credentialed URLs and non-HTML responses", async () => {
    await expect(
      fetchPublicHtml(new URL("https://user:password@example.com/article"), {
        resolveHost: publicDns,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow(/credentialed/i);

    await expect(
      fetchPublicHtml(new URL("https://example.com/archive.zip"), {
        resolveHost: publicDns,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("zip", {
            status: 200,
            headers: { "content-type": "application/zip" },
          }),
        ),
      }),
    ).rejects.toThrow(/HTML document/i);
  });

  it("rejects a declared body above the byte cap before reading it", async () => {
    await expect(
      fetchPublicHtml(new URL("https://example.com/large"), {
        resolveHost: publicDns,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("small fixture", {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": String(2 * 1024 * 1024 + 1),
            },
          }),
        ),
      }),
    ).rejects.toThrow(/too large/i);
  });
});
