import { hasSampleDataFingerprint, type FeedItem } from "@freed/shared";

/** Presentation-only recognition of samples; never use it for data authority. */
export function isSamplePreviewItem(item: FeedItem): boolean {
  // Bounded cards omit cleanup fingerprints but preserve both namespaces.
  if (hasSampleDataFingerprint(item)) return true;
  if (item.globalId.startsWith(`${item.platform}:sample:`) &&
      item.author.id.startsWith("sample:")) return true;
  const curated = /^(.+):sample-character:([^:]+):[0-9]+$/.exec(item.globalId);
  return curated !== null &&
    item.author.id === `${curated[1]}:sample-character-${curated[2]}`;
}
