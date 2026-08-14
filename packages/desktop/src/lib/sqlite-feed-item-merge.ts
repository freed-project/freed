import type { FeedItem } from "@freed/shared";

function unionStrings(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function earlier(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function later(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function syncedTimestamp(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left > 0 || right > 0) {
    if (left <= 0) return right;
    if (right <= 0) return left;
    return Math.max(left, right);
  }
  return Math.min(left, right);
}

function mergeLikedIntent(
  current: FeedItem["userState"],
  incoming: FeedItem["userState"],
): Pick<FeedItem["userState"], "likedAt" | "likedSyncedAt"> {
  if (
    Number.isFinite(current.likedAt) &&
    Number.isFinite(incoming.likedAt) &&
    current.likedAt !== incoming.likedAt
  ) {
    return (incoming.likedAt as number) > (current.likedAt as number)
      ? { likedAt: incoming.likedAt, likedSyncedAt: incoming.likedSyncedAt }
      : { likedAt: current.likedAt, likedSyncedAt: current.likedSyncedAt };
  }
  return {
    likedAt: earlier(current.likedAt, incoming.likedAt),
    likedSyncedAt: syncedTimestamp(current.likedSyncedAt, incoming.likedSyncedAt),
  };
}

/** Merge a repeated provider capture without importing the retired CRDT schema. */
export function mergeSqliteFeedItem(current: FeedItem, incoming: FeedItem): FeedItem {
  const next = structuredClone(current);
  const likedIntent = mergeLikedIntent(current.userState, incoming.userState);
  next.capturedAt = Math.min(current.capturedAt, incoming.capturedAt);
  next.publishedAt = Math.min(current.publishedAt, incoming.publishedAt);

  if ((incoming.content.text?.length ?? 0) > (current.content.text?.length ?? 0)) {
    next.content.text = incoming.content.text;
  }
  const media = new Map<string, FeedItem["content"]["mediaTypes"][number]>();
  current.content.mediaUrls.forEach((url, index) => {
    media.set(url, current.content.mediaTypes[index] ?? "image");
  });
  incoming.content.mediaUrls.forEach((url, index) => {
    const type = incoming.content.mediaTypes[index] ?? "image";
    if (!media.has(url) || type === "video") media.set(url, type);
  });
  next.content.mediaUrls = [...media.keys()];
  next.content.mediaTypes = [...media.values()];
  if (current.content.linkPreview || incoming.content.linkPreview) {
    next.content.linkPreview = {
      ...incoming.content.linkPreview,
      ...current.content.linkPreview,
      url: current.content.linkPreview?.url ?? incoming.content.linkPreview?.url ?? "",
      title:
        (incoming.content.linkPreview?.title?.length ?? 0) >
        (current.content.linkPreview?.title?.length ?? 0)
          ? incoming.content.linkPreview?.title
          : current.content.linkPreview?.title,
      description:
        (incoming.content.linkPreview?.description?.length ?? 0) >
        (current.content.linkPreview?.description?.length ?? 0)
          ? incoming.content.linkPreview?.description
          : current.content.linkPreview?.description,
    };
  }
  next.location = current.location
    ? {
        ...incoming.location,
        ...current.location,
        coordinates: current.location.coordinates ?? incoming.location?.coordinates,
        url: current.location.url ?? incoming.location?.url,
        name:
          current.location.name === "Location"
            ? incoming.location?.name ?? current.location.name
            : current.location.name,
      }
    : incoming.location;
  next.timeRange = current.timeRange ?? incoming.timeRange;
  next.rssSource = current.rssSource ?? incoming.rssSource;
  next.fbGroup = current.fbGroup ?? incoming.fbGroup;
  next.preservedContent = current.preservedContent ?? incoming.preservedContent;
  next.sourceUrl = current.sourceUrl ?? incoming.sourceUrl;
  next.author = {
    ...incoming.author,
    ...current.author,
    displayName:
      (incoming.author.displayName?.length ?? 0) > (current.author.displayName?.length ?? 0)
        ? incoming.author.displayName
        : current.author.displayName,
    avatarUrl:
      (incoming.author.avatarUrl?.length ?? 0) > (current.author.avatarUrl?.length ?? 0)
        ? incoming.author.avatarUrl
        : current.author.avatarUrl,
  };
  next.topics = unionStrings(current.topics, incoming.topics);
  next.engagement = {
    likes: Math.max(current.engagement?.likes ?? 0, incoming.engagement?.likes ?? 0) || undefined,
    reposts: Math.max(current.engagement?.reposts ?? 0, incoming.engagement?.reposts ?? 0) || undefined,
    comments: Math.max(current.engagement?.comments ?? 0, incoming.engagement?.comments ?? 0) || undefined,
    views: Math.max(current.engagement?.views ?? 0, incoming.engagement?.views ?? 0) || undefined,
  };
  next.priority = Math.max(current.priority ?? 0, incoming.priority ?? 0) || undefined;
  next.priorityComputedAt = later(current.priorityComputedAt, incoming.priorityComputedAt);
  next.contentSignals = incoming.contentSignals ?? current.contentSignals;
  next.eventCandidate = incoming.eventCandidate ?? current.eventCandidate;
  next.userState = {
    ...incoming.userState,
    ...current.userState,
    hidden: current.userState.hidden || incoming.userState.hidden,
    saved: current.userState.saved || incoming.userState.saved,
    archived: current.userState.archived || incoming.userState.archived,
    liked: current.userState.liked || incoming.userState.liked || undefined,
    readAt: earlier(current.userState.readAt, incoming.userState.readAt),
    savedAt: earlier(current.userState.savedAt, incoming.userState.savedAt),
    archivedAt: earlier(current.userState.archivedAt, incoming.userState.archivedAt),
    likedAt: likedIntent.likedAt,
    likedSyncedAt: likedIntent.likedSyncedAt,
    seenSyncedAt: syncedTimestamp(
      current.userState.seenSyncedAt,
      incoming.userState.seenSyncedAt,
    ),
    tags: unionStrings(current.userState.tags, incoming.userState.tags),
    highlights: [
      ...new Map(
        [...(current.userState.highlights ?? []), ...(incoming.userState.highlights ?? [])]
          .map((highlight) => [JSON.stringify(highlight), highlight] as const),
      ).values(),
    ],
  };
  return next;
}
