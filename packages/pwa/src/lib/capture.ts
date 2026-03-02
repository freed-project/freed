/**
 * Feed management for the PWA
 *
 * The PWA is a reader — it displays items synced from the desktop app
 * via Automerge. Feed subscription and fetching are desktop-only
 * capabilities (the PWA has no CORS proxy). The PWA can export existing
 * subscriptions to OPML for portability.
 */

import { useAppStore } from "./store";
import { toast } from "../components/Toast";
import { generateOPML, downloadFile } from "@freed/shared";

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
