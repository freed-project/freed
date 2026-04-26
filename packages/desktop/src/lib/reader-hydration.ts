import { invoke } from "@tauri-apps/api/core";
import { extractContentBrowser } from "@freed/capture-save/browser";
import type { FeedItem } from "@freed/shared";
import type { ReaderHydrationResult, ReaderThreadReply } from "@freed/ui/context";
import { contentCache } from "./content-cache";
import { toSyncedPreservedText } from "./preserved-text";
import { docUpdateFeedItem } from "./automerge";
import { useAppStore } from "./store";
import { fetchXThreadReplies } from "./x-capture";

function xTweetId(item: FeedItem): string | null {
  if (item.platform !== "x") return null;
  const fromGlobalId = item.globalId.match(/^x:(\d+)/)?.[1];
  if (fromGlobalId) return fromGlobalId;
  return item.sourceUrl?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

function replyFromItem(item: FeedItem): ReaderThreadReply {
  return {
    id: item.globalId,
    authorName: item.author.displayName,
    authorHandle: item.author.handle,
    authorAvatarUrl: item.author.avatarUrl,
    text: item.content.text,
    publishedAt: item.publishedAt,
    mediaUrls: item.content.mediaUrls,
    mediaTypes: item.content.mediaTypes,
    sourceUrl: item.sourceUrl,
    engagement: item.engagement,
  };
}

async function hydrateArticle(item: FeedItem, pin: boolean): Promise<ReaderHydrationResult | null> {
  const url = item.content.linkPreview?.url;
  if (!url) return null;

  const rawHtml = await invoke<string>("fetch_url", { url });
  const content = extractContentBrowser(rawHtml, url);
  await contentCache.set(item.globalId, content.html);
  await docUpdateFeedItem(item.globalId, {
    preservedContent: {
      text: toSyncedPreservedText(content.text),
      ...(content.author ? { author: content.author } : {}),
      wordCount: content.wordCount,
      readingTime: content.readingTime,
      preservedAt: Date.now(),
    },
  });

  return {
    html: content.html,
    status: pin ? "hydrated" : "partial",
  };
}

async function hydrateXReplies(item: FeedItem): Promise<ReaderThreadReply[]> {
  const tweetId = xTweetId(item);
  if (!tweetId) return [];

  const { xAuth } = useAppStore.getState();
  if (!xAuth.isAuthenticated || !xAuth.cookies) return [];

  const result = await fetchXThreadReplies(tweetId, xAuth.cookies);
  if (result.errorStage) return [];
  return result.replies.map(replyFromItem);
}

export async function hydrateReaderItem(
  item: FeedItem,
  options: { pin: boolean },
): Promise<ReaderHydrationResult> {
  const [article, replies] = await Promise.all([
    hydrateArticle(item, options.pin).catch(() => null),
    hydrateXReplies(item).catch(() => []),
  ]);

  if (article || replies.length > 0) {
    return {
      ...(article ?? {}),
      replies,
      status: article?.status ?? "partial",
    };
  }

  if (item.contentType === "story") {
    return {
      mediaUrls: item.content.mediaUrls,
      mediaTypes: item.content.mediaTypes,
      status: item.content.mediaUrls.length > 0 ? "partial" : "expired",
      message:
        item.content.mediaUrls.length > 0
          ? "Showing the media captured with this story."
          : "This story media was not captured before the source expired it.",
    };
  }

  return {
    status: "unsupported",
    message: "No richer reader content is available for this item yet.",
  };
}
