import type { FeedItem } from "@freed/shared";

export const SYNC_CONTENT_TEXT_LIMIT = 4_000;
export const SYNC_PRESERVED_TEXT_LIMIT = 3_000;

export interface FeedTextCompactionSummary {
  scanned: number;
  changed: number;
  contentTextTrimmed: number;
  preservedTextTrimmed: number;
  htmlFieldsRemoved: number;
}

export function createFeedTextCompactionSummary(): FeedTextCompactionSummary {
  return {
    scanned: 0,
    changed: 0,
    contentTextTrimmed: 0,
    preservedTextTrimmed: 0,
    htmlFieldsRemoved: 0,
  };
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit).trimEnd();
}

function addSummary(
  target: FeedTextCompactionSummary,
  source: FeedTextCompactionSummary,
): void {
  target.scanned += source.scanned;
  target.changed += source.changed;
  target.contentTextTrimmed += source.contentTextTrimmed;
  target.preservedTextTrimmed += source.preservedTextTrimmed;
  target.htmlFieldsRemoved += source.htmlFieldsRemoved;
}

export function compactFeedItemTextForSync(item: FeedItem): FeedTextCompactionSummary {
  const summary = createFeedTextCompactionSummary();
  summary.scanned = 1;

  const contentText = item.content.text;
  if (contentText && contentText.length > SYNC_CONTENT_TEXT_LIMIT) {
    item.content.text = truncateText(contentText, SYNC_CONTENT_TEXT_LIMIT);
    summary.contentTextTrimmed = contentText.length - item.content.text.length;
  }

  const preservedContent = item.preservedContent;
  if (preservedContent?.html) {
    delete preservedContent.html;
    summary.htmlFieldsRemoved = 1;
  }

  const preservedText = preservedContent?.text;
  if (preservedContent && preservedText && preservedText.length > SYNC_PRESERVED_TEXT_LIMIT) {
    preservedContent.text = truncateText(preservedText, SYNC_PRESERVED_TEXT_LIMIT);
    summary.preservedTextTrimmed = preservedText.length - preservedContent.text.length;
  }

  if (
    summary.contentTextTrimmed > 0 ||
    summary.preservedTextTrimmed > 0 ||
    summary.htmlFieldsRemoved > 0
  ) {
    summary.changed = 1;
  }

  return summary;
}

export function compactFeedItemsTextForSync(
  feedItems: Iterable<FeedItem>,
): FeedTextCompactionSummary {
  const summary = createFeedTextCompactionSummary();
  for (const item of feedItems) {
    addSummary(summary, compactFeedItemTextForSync(item));
  }
  return summary;
}

export function formatFeedTextCompactionSummary(
  summary: FeedTextCompactionSummary,
): string {
  return (
    `${summary.changed.toLocaleString()} of ${summary.scanned.toLocaleString()} items compacted` +
    ` content_trimmed=${summary.contentTextTrimmed.toLocaleString()}` +
    ` preserved_trimmed=${summary.preservedTextTrimmed.toLocaleString()}` +
    ` html_removed=${summary.htmlFieldsRemoved.toLocaleString()}`
  );
}
