import { hasSampleDataFingerprint, type FeedItem } from "@freed/shared";

/** Presentation-only recognition of samples; never use it for data authority. */
export function isSamplePreviewItem(item: FeedItem): boolean {
  // Bounded cards omit cleanup fingerprints but preserve both namespaces.
  return hasSampleDataFingerprint(item) || (
    item.globalId.startsWith(`${item.platform}:sample:`) &&
    item.author.id.startsWith("sample:")
  );
}
