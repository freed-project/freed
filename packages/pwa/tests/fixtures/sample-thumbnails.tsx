import React from "react";
import { createRoot } from "react-dom/client";
import { generateSampleLibraryData } from "@freed/shared";
import { FeedItem } from "../../../ui/src/components/feed/FeedItem";
import { PlatformProvider, type PlatformConfig } from "../../../ui/src/context/PlatformContext";

/** Browser-only rendering proof. Never imports or mutates the user's Library. */
export function mountSampleThumbnails(feedMediaPreviews: "inline" | "reader-only") {
  const sample = generateSampleLibraryData({ batchId: "thumbnail-proof", seed: 17 });
  const selected = [...new Map(sample.items
    .filter((item) => ["post", "story"].includes(item.contentType))
    .map((item) => [`${item.platform}:${item.contentType}`, item])).values()];
  const items = selected.map((item, index) => ({
    ...item,
    publishedAt: Date.now() - index * 1000,
    author: { ...item.author, avatarUrl: undefined },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  }));
  const platform = { feedMediaPreviews, sampleMediaPreviews: "inline", store: () => undefined } as unknown as PlatformConfig;
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;z-index:99999;overflow:auto;background:#142029;padding:24px";
  document.body.append(container);
  createRoot(container).render(
    <PlatformProvider value={platform}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24 }}>
        {items.map((item) => <FeedItem key={item.globalId} item={item} fixedHeight={240} />)}
      </div>
    </PlatformProvider>,
  );
  return items.map((item) => ({ id: item.globalId, type: item.contentType, url: item.content.mediaUrls[0]! }));
}
