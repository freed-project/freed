import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ReaderThreadReply } from "@freed/ui/context";
import { getFbScraperWindowMode, getIgScraperWindowMode } from "./scraper-prefs";

type Provider = "facebook" | "instagram";

interface RawProviderComment {
  id?: string;
  authorName?: string;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  text?: string;
  publishedAt?: number | string | null;
  mediaUrls?: string[];
  mediaTypes?: Array<"image" | "video" | "link">;
  sourceUrl?: string | null;
  engagement?: ReaderThreadReply["engagement"];
}

interface ProviderCommentsPayload {
  comments?: RawProviderComment[];
  error?: string;
}

function normalizeTimestamp(value: RawProviderComment["publishedAt"]): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeComment(provider: Provider, comment: RawProviderComment): ReaderThreadReply | null {
  const authorName = comment.authorName?.trim();
  const text = comment.text?.trim();
  const mediaUrls = comment.mediaUrls?.filter(Boolean) ?? [];
  if (!authorName || (!text && mediaUrls.length === 0)) return null;
  const publishedAt = normalizeTimestamp(comment.publishedAt);

  return {
    id: comment.id || `${provider}:comment:${authorName}:${text ?? mediaUrls.join("|")}`,
    authorName,
    ...(comment.authorHandle ? { authorHandle: comment.authorHandle } : {}),
    ...(comment.authorAvatarUrl ? { authorAvatarUrl: comment.authorAvatarUrl } : {}),
    ...(text ? { text } : {}),
    ...(comment.sourceUrl ? { sourceUrl: comment.sourceUrl } : {}),
    ...(comment.engagement ? { engagement: comment.engagement } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    mediaUrls,
    mediaTypes: comment.mediaTypes ?? mediaUrls.map(() => "image"),
  };
}

async function fetchProviderComments(
  provider: Provider,
  command: "fb_scrape_comments" | "ig_scrape_comments",
  eventName: "fb-comments-data" | "ig-comments-data",
  url: string | undefined,
): Promise<ReaderThreadReply[]> {
  if (!url) return [];

  const comments: ReaderThreadReply[] = [];
  const seen = new Set<string>();
  let unlisten: UnlistenFn | null = null;

  const addPayload = (payload: ProviderCommentsPayload | null | undefined) => {
    if (!payload?.comments) return;
    for (const raw of payload.comments) {
      const comment = normalizeComment(provider, raw);
      if (!comment || seen.has(comment.id)) continue;
      seen.add(comment.id);
      comments.push(comment);
    }
  };

  try {
    unlisten = await listen<ProviderCommentsPayload>(eventName, (event) => {
      if (event.payload?.error) return;
      addPayload(event.payload);
    });

    const returnedPayload = await invoke<ProviderCommentsPayload | null>(command, {
      url,
      windowMode: provider === "facebook" ? getFbScraperWindowMode() : getIgScraperWindowMode(),
    });
    addPayload(returnedPayload);

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  } finally {
    unlisten?.();
  }

  return comments.slice(0, 40);
}

export function fetchFacebookComments(url: string | undefined): Promise<ReaderThreadReply[]> {
  return fetchProviderComments("facebook", "fb_scrape_comments", "fb-comments-data", url);
}

export function fetchInstagramComments(url: string | undefined): Promise<ReaderThreadReply[]> {
  return fetchProviderComments("instagram", "ig_scrape_comments", "ig-comments-data", url);
}
