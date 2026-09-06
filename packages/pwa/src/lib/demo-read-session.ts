import type { FeedItem } from "@freed/shared";
import type { BoundedFeedReader, LibraryFacetSummary } from "@freed/ui/context";

/** Presentation-only read receipts. Never serialized or submitted as Library intents. */
const readItems = new Map<string, { readAt: number; platform: string }>();

export function markDemoItemRead(item: FeedItem): boolean {
  if (item.userState.readAt || readItems.has(item.globalId)) return false;
  readItems.set(item.globalId, { readAt: Date.now(), platform: item.platform });
  return true;
}

export function projectDemoItemRead(item: FeedItem): FeedItem {
  const receipt = readItems.get(item.globalId);
  return receipt ? { ...item, userState: { ...item.userState, readAt: receipt.readAt } } : item;
}

export function projectDemoFacetReads(summary: LibraryFacetSummary): LibraryFacetSummary {
  const counts = new Map<string, number>();
  for (const receipt of readItems.values()) counts.set(receipt.platform, (counts.get(receipt.platform) ?? 0) + 1);
  return {
    ...summary,
    unreadCount: Math.max(0, summary.unreadCount - readItems.size),
    platformCounts: summary.platformCounts.map(row => ({ ...row, unreadCount: Math.max(0, row.unreadCount - (counts.get(row.platform) ?? 0)) })),
  };
}

export function projectDemoReaderReads(reader: BoundedFeedReader): BoundedFeedReader {
  return {
    totalCount: reader.totalCount,
    readNext: async () => (await reader.readNext()).map(projectDemoItemRead),
    ...(reader.readPage ? { readPage: async (...args: Parameters<NonNullable<BoundedFeedReader["readPage"]>>) => {
      const page = await reader.readPage!(...args);
      return { ...page, items: page.items.map(projectDemoItemRead) };
    } } : {}),
    close: () => reader.close(),
  };
}
