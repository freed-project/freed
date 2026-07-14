import { invoke } from "@tauri-apps/api/core";
import { extractContentBrowser } from "@freed/capture-save/browser";
import type { FeedItem } from "@freed/shared";
import type { ReaderHydrationResult, ReaderThreadReply } from "@freed/ui/context";
import { contentCache } from "./content-cache";
import { toSyncedPreservedText } from "./preserved-text";
import { docUpdateFeedItem } from "./automerge";
import { useAppStore } from "./store";
import { fetchFacebookComments, fetchInstagramComments } from "./social-comment-hydration";
import { fetchXThreadReplies } from "./x-capture";
import { recordReaderArticleFetchAttempt } from "./runtime-health-events";
import {
  assertFactoryResetEpoch,
  runFactoryResetSensitiveDesktopOperation,
} from "./factory-reset-guard";

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

async function hydrateArticle(
  item: FeedItem,
  pin: boolean,
  resetEpoch: number,
): Promise<ReaderHydrationResult | null> {
  const url = item.content.linkPreview?.url;
  if (!url) return null;

  assertFactoryResetEpoch(resetEpoch);
  recordReaderArticleFetchAttempt({ source: "reader-open", pin });
  const rawHtml = await invoke<string>("fetch_url", { url });
  assertFactoryResetEpoch(resetEpoch);
  const content = extractContentBrowser(rawHtml, url);

  await contentCache.set(item.globalId, content.html);
  assertFactoryResetEpoch(resetEpoch);

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

async function hydrateXReplies(
  item: FeedItem,
  resetEpoch: number,
): Promise<ReaderThreadReply[]> {
  const tweetId = xTweetId(item);
  if (!tweetId) return [];

  const { xAuth } = useAppStore.getState();
  if (!xAuth.isAuthenticated || !xAuth.cookies) return [];

  assertFactoryResetEpoch(resetEpoch);
  const result = await fetchXThreadReplies(tweetId, xAuth.cookies);
  assertFactoryResetEpoch(resetEpoch);
  if (result.errorStage) return [];
  return result.replies.map(replyFromItem);
}

async function hydrateSocialReplies(
  item: FeedItem,
  resetEpoch: number,
): Promise<ReaderThreadReply[]> {
  if (item.contentType === "story") return [];
  if (item.platform === "x") return hydrateXReplies(item, resetEpoch);
  assertFactoryResetEpoch(resetEpoch);
  if (item.platform === "facebook") {
    const replies = await fetchFacebookComments(item.sourceUrl);
    assertFactoryResetEpoch(resetEpoch);
    return replies;
  }
  if (item.platform === "instagram") {
    const replies = await fetchInstagramComments(item.sourceUrl);
    assertFactoryResetEpoch(resetEpoch);
    return replies;
  }
  return [];
}

function supportsSocialReplyHydration(item: FeedItem): boolean {
  if (item.contentType === "story") return false;
  return item.platform === "x" || item.platform === "facebook" || item.platform === "instagram";
}

function socialStoryMessage(item: FeedItem): string | null {
  if (item.contentType !== "story") return null;
  if (item.platform !== "facebook" && item.platform !== "instagram") return null;
  return "Story replies are private on this platform. Open the story to reply there.";
}

export async function hydrateReaderItem(
  item: FeedItem,
  options: { pin: boolean; includeReplies?: boolean },
): Promise<ReaderHydrationResult> {
  return runFactoryResetSensitiveDesktopOperation(async (resetEpoch) => {
    const [article, replies] = await Promise.all([
      hydrateArticle(item, options.pin, resetEpoch).catch(() => null),
      options.includeReplies
        ? hydrateSocialReplies(item, resetEpoch).catch(() => [])
        : Promise.resolve([]),
    ]);
    assertFactoryResetEpoch(resetEpoch);
    const storyMessage = socialStoryMessage(item);

    if (article || replies.length > 0 || (storyMessage && item.content.mediaUrls.length > 0)) {
      return {
        ...(article ?? {}),
        replies,
        status: article?.status ?? "partial",
        ...(storyMessage ? { message: storyMessage } : {}),
      };
    }

    if (item.contentType === "story") {
      return {
        mediaUrls: item.content.mediaUrls,
        mediaTypes: item.content.mediaTypes,
        status: item.content.mediaUrls.length > 0 ? "partial" : "expired",
        message:
          item.content.mediaUrls.length > 0
            ? socialStoryMessage(item) ?? "Showing the media captured with this story."
            : "This story media was not captured before the source expired it.",
      };
    }

    if (!options.includeReplies && supportsSocialReplyHydration(item)) {
      return {
        status: "partial",
      };
    }

    return {
      status: "unsupported",
      message: "No richer reader content is available for this item yet.",
    };
  });
}
