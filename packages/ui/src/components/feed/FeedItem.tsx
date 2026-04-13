import { memo, useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { PLATFORM_LABELS, type FeedItem as FeedItemType } from "@freed/shared";
import { usePlatform } from "../../context/PlatformContext.js";
import {
  RssIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  YoutubeIcon,
  RedditIcon,
  GithubIcon,
  MastodonIcon,
  BookmarkIcon,
  TrashIcon,
  ExternalLinkIcon,
} from "../icons.js";

interface FeedItemProps {
  item: FeedItemType;
  onClick?: () => void;
  showEngagement?: boolean;
  focused?: boolean;
  /** Square card variant for the dual-column sidebar */
  compact?: boolean;
  /** Hides avatars and platform icons in compact mode to maximize title space */
  narrow?: boolean;
  /** Highlights as the currently-open item in dual-column mode */
  selected?: boolean;
  onMouseEnter?: () => void;
  onSave?: (e: React.MouseEvent) => void;
  onArchive?: (e: React.MouseEvent) => void;
  /** Called when the user clicks the heart/like button */
  onLike?: (e: React.MouseEvent) => void;
  /** Opens comment URL in the browser. Pass the URL handler for your platform. */
  onOpenCommentUrl?: (url: string) => void;
  /**
   * Explicit pixel height for story tiles. FeedList computes this from the
   * current container width so each tile fills its column at a 3:4 portrait
   * ratio (capped at 288px). Defaults to 288 if omitted.
   */
  storyHeight?: number;
}

function feedCardTransitionName(globalId: string): string {
  return `feed-card-${globalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const cls = "w-3.5 h-3.5";
const SWIPE_THRESHOLD = 72;

const platformIcons: Record<string, ReactNode> = {
  x: <span className="text-xs font-bold leading-none">𝕏</span>,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  linkedin: <LinkedInIcon className={cls} />,
  saved: <BookmarkIcon className={cls} />,
};

const PLATFORM_REACTIONS: Partial<Record<FeedItemType["platform"], ReadonlyArray<{ emoji: string; label: string }>>> = {
  facebook: [
    { emoji: "👍", label: "Like" },
    { emoji: "❤️", label: "Love" },
    { emoji: "😂", label: "Haha" },
    { emoji: "😮", label: "Wow" },
    { emoji: "😢", label: "Sad" },
    { emoji: "😡", label: "Angry" },
  ],
  linkedin: [
    { emoji: "👍", label: "Like" },
    { emoji: "🎉", label: "Celebrate" },
    { emoji: "🤝", label: "Support" },
    { emoji: "😂", label: "Funny" },
    { emoji: "❤️", label: "Love" },
    { emoji: "💡", label: "Insightful" },
    { emoji: "🤔", label: "Curious" },
  ],
  github: [
    { emoji: "👍", label: "+1" },
    { emoji: "👎", label: "-1" },
    { emoji: "😄", label: "Laugh" },
    { emoji: "🎉", label: "Hooray" },
    { emoji: "😕", label: "Confused" },
    { emoji: "❤️", label: "Heart" },
    { emoji: "🚀", label: "Rocket" },
    { emoji: "👀", label: "Eyes" },
  ],
  youtube: [
    { emoji: "👍", label: "Like" },
    { emoji: "👎", label: "Dislike" },
  ],
  reddit: [
    { emoji: "⬆️", label: "Upvote" },
    { emoji: "⬇️", label: "Downvote" },
  ],
};

function likeState(item: FeedItemType): "none" | "noted" | "synced" | "failed" {
  const us = item.userState;
  if (!us.liked) return "none";
  if (us.likedSyncedAt === -1) return "failed";
  if (us.likedSyncedAt && us.likedSyncedAt > 0) return "synced";
  return "noted";
}

function formatEngagementCount(value: number | undefined): string | null {
  if (value === undefined) return null;
  return value.toLocaleString();
}

function getLikeLabel(item: FeedItemType, state: ReturnType<typeof likeState>): string {
  if (state === "synced") return `Liked on ${PLATFORM_LABELS[item.platform] ?? item.platform}`;
  if (state === "noted") return `Liked, syncing to ${PLATFORM_LABELS[item.platform] ?? item.platform}...`;
  if (state === "failed") return `Could not sync to ${PLATFORM_LABELS[item.platform] ?? item.platform}`;
  return "Like";
}

export const FeedItem = memo(function FeedItem({
  item,
  onClick,
  showEngagement = false,
  focused = false,
  compact = false,
  narrow = false,
  selected = false,
  onMouseEnter,
  onSave,
  onArchive,
  onLike,
  onOpenCommentUrl,
  storyHeight = 288,
}: FeedItemProps) {
  const { feedMediaPreviews = "inline" } = usePlatform();
  const sharedTransitionStyle = {
    viewTransitionName: feedCardTransitionName(item.globalId),
  } as React.CSSProperties;
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const platformIcon = platformIcons[item.platform] ?? <span className="text-xs">📄</span>;
  const isRead = Boolean(item.userState.readAt);
  const reactions = PLATFORM_REACTIONS[item.platform] ?? [];
  const hasReactionPalette = reactions.length > 1;
  const likeCount = formatEngagementCount(item.engagement?.likes);
  const commentCount = formatEngagementCount(item.engagement?.comments);

  const [swipeX, setSwipeX] = useState(0);
  const showInlineMedia = feedMediaPreviews === "inline";
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeLocked = useRef<"horizontal" | "vertical" | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeLocked.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    if (!swipeLocked.current) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      swipeLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }

    if (swipeLocked.current === "vertical") return;

    if (dx < 0 && onArchive) {
      e.preventDefault();
      setSwipeX(Math.max(dx, -SWIPE_THRESHOLD * 1.4));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeLocked.current === "horizontal" && swipeX < -SWIPE_THRESHOLD && onArchive) {
      onArchive(e as unknown as React.MouseEvent);
    }
    setSwipeX(0);
    swipeLocked.current = null;
  };

  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_THRESHOLD, 1);
  const pastThreshold = swipeX < -SWIPE_THRESHOLD;
  const enableSwipe = !compact && !!onArchive && !item.userState.saved;

  if (item.contentType === "story") {
    const bg = item.content.mediaUrls[0];
    const isIg = item.platform === "instagram";
    const gradientFallback = isIg
      ? "from-[var(--theme-media-rss)] via-[var(--theme-media-instagram)] to-[var(--theme-accent-secondary)]"
      : "from-[var(--theme-media-facebook)] to-[var(--theme-media-linkedin)]";

    return (
      <div
        data-feed-item-id={item.globalId}
        data-focused={focused ? "true" : "false"}
        className={`relative overflow-hidden rounded-[var(--feed-card-radius)] cursor-pointer group select-none w-full transition-opacity ${
          isRead ? "grayscale opacity-60" : ""
        }`}
        style={{ height: storyHeight }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      >
        {showInlineMedia && bg ? (
          <img
            src={bg}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${gradientFallback}`} />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/10 to-black/55 pointer-events-none" />

        <div className="absolute top-0 left-0 right-0 p-3 flex items-center gap-2">
          {item.author.avatarUrl ? (
            <img
              src={item.author.avatarUrl}
              alt=""
              className="w-7 h-7 rounded-full ring-2 ring-white/50 shrink-0 object-cover"
            />
          ) : (
            <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${gradientFallback} flex items-center justify-center text-[11px] font-bold ring-2 ring-white/50 shrink-0`}>
              {item.author.displayName[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold text-white drop-shadow truncate block leading-tight">
              {item.author.displayName}
            </span>
            <span className="text-[10px] text-white/70 leading-none">{timeAgo}</span>
          </div>
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[10px] text-white font-medium">
            Story
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end gap-2">
          <div className="flex items-center gap-1.5 shrink-0 text-white/75">
            {platformIcons[item.platform] ?? <span className="text-xs">📄</span>}
          </div>

          <div className="flex-1 min-w-0">
            {item.content.text && (
              <p className="text-[11px] text-white/90 drop-shadow line-clamp-1 leading-tight mb-1">
                {item.content.text}
              </p>
            )}
            {item.location?.name && (
              <span className="inline-flex items-center gap-1 text-[10px] text-white/80 bg-black/35 backdrop-blur-sm rounded-full px-2 py-0.5">
                <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
                {item.location.name}
              </span>
            )}
          </div>

          {(onSave || onArchive) && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {onSave && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSave(e); }}
                  title={item.userState.saved ? "Remove bookmark" : "Bookmark"}
                  className={`p-1.5 rounded-lg bg-black/35 backdrop-blur-sm transition-colors ${
                    item.userState.saved ? "text-[var(--theme-accent-secondary)]" : "text-white/70 hover:text-[var(--theme-accent-secondary)]"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill={item.userState.saved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              )}
              {onArchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onArchive(e); }}
                  title="Archive"
                  className="p-1.5 rounded-lg bg-black/35 backdrop-blur-sm text-white/70 hover:text-[rgb(var(--theme-feedback-success-rgb))] transition-colors"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-[var(--feed-card-radius)]" style={sharedTransitionStyle}>
        <article
          data-feed-item-id={item.globalId}
          data-focused={focused ? "true" : "false"}
          data-selected={selected ? "true" : "false"}
          className={`feed-card group cursor-pointer aspect-square overflow-hidden p-3 flex flex-col transition-colors ${
            selected
              ? "border-l-2 border-l-[var(--theme-accent-secondary)] bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)]"
              : "hover:bg-[var(--theme-bg-muted)]"
          } ${isRead ? "grayscale opacity-60" : ""}`}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onClick?.()}
        >
          {!narrow && (
            <div className="flex items-center gap-2 mb-2">
              {item.author.avatarUrl ? (
                <img
                  src={item.author.avatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-7 h-7 rounded-full bg-white/5 ring-1 ring-white/10 shrink-0"
                />
              ) : (
                <div className="theme-avatar-fallback flex h-7 w-7 items-center justify-center rounded-full font-medium shrink-0 text-xs">
                  {item.author.displayName[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-xs truncate block">{item.author.displayName}</span>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]">
                  <span>{platformIcon}</span>
                  <span className="truncate">{timeAgo}</span>
                </div>
              </div>
            </div>
          )}

          {item.content.linkPreview?.title && (
            <h3 className={`font-semibold leading-snug mb-1 ${narrow ? "text-xs line-clamp-3" : "text-sm line-clamp-2"}`}>
              {item.content.linkPreview.title}
            </h3>
          )}

          {item.content.text && (
            <p className={`text-[var(--theme-text-secondary)] leading-relaxed flex-1 min-h-0 ${narrow ? "text-[10px] line-clamp-4" : "text-xs line-clamp-3"}`}>
              {item.content.text}
            </p>
          )}

          {item.userState.tags.length > 0 && (
            <div className="mt-auto pt-2 flex flex-wrap gap-1">
              {item.userState.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="theme-accent-tag rounded-full px-1.5 py-0.5 text-[10px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </article>
      </div>
    );
  }

  const likeStatus = likeState(item);
  const likeLabel = getLikeLabel(item, likeStatus);

  return (
    <div className="relative overflow-hidden rounded-[var(--feed-card-radius)]" style={sharedTransitionStyle}>
      {enableSwipe && swipeX < 0 && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-[var(--feed-card-radius)] transition-colors"
          style={{
            width: `${Math.abs(swipeX) + 16}px`,
            backgroundColor: pastThreshold
              ? "rgb(var(--theme-feedback-success-rgb) / 0.25)"
              : "rgb(var(--theme-feedback-success-rgb) / 0.12)",
          }}
          aria-hidden
        >
          <TrashIcon
            className="h-5 w-5 text-[rgb(var(--theme-feedback-success-rgb))] transition-transform"
            style={{ transform: `scale(${0.7 + swipeProgress * 0.3})`, opacity: swipeProgress } as React.CSSProperties}
          />
        </div>
      )}

      <article
        data-feed-item-id={item.globalId}
        data-focused={focused ? "true" : "false"}
        className={`feed-card group cursor-pointer active:scale-[0.99] transition-transform ${focused ? "ring-2 ring-[color:rgb(var(--theme-accent-secondary-rgb)/0.6)] ring-inset" : ""} ${isRead ? "grayscale opacity-60" : ""}`}
        style={{
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: swipeX === 0 ? "transform 0.25s ease" : undefined,
          willChange: swipeX !== 0 ? "transform" : undefined,
        }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onTouchStart={enableSwipe ? handleTouchStart : undefined}
        onTouchMove={enableSwipe ? handleTouchMove : undefined}
        onTouchEnd={enableSwipe ? handleTouchEnd : undefined}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      >
        <div className="flex items-center gap-3 mb-3">
          {item.author.avatarUrl ? (
            <img
              src={item.author.avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10 shrink-0"
            />
          ) : (
            <div className="theme-avatar-fallback flex h-10 w-10 items-center justify-center rounded-full font-medium shrink-0 text-lg">
              {item.author.displayName[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{item.author.displayName}</span>
              <span className="text-[var(--theme-text-muted)] text-sm">@{item.author.handle}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--theme-text-muted)]">
              <span>{platformIcon}</span>
              <span>{timeAgo}</span>
              {item.preservedContent?.readingTime && (
                <>
                  <span>•</span>
                  <span>{item.preservedContent.readingTime} min</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onLike && (
              <div className="relative group/reactions">
                {hasReactionPalette && (
                  <div className="pointer-events-none absolute right-0 bottom-full mb-2 flex translate-y-1 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-1 opacity-0 shadow-lg shadow-black/30 transition-all group-hover/reactions:pointer-events-auto group-hover/reactions:translate-y-0 group-hover/reactions:opacity-100 group-focus-within/reactions:pointer-events-auto group-focus-within/reactions:translate-y-0 group-focus-within/reactions:opacity-100">
                    {reactions.map((reaction) => (
                      <button
                        key={reaction.label}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onLike(e as unknown as React.MouseEvent); }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-transform hover:scale-110 hover:bg-white/10"
                        title={reaction.label}
                        aria-label={reaction.label}
                      >
                        <span aria-hidden="true">{reaction.emoji}</span>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); onLike(e); }}
                  title={likeLabel}
                  aria-label={likeLabel}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${
                    likeStatus === "synced"
                      ? "text-red-400"
                      : likeStatus === "noted"
                      ? "text-amber-400"
                      : likeStatus === "failed"
                      ? "text-orange-400"
                      : "text-[var(--theme-text-soft)] hover:text-red-400"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={likeStatus !== "none" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  {showEngagement && likeCount !== null && <span>{likeCount}</span>}
                  {likeStatus === "noted" && (
                    <svg className="w-2.5 h-2.5 animate-spin opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {likeStatus === "failed" && (
                    <svg className="w-2.5 h-2.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                </button>
              </div>
            )}

            {onOpenCommentUrl && item.sourceUrl && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenCommentUrl(item.sourceUrl!); }}
                title={`Comment on ${PLATFORM_LABELS[item.platform] ?? item.platform}`}
                aria-label={`Comment on ${PLATFORM_LABELS[item.platform] ?? item.platform}`}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--theme-text-soft)] hover:text-[var(--theme-text-secondary)] transition-colors opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {showEngagement && commentCount !== null && <span>{commentCount}</span>}
              </button>
            )}

            {onSave && (
              <button
                onClick={onSave}
                title={item.userState.saved ? "Remove bookmark" : "Bookmark"}
                className={`p-1.5 rounded-lg transition-colors ${
                  item.userState.saved
                    ? "text-[var(--theme-accent-secondary)]"
                    : "text-[var(--theme-text-soft)] hover:text-[var(--theme-accent-secondary)] opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg className="w-4 h-4" fill={item.userState.saved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}

            {onArchive && !item.userState.saved && (
              <button
                onClick={onArchive}
                title="Archive"
                className="p-1.5 rounded-lg transition-colors text-[var(--theme-text-soft)] hover:text-[rgb(var(--theme-feedback-success-rgb))] opacity-0 group-hover:opacity-100"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}

            {onOpenCommentUrl && item.sourceUrl && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenCommentUrl(item.sourceUrl!); }}
                title="Open"
                aria-label="Open"
                className="p-1.5 rounded-lg text-[var(--theme-text-soft)] hover:text-[var(--theme-text-secondary)] transition-colors opacity-0 group-hover:opacity-100"
              >
                <ExternalLinkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {item.content.linkPreview?.title && (
          <h3 className="font-semibold mb-1.5 line-clamp-2 leading-snug text-lg">
            {item.content.linkPreview.title}
          </h3>
        )}

        {item.content.text && (
          <p className="mb-3 leading-relaxed line-clamp-3 text-[var(--theme-text-secondary)]">
            {item.content.text}
          </p>
        )}

        {showInlineMedia && item.content.mediaUrls.length > 0 && (
          <div className="mt-3 rounded-xl overflow-hidden ring-1 ring-white/5">
            <img
              src={item.content.mediaUrls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-48 sm:h-56 object-cover bg-white/5"
            />
          </div>
        )}

        {item.userState.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.userState.tags.map((tag) => (
              <span
                key={tag}
                className="theme-accent-tag rounded-full px-2.5 py-1 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </article>
    </div>
  );
});
