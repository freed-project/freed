import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { LibraryFacetSummary } from "@freed/ui/context";

describe("demo session read presentation", () => {
  it("deduplicates opens, updates bounded pages and counts, and resets with a new document module", async () => {
    vi.resetModules();
    const session = await import("./demo-read-session");
    const item = { globalId: "demo:story:1", platform: "instagram", userState: {} } as FeedItem;
    const summary = { totalCount: 3, unreadCount: 3, platformCounts: [
      { platform: "instagram", totalCount: 2, unreadCount: 2 },
      { platform: "linkedin", totalCount: 1, unreadCount: 1 },
    ] } as unknown as LibraryFacetSummary;
    expect(session.markDemoItemRead(item)).toBe(true);
    expect(session.markDemoItemRead(item)).toBe(false);
    expect(session.projectDemoItemRead(item).userState.readAt).toBeGreaterThan(0);
    expect(item.userState.readAt).toBeUndefined();
    expect(session.projectDemoFacetReads(summary)).toMatchObject({ totalCount: 3, unreadCount: 2,
      platformCounts: [{ platform: "instagram", unreadCount: 1 }, { platform: "linkedin", unreadCount: 1 }] });
    const close = vi.fn(async () => {});
    const reader = session.projectDemoReaderReads({ totalCount: 1, readNext: async () => [item],
      readPage: async () => ({ items: [item], nextCursor: "next", previousCursor: null }), close });
    expect((await reader.readNext())[0]?.userState.readAt).toBeGreaterThan(0);
    expect(await reader.readPage!(null, "next")).toMatchObject({ nextCursor: "next", items: [{ userState: { readAt: expect.any(Number) } }] });
    await reader.close();
    expect(close).toHaveBeenCalledOnce();
    vi.resetModules();
    const nextDocument = await import("./demo-read-session");
    expect(nextDocument.projectDemoItemRead(item).userState.readAt).toBeUndefined();
    expect(nextDocument.projectDemoFacetReads(summary).unreadCount).toBe(3);
  });
});
