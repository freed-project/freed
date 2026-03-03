/**
 * Feed management for the PWA
 *
 * The PWA is a reader — it displays items synced from the desktop app
 * via Automerge. Feed subscription and fetching are desktop-only
 * capabilities (the PWA has no CORS proxy).
 *
 * The PWA CAN subscribe to feeds by writing a stub entry to the CRDT doc.
 * The desktop poller detects the stub (title === url sentinel) on next sync
 * and heals it with real metadata and content.
 */

import type { RssFeed } from "@freed/shared";
import { generateOPML, downloadFile } from "@freed/shared";
import { useAppStore } from "./store";
import { toast } from "@freed/ui/components/Toast";

/**
 * Subscribe to an RSS feed from the PWA.
 *
 * The PWA cannot fetch RSS content directly (CORS). Instead, this writes a
 * stub subscription to the Automerge doc using the URL as a sentinel title.
 * The desktop poller recognises the sentinel on next sync, fetches real
 * metadata and content, and heals the title in-place.
 */
export async function subscribeToFeed(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  const store = useAppStore.getState();

  if (store.feeds[url]) {
    throw new Error("Already subscribed to this feed");
  }

  const stub: RssFeed = {
    url,
    // Use the raw URL as the title — this is the sentinel the desktop poller
    // checks for when deciding whether to overwrite the stored title with the
    // real feed title on first fetch.
    title: url,
    enabled: true,
    trackUnread: false,
  };

  await store.addFeed(stub);

  toast.success("Feed added — items will appear after your next desktop sync");
}

/**
 * Export all current feed subscriptions as an OPML file download.
 */
export function exportFeedsAsOPML(): void {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds);

  if (feeds.length === 0) {
    toast.info("No feeds to export");
    return;
  }

  const xml = generateOPML(feeds);
  const filename = `freed-feeds-${new Date().toISOString().slice(0, 10)}.opml`;
  downloadFile(xml, filename);
  toast.success(`Exported ${feeds.length} feeds`);
}
