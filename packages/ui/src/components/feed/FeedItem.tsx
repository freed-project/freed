import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { PLATFORM_LABELS, type FeedItem as FeedItemType } from "@freed/shared";
import { usePlatform } from "../../context/PlatformContext.js";
import type { FeedCardDensity } from "../../lib/feed-card-density.js";
import { useDebugStore, type RuntimeMemorySnapshot } from "../../lib/debug-store.js";
import { useHasTouchOnlyPointer } from "../../hooks/useHasTouchOnlyPointer.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { ChannelAvatar } from "../ChannelAvatar.js";
import { isSamplePreviewItem } from "../../lib/sample-preview-media.js";
import { Tooltip } from "../Tooltip.js";
import {
  RssIcon,
  XIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  MediumIcon,
  SubstackIcon,
  YoutubeIcon,
  RedditIcon,
  GithubIcon,
  MastodonIcon,
  BookmarkIcon,
  TrashIcon,
} from "../icons.js";

interface FeedItemProps {
  item: FeedItemType;
  onClick?: () => void;
  showEngagement?: boolean;
  showReadInGrayscale?: boolean;
  focused?: boolean;
  /** Square card variant for the dual-column sidebar */
  compact?: boolean;
  /** Hides avatars and platform icons on narrow cards to preserve title space */
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
  /** Vertical density for full feed cards. Compact thumbnail cards ignore it. */
  density?: FeedCardDensity;
  /**
   * Explicit pixel height for story tiles. FeedList computes this from the
   * current container width so each tile fills its column at a 3:4 portrait
   * ratio (capped at 288px). Defaults to 288 if omitted.
   */
  storyHeight?: number;
  /** Fixed primary-feed card height. Used by desktop virtualization. */
  fixedHeight?: number;
}

function feedCardTransitionName(globalId: string): string {
  return `feed-card-${globalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const cls = "w-3.5 h-3.5";
const feedActionButtonClass = "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg px-1.5 text-xs leading-none transition-colors";
const feedIconActionButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-lg p-0 transition-colors";
const feedActionIconClass = "block h-4 w-4 shrink-0";
const feedActionStatusIconClass = "block h-2.5 w-2.5 shrink-0";
const SWIPE_THRESHOLD = 72;
const EVENT_CHIP_THRESHOLD = 0.7;
const COMPACT_CARD_TEXT_LIMIT = 500;
const COMPACT_CARD_WORD_LIMIT = 45;
const FIXED_CARD_TEXT_LIMIT = 900;
const FULL_CARD_TEXT_LIMIT = 1_500;
const FEED_IMAGE_SHED_APP_PRESSURE_BYTES = 2.25 * 1024 * 1024 * 1024;
const FEED_IMAGE_SHED_WEBKIT_BYTES = 1.5 * 1024 * 1024 * 1024;
const FEED_IMAGE_SHED_APP_HIGH_FRACTION = 0.85;
const FEED_IMAGE_SHED_WEBKIT_HIGH_FRACTION = 0.75;
const EVENT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function semanticChip(item: FeedItemType): string | null {
  const candidate = item.eventCandidate;
  if (candidate?.startsAt && candidate.confidence >= EVENT_CHIP_THRESHOLD) {
    return `Event ${EVENT_DATE_FORMAT.format(new Date(candidate.startsAt))}`;
  }
  if (item.contentSignals?.tags.includes("deadline")) {
    return "Deadline";
  }
  return null;
}

const platformIcons: Record<string, ReactNode> = {
  x: <XIcon className={cls} />,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  linkedin: <LinkedInIcon className={cls} />,
  substack: <SubstackIcon className={cls} />,
  medium: <MediumIcon className={cls} />,
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

const FEED_CARD_LAYOUT_CONTAINMENT_STYLE = {
  contain: "layout paint style",
} satisfies React.CSSProperties;

function shouldShedFeedImages(memory: RuntimeMemorySnapshot | null): boolean {
  if (!memory) return false;
  if (memory.pressureLevel === "high" || memory.pressureLevel === "critical") return true;
  const appPressureBytes = memory.appMemoryPressureBytes ?? memory.appResidentBytes ?? memory.processResidentBytes;
  const appShedBytes = memory.memoryHighBytes
    ? memory.memoryHighBytes * FEED_IMAGE_SHED_APP_HIGH_FRACTION
    : FEED_IMAGE_SHED_APP_PRESSURE_BYTES;
  if (appPressureBytes >= appShedBytes) return true;
  const webkitFootprintBytes = Math.max(
    memory.webkitTotalFootprintBytes ?? 0,
    memory.webkitLargestFootprintBytes ?? 0,
    memory.webkitFootprintBytes ?? 0,
  );
  const webkitResidentBytes = Math.max(
    memory.webkitTotalResidentBytes ?? 0,
    memory.webkitLargestResidentBytes ?? 0,
    memory.webkitResidentBytes ?? 0,
  );
  const webkitBytes = webkitFootprintBytes > 0 ? webkitFootprintBytes : webkitResidentBytes;
  const webkitShedBytes = memory.memoryHighBytes
    ? memory.memoryHighBytes * FEED_IMAGE_SHED_WEBKIT_HIGH_FRACTION
    : FEED_IMAGE_SHED_WEBKIT_BYTES;
  return webkitBytes >= webkitShedBytes;
}

function useFeedImageBudget(feedMediaPreviews: "inline" | "reader-only"): {
  showInlineMedia: boolean;
  showAvatarImages: boolean;
} {
  const shedImages = useDebugStore((state) => shouldShedFeedImages(state.runtimeMemory));
  return {
    showInlineMedia: feedMediaPreviews === "inline" && !shedImages,
    showAvatarImages: !shedImages,
  };
}

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

function cardPreviewText(text: string | undefined, limit: number): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= limit) return trimmed;

  const boundary = Math.max(
    trimmed.lastIndexOf(" ", limit - 3),
    trimmed.lastIndexOf("\n", limit - 3),
  );
  const end = boundary > Math.floor(limit * 0.6) ? boundary : limit - 3;
  return `${trimmed.slice(0, end).trimEnd()}...`;
}

export const FeedItem = memo(function FeedItem({
  item,
  onClick,
  showEngagement = false,
  showReadInGrayscale = true,
  focused = false,
  compact = false,
  narrow = false,
  selected = false,
  onMouseEnter,
  onSave,
  onArchive,
  onLike,
  density = "comfortable",
  storyHeight = 288,
  fixedHeight,
}: FeedItemProps) {
  const { feedMediaPreviews = "inline", sampleMediaPreviews } = usePlatform();
  const showSampleMedia = sampleMediaPreviews === "inline" && isSamplePreviewItem(item);
  const feedMediaPreviewMode = item.contentType === "story" || showSampleMedia ? "inline" : feedMediaPreviews;
  const { showInlineMedia, showAvatarImages } = useFeedImageBudget(feedMediaPreviewMode);
  const isTouchMobileDevice = useIsMobileDevice();
  const hasTouchOnlyPointer = useHasTouchOnlyPointer();
  const quickActionsEnabled = !isTouchMobileDevice && !hasTouchOnlyPointer;
  const sharedTransitionStyle = {
    viewTransitionName: feedCardTransitionName(item.globalId),
  } as React.CSSProperties;
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const platformIcon = platformIcons[item.platform] ?? <span className="text-xs">📄</span>;
  const isRead = Boolean(item.userState.readAt);
  const readVisualClass = isRead && showReadInGrayscale ? "grayscale opacity-60 hover:grayscale-0 hover:opacity-100 !transition-[filter,opacity] duration-300 motion-reduce:transition-none" : "";
  const reactions = PLATFORM_REACTIONS[item.platform] ?? [];
  const hasReactionPalette = reactions.length > 1;
  const likeCount = formatEngagementCount(item.engagement?.likes);
  const semanticLabel = semanticChip(item);
  const firstMediaUrl = item.content.mediaUrls[0];
  const photoCardRef = useRef<HTMLElement>(null);
  const [showPhotoTime, setShowPhotoTime] = useState(false);
  const [photoSizing, setPhotoSizing] = useState({ padding: 8, avatar: 16 });
  useLayoutEffect(() => {
    const card = photoCardRef.current;
    if (!card) return;
    const measure = () => {
      const shortSide = Math.min(card.clientWidth, card.clientHeight);
      setShowPhotoTime(card.clientHeight >= 220);
      setPhotoSizing({
        padding: Math.max(4, Math.min(20, shortSide * 0.06)),
        avatar: Math.max(16, Math.min(40, shortSide * 0.14)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [compact, item.contentType]);
  const compactPreview = cardPreviewText(item.content.text, COMPACT_CARD_TEXT_LIMIT);
  const compactWords = compactPreview?.split(/\s+/) ?? [];
  const compactPreviewText = compactWords.length > COMPACT_CARD_WORD_LIMIT
    ? `${compactWords.slice(0, COMPACT_CARD_WORD_LIMIT).join(" ")}…`
    : compactPreview;
  const compactTextAreaRef = useRef<HTMLDivElement>(null);
  const [compactTextLines, setCompactTextLines] = useState(0);
  useLayoutEffect(() => {
    const area = compactTextAreaRef.current;
    if ((!compact && item.contentType !== "story") || !area) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const text = area.querySelector("p");
      if (!text) return;
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
      if (lineHeight > 0) {
        const title = area.querySelector("h3");
        const titleStyle = title ? getComputedStyle(title) : null;
        const titleHeight = title ? title.offsetHeight + Number.parseFloat(titleStyle!.marginTop) + Number.parseFloat(titleStyle!.marginBottom) : 0;
        const areaStyle = getComputedStyle(area);
        const padding = Number.parseFloat(areaStyle.paddingTop) + Number.parseFloat(areaStyle.paddingBottom);
        // Only allocate complete lines inside the content box, never its padding.
        setCompactTextLines(Math.max(0, Math.floor((area.clientHeight - padding - titleHeight) / lineHeight)));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    const title = area.querySelector("h3");
    if (title) observer.observe(title);
    // Theme fonts can settle after the card's outer dimensions stop changing.
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [compact, narrow, item.globalId, item.contentType, compactPreviewText, item.content.linkPreview?.title]);
  const fixedPreviewText = cardPreviewText(item.content.text, FIXED_CARD_TEXT_LIMIT);
  const fullPreviewText = cardPreviewText(item.content.text, FULL_CARD_TEXT_LIMIT);

  const [swipeX, setSwipeX] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const fullCardDensity = {
    compact: {
      article: "p-3",
      padding: "12px",
      headerGap: "gap-2 mb-2",
      avatarSize: 32,
      author: "text-sm",
      meta: "text-[0.6875rem]",
      title: "mb-1 line-clamp-1 text-base leading-snug",
      body: "mb-2 line-clamp-2 text-sm leading-relaxed",
      chipWrap: "mb-2 gap-1.5",
      chip: "px-2 py-0.5 text-[0.6875rem]",
      mediaWrap: "mt-2 rounded-lg",
      media: "h-36 sm:h-40",
      tagWrap: "mt-2 gap-1.5",
    },
    comfortable: {
      article: "",
      padding: "20px",
      headerGap: "gap-3 mb-3",
      avatarSize: 40,
      author: "",
      meta: "text-xs",
      title: "mb-1.5 line-clamp-2 text-lg leading-snug",
      body: "mb-3 line-clamp-3 text-sm leading-[1.6]",
      chipWrap: "mb-3 gap-2",
      chip: "px-2.5 py-1 text-xs",
      mediaWrap: "mt-3 rounded-xl",
      media: "h-48 sm:h-56",
      tagWrap: "mt-3 gap-2",
    },
    expansive: {
      article: "p-6",
      padding: "24px",
      headerGap: "gap-3.5 mb-4",
      avatarSize: 44,
      author: "text-[1.0625rem]",
      meta: "text-sm",
      title: "mb-2 line-clamp-3 text-xl leading-snug",
      body: "mb-4 line-clamp-5 text-sm leading-[1.6]",
      chipWrap: "mb-4 gap-2",
      chip: "px-3 py-1.5 text-xs",
      mediaWrap: "mt-4 rounded-xl",
      media: "h-64 sm:h-72",
      tagWrap: "mt-4 gap-2",
    },
  }[density];
  const fixedCardDensity = {
    compact: {
      article: "!p-0",
      contentPadding: "p-4",
      gap: "gap-2.5",
      headerGap: "mb-1.5 gap-2",
      avatarSize: 28,
      author: "text-[0.8125rem]",
      handle: "text-xs",
      meta: "text-[0.6875rem]",
      title: "mb-0.5 line-clamp-1 text-sm leading-snug",
      bodyWithMedia: "line-clamp-1 text-xs leading-relaxed",
      bodyWithoutMedia: "line-clamp-2 text-xs leading-relaxed",
      chipWrap: "gap-1 pt-1.5",
      chip: "px-2 py-0.5 text-[0.6875rem]",
      tagLimitWithMedia: 0,
      tagLimitWithoutMedia: 1,
    },
    comfortable: {
      article: "!p-0",
      contentPadding: "p-5",
      gap: "gap-4",
      headerGap: "mb-3 gap-3",
      avatarSize: 40,
      author: "",
      handle: "text-sm",
      meta: "text-xs",
      title: "mb-1.5 line-clamp-2 text-lg leading-snug",
      bodyWithMedia: "line-clamp-3 text-sm leading-[1.6]",
      bodyWithoutMedia: "line-clamp-4 text-sm leading-[1.6]",
      chipWrap: "gap-2 pt-3",
      chip: "px-2.5 py-1 text-xs",
      tagLimitWithMedia: 2,
      tagLimitWithoutMedia: 4,
    },
    expansive: {
      article: "!p-0",
      contentPadding: "p-6",
      gap: "gap-5",
      headerGap: "mb-4 gap-3.5",
      avatarSize: 44,
      author: "text-[1.0625rem]",
      handle: "text-sm",
      meta: "text-sm",
      title: "mb-2 line-clamp-3 text-xl leading-snug",
      bodyWithMedia: "line-clamp-5 text-sm leading-[1.6]",
      bodyWithoutMedia: "line-clamp-6 text-sm leading-[1.6]",
      chipWrap: "gap-2 pt-4",
      chip: "px-3 py-1.5 text-xs",
      tagLimitWithMedia: 3,
      tagLimitWithoutMedia: 6,
    },
  }[density];
  const showFixedMedia = showInlineMedia && firstMediaUrl && !mediaFailed;
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeLocked = useRef<"horizontal" | "vertical" | null>(null);

  useEffect(() => {
    setMediaFailed(false);
  }, [firstMediaUrl, item.globalId]);

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
  const enableSwipe = quickActionsEnabled && !compact && !!onArchive && !item.userState.saved;
  const handleActivateClick = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.focus();
    onClick?.();
  };
  const handleActivateKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.();
  };

  if (compact || item.contentType === "story") {
    const showCompactMedia = showInlineMedia && firstMediaUrl && !mediaFailed;
    const thumbnailTitle = item.content.linkPreview?.title || "";

    return (
      <div className="relative overflow-hidden rounded-[var(--feed-card-radius)]" style={sharedTransitionStyle}>
        <article
          ref={photoCardRef}
          data-feed-item-id={item.globalId}
          data-focused={focused ? "true" : "false"}
          data-selected={selected ? "true" : "false"}
          className={`feed-card group relative min-w-0 cursor-pointer ${compact ? "aspect-square" : ""} overflow-hidden flex flex-col transition-colors ${
            selected
              ? "border-l-2 border-l-[var(--theme-accent-secondary)] bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)]"
              : quickActionsEnabled
                ? "hover:bg-[var(--theme-bg-muted)]"
                : ""
          } ${readVisualClass}`}
          style={{ ...FEED_CARD_LAYOUT_CONTAINMENT_STYLE, height: compact ? undefined : storyHeight, padding: photoSizing.padding / 2 }}
          onClick={handleActivateClick}
          onMouseEnter={onMouseEnter}
          role="button"
          tabIndex={0}
          onKeyDown={handleActivateKeyDown}
        >
          {!showCompactMedia && item.contentType === "story" && (
            <div className={`absolute inset-0 bg-gradient-to-br ${item.platform === "instagram" ? "from-[var(--theme-media-rss)] via-[var(--theme-media-instagram)] to-[var(--theme-accent-secondary)]" : "from-[var(--theme-media-facebook)] to-[var(--theme-media-linkedin)]"}`} />
          )}
          {showCompactMedia && (
            <>
              {item.content.mediaTypes[0] === "video" ? (
                <video
                  src={firstMediaUrl}
                  muted
                  playsInline
                  controls={!compact}
                  onClick={(event) => { if (!compact) event.stopPropagation(); }}
                  preload="metadata"
                  onError={() => setMediaFailed(true)}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
                />
              ) : (
              <img
                src={firstMediaUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setMediaFailed(true)}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
              />
              )}
              <div className="absolute inset-0 pointer-events-none transition-opacity duration-300 ease-out group-hover:opacity-0 motion-reduce:transition-none" style={{ background: "linear-gradient(to bottom, rgb(var(--theme-thumbnail-tint-rgb) / .3), rgb(var(--theme-thumbnail-tint-rgb) / .05), rgb(var(--theme-thumbnail-tint-rgb) / .7))" }} />
              <div className="pointer-events-none absolute inset-0 bg-[rgb(var(--theme-thumbnail-tint-rgb)/0.45)] transition-opacity duration-300 ease-out motion-reduce:transition-none group-hover:opacity-0" />
            </>
          )}

          {(
            <div className="relative flex min-w-0 shrink-0 items-center gap-2">
              <ChannelAvatar
                name={item.author.displayName}
                avatarUrl={showAvatarImages ? item.author.avatarUrl : null}
                size={photoSizing.avatar}
                className={`text-xs ring-1 ${showCompactMedia ? "ring-white/40" : "ring-white/10"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`truncate font-medium ${compact ? "text-xs" : fixedCardDensity.author} ${showCompactMedia ? "text-white drop-shadow" : ""}`}>{item.author.displayName}</span>
                </div>
                {showPhotoTime && (
                  <div className={`flex min-w-0 items-center gap-2 text-xs ${showCompactMedia ? "text-white/70" : "text-[var(--theme-text-muted)]"}`}>
                    <span className="flex shrink-0 items-center">{platformIcon}</span>
                    <span className="min-w-0 truncate">{timeAgo}</span>
                  </div>
                )}
              </div>

            </div>
          )}

          <div ref={compactTextAreaRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col justify-end overflow-hidden" style={{ padding: photoSizing.padding / 2 }}>
          {thumbnailTitle && (
            <h3 title={thumbnailTitle} className={`relative m-0 min-w-0 shrink-0 truncate font-semibold leading-[1.6] ${showCompactMedia ? "text-white drop-shadow transition-[opacity,transform] duration-300 ease-out group-hover:opacity-0 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none" : ""} ${compact ? (narrow ? "text-xs" : "text-sm") : "text-sm"}`}>
              {thumbnailTitle}
            </h3>
          )}

          {compactPreviewText && compactPreviewText !== thumbnailTitle && (
            <p style={{ display: compactTextLines ? "-webkit-box" : "none", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, Math.min(2, compactTextLines)), visibility: compactTextLines ? "visible" : "hidden" }} className={`m-0 min-w-0 shrink-0 overflow-hidden break-words ${showCompactMedia ? "text-white/85 drop-shadow transition-[opacity,transform] duration-300 ease-out group-hover:opacity-0 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none" : "text-[var(--theme-text-secondary)]"} ${compact ? (narrow ? "text-[0.625rem]" : "text-xs") : "text-sm"} leading-[1.6]`}>
              {compactPreviewText}
            </p>
          )}
          </div>

          <div className={`relative flex min-w-0 shrink-0 items-center gap-3 ${showCompactMedia ? "text-white/85 drop-shadow" : "text-[var(--theme-text-muted)]"}`}>
            {item.location?.name && (
              <span title={item.location.name} className={`ml-auto flex min-w-0 whitespace-nowrap items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] ${showCompactMedia ? "bg-[rgb(var(--theme-thumbnail-tint-rgb)/0.35)]" : "bg-[var(--theme-bg-muted)]"}`}>
                <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
                <span className="min-w-0 truncate">{item.location.name}</span>
              </span>
            )}
          </div>
        </article>
      </div>
    );
  }

  const likeStatus = likeState(item);
  const likeLabel = getLikeLabel(item, likeStatus);
  const visibleTags = fixedHeight
    ? item.userState.tags.slice(
        0,
        showFixedMedia
          ? fixedCardDensity.tagLimitWithMedia
          : fixedCardDensity.tagLimitWithoutMedia,
      )
    : item.userState.tags;

  if (fixedHeight) {
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
          ref={photoCardRef}
          data-feed-item-id={item.globalId}
          data-focused={focused ? "true" : "false"}
          data-feed-card-density={density}
          className={`feed-card group overflow-hidden min-w-0 cursor-pointer active:scale-[0.99] transition-transform ${fixedCardDensity.article} ${readVisualClass}`}
          style={{
            ...FEED_CARD_LAYOUT_CONTAINMENT_STYLE,
            height: fixedHeight,
            transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
            transition: swipeX === 0 ? "transform 0.25s ease" : undefined,
            willChange: swipeX !== 0 ? "transform" : undefined,
          }}
          onClick={handleActivateClick}
          onMouseEnter={onMouseEnter}
          onTouchStart={enableSwipe ? handleTouchStart : undefined}
          onTouchMove={enableSwipe ? handleTouchMove : undefined}
          onTouchEnd={enableSwipe ? handleTouchEnd : undefined}
          role="button"
          tabIndex={0}
          onKeyDown={handleActivateKeyDown}
        >
          <div className={`flex h-full min-h-0 min-w-0 transition-colors group-hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)] ${showFixedMedia ? "items-stretch" : "items-start"}`}>
            <div className="flex min-w-0 flex-1 flex-col" style={{ padding: photoSizing.padding / 2 }}>
              <div className={`flex min-w-0 items-center ${fixedCardDensity.headerGap}`}>
                <ChannelAvatar
                  name={item.author.displayName}
                  avatarUrl={showAvatarImages ? item.author.avatarUrl : null}
                  size={photoSizing.avatar}
                  className="text-lg ring-1 ring-white/10"
                />
                <div className="min-w-0 flex-1 -translate-y-0.5 leading-tight">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate font-medium ${fixedCardDensity.author}`}>{item.author.displayName}</span>
                  </div>
                  <div className={`flex min-w-0 items-center gap-2 ${fixedCardDensity.meta} text-[var(--theme-text-muted)]`}>
                    <span>{platformIcon}</span>
                    <span className="min-w-0 truncate">{timeAgo}</span>
                    {item.preservedContent?.readingTime && (
                      <>
                        <span>•</span>
                        <span>{item.preservedContent.readingTime} min</span>
                      </>
                    )}
                  </div>
                </div>

                {quickActionsEnabled ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {onLike && (
                      <div className="relative group/reactions">
                        {hasReactionPalette && (
                          <div className="pointer-events-none absolute right-0 bottom-full mb-2 flex translate-y-1 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-1 opacity-0 shadow-lg shadow-black/30 transition-all group-hover/reactions:pointer-events-auto group-hover/reactions:translate-y-0 group-hover/reactions:opacity-100 group-focus-within/reactions:pointer-events-auto group-focus-within/reactions:translate-y-0 group-focus-within/reactions:opacity-100">
                            {reactions.map((reaction) => (
                              <Tooltip key={reaction.label} label={reaction.label} side="top">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onLike(e as unknown as React.MouseEvent); }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-transform hover:scale-110 hover:bg-white/10"
                                  aria-label={reaction.label}
                                >
                                  <span aria-hidden="true">{reaction.emoji}</span>
                                </button>
                              </Tooltip>
                            ))}
                          </div>
                        )}

                        <Tooltip label={likeLabel} side="top">
                          <button
                            onClick={(e) => { e.stopPropagation(); onLike(e); }}
                            aria-label={likeLabel}
                            className={`${feedActionButtonClass} ${
                              likeStatus !== "none" ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            } ${
                              likeStatus === "synced"
                                ? "text-red-400"
                                : likeStatus === "noted"
                                ? "text-amber-400"
                                : likeStatus === "failed"
                                ? "text-orange-400"
                              : "text-[var(--theme-text-soft)] hover:text-red-400"
                            }`}
                          >
                            <svg className={feedActionIconClass} viewBox="0 0 24 24" fill={likeStatus !== "none" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                            {showEngagement && likeCount !== null && <span>{likeCount}</span>}
                            {likeStatus === "noted" && (
                              <svg className={`${feedActionStatusIconClass} animate-spin opacity-70`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            )}
                            {likeStatus === "failed" && (
                              <svg className={`${feedActionStatusIconClass} opacity-70`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    )}

                    {onSave && (
                      <Tooltip label={item.userState.saved ? "Remove bookmark" : "Bookmark"} side="top">
                        <button
                          onClick={onSave}
                          aria-label={item.userState.saved ? "Remove bookmark" : "Bookmark"}
                          className={`${feedIconActionButtonClass} ${
                            item.userState.saved
                              ? "text-[var(--theme-accent-secondary)]"
                              : "text-[var(--theme-text-soft)] hover:text-[var(--theme-accent-secondary)] opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <svg className={feedActionIconClass} fill={item.userState.saved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                          </svg>
                        </button>
                      </Tooltip>
                    )}

                    {onArchive && !item.userState.saved && (
                      <Tooltip label="Archive" side="top">
                        <button
                          onClick={onArchive}
                          aria-label="Archive"
                          className={`${feedIconActionButtonClass} text-[var(--theme-text-soft)] hover:text-[rgb(var(--theme-feedback-success-rgb))] opacity-0 group-hover:opacity-100`}
                        >
                          <TrashIcon className={feedActionIconClass} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ padding: photoSizing.padding / 2 }}>
              {item.content.linkPreview?.title && (
                <h3 className={`min-w-0 break-words font-semibold ${fixedCardDensity.title}`}>
                  {item.content.linkPreview.title}
                </h3>
              )}

              {fixedPreviewText && (
                <p className={`min-h-0 min-w-0 break-words text-[var(--theme-text-secondary)] ${showFixedMedia ? fixedCardDensity.bodyWithMedia : fixedCardDensity.bodyWithoutMedia}`}>
                  {fixedPreviewText}
                </p>
              )}
              </div>

              {(semanticLabel || visibleTags.length > 0) && (
                <div className={`mt-auto flex min-w-0 flex-wrap overflow-hidden ${fixedCardDensity.chipWrap}`}>
                  {semanticLabel && (
                    <span className={`theme-accent-tag max-w-full truncate rounded-full ${fixedCardDensity.chip}`}>
                      {semanticLabel}
                    </span>
                  )}
                  {visibleTags.map((tag) => (
                    <span
                      key={tag}
                      className={`theme-accent-tag max-w-full truncate rounded-full ${fixedCardDensity.chip}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {showFixedMedia && (
              <div
                className="relative h-full max-w-[50%] shrink-0"
                style={{
                  width: fixedHeight * 4 / 3,
                }}
              >
                <div className="absolute inset-y-0 -left-6 right-0 overflow-hidden" style={{
                  // Fade the media itself so every theme's actual card surface
                  // shows through, including its hover and read states.
                  maskImage: "linear-gradient(to right, transparent, black 48%)",
                  WebkitMaskImage: "linear-gradient(to right, transparent, black 48%)",
                }}>
                <img
                  src={firstMediaUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setMediaFailed(true)}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
                />
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[48%] opacity-20 mix-blend-soft-light" style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
                  backgroundSize: "160px 160px",
                  maskImage: "linear-gradient(to right, black, transparent)",
                  WebkitMaskImage: "linear-gradient(to right, black, transparent)",
                }} />
                </div>
              </div>
            )}
          </div>
        </article>
      </div>
    );
  }

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
        ref={photoCardRef}
        data-feed-item-id={item.globalId}
        data-focused={focused ? "true" : "false"}
        data-feed-card-density={density}
        className={`feed-card group hover:!bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)] min-w-0 cursor-pointer active:scale-[0.99] transition-transform ${fullCardDensity.article} ${readVisualClass}`}
        style={{
          ...FEED_CARD_LAYOUT_CONTAINMENT_STYLE,
          padding: photoSizing.padding / 2,
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: swipeX === 0 ? "transform 0.25s ease" : undefined,
          willChange: swipeX !== 0 ? "transform" : undefined,
        }}
        onClick={handleActivateClick}
        onMouseEnter={onMouseEnter}
        onTouchStart={enableSwipe ? handleTouchStart : undefined}
        onTouchMove={enableSwipe ? handleTouchMove : undefined}
        onTouchEnd={enableSwipe ? handleTouchEnd : undefined}
        role="button"
        tabIndex={0}
        onKeyDown={handleActivateKeyDown}
      >
        <div className={`flex min-w-0 items-center ${fullCardDensity.headerGap}`}>
          <ChannelAvatar
            name={item.author.displayName}
            avatarUrl={showAvatarImages ? item.author.avatarUrl : null}
            size={fullCardDensity.avatarSize}
            className="text-lg ring-1 ring-white/10"
          />
          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={`font-medium truncate ${fullCardDensity.author}`}>{item.author.displayName}</span>
            </div>
            <div className={`flex min-w-0 items-center gap-2 ${fullCardDensity.meta} text-[var(--theme-text-muted)]`}>
              <span>{platformIcon}</span>
              <span className="min-w-0 truncate">{timeAgo}</span>
              {item.preservedContent?.readingTime && (
                <>
                  <span>•</span>
                  <span>{item.preservedContent.readingTime} min</span>
                </>
              )}
            </div>
          </div>

          {quickActionsEnabled ? (
            <div className="flex items-center gap-1 shrink-0">
              {onLike && (
                <div className="relative group/reactions">
                  {hasReactionPalette && (
                    <div className="pointer-events-none absolute right-0 bottom-full mb-2 flex translate-y-1 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-1 opacity-0 shadow-lg shadow-black/30 transition-all group-hover/reactions:pointer-events-auto group-hover/reactions:translate-y-0 group-hover/reactions:opacity-100 group-focus-within/reactions:pointer-events-auto group-focus-within/reactions:translate-y-0 group-focus-within/reactions:opacity-100">
                      {reactions.map((reaction) => (
                        <Tooltip key={reaction.label} label={reaction.label} side="top">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onLike(e as unknown as React.MouseEvent); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-transform hover:scale-110 hover:bg-white/10"
                            aria-label={reaction.label}
                          >
                            <span aria-hidden="true">{reaction.emoji}</span>
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  )}

                  <Tooltip label={likeLabel} side="top">
                    <button
                      onClick={(e) => { e.stopPropagation(); onLike(e); }}
                      aria-label={likeLabel}
                      className={`${feedActionButtonClass} ${
                        likeStatus !== "none" ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      } ${
                        likeStatus === "synced"
                          ? "text-red-400"
                          : likeStatus === "noted"
                          ? "text-amber-400"
                          : likeStatus === "failed"
                          ? "text-orange-400"
                        : "text-[var(--theme-text-soft)] hover:text-red-400"
                      }`}
                    >
                      <svg className={feedActionIconClass} viewBox="0 0 24 24" fill={likeStatus !== "none" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      {showEngagement && likeCount !== null && <span>{likeCount}</span>}
                      {likeStatus === "noted" && (
                        <svg className={`${feedActionStatusIconClass} animate-spin opacity-70`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      {likeStatus === "failed" && (
                        <svg className={`${feedActionStatusIconClass} opacity-70`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      )}
                    </button>
                  </Tooltip>
                </div>
              )}

              {onSave && (
                <Tooltip label={item.userState.saved ? "Remove bookmark" : "Bookmark"} side="top">
                  <button
                    onClick={onSave}
                    aria-label={item.userState.saved ? "Remove bookmark" : "Bookmark"}
                    className={`${feedIconActionButtonClass} ${
                      item.userState.saved
                        ? "text-[var(--theme-accent-secondary)]"
                        : "text-[var(--theme-text-soft)] hover:text-[var(--theme-accent-secondary)] opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <svg className={feedActionIconClass} fill={item.userState.saved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {onArchive && !item.userState.saved && (
                <Tooltip label="Archive" side="top">
                  <button
                    onClick={onArchive}
                    aria-label="Archive"
                    className={`${feedIconActionButtonClass} text-[var(--theme-text-soft)] hover:text-[rgb(var(--theme-feedback-success-rgb))] opacity-0 group-hover:opacity-100`}
                  >
                    <TrashIcon className={feedActionIconClass} />
                  </button>
                </Tooltip>
              )}
            </div>
          ) : null}
        </div>

        {item.content.linkPreview?.title && (
          <h3 style={{ paddingInline: photoSizing.padding / 2 }} className={`min-w-0 break-words font-semibold ${fullCardDensity.title}`}>
            {item.content.linkPreview.title}
          </h3>
        )}

        {fullPreviewText && (
          <p style={{ paddingInline: photoSizing.padding / 2 }} className={`min-w-0 break-words ${fullCardDensity.body} text-[var(--theme-text-secondary)]`}>
            {fullPreviewText}
          </p>
        )}

        {semanticLabel && (
          <div className={`flex min-w-0 flex-wrap ${fullCardDensity.chipWrap}`}>
            <span className={`theme-accent-tag max-w-full truncate rounded-full ${fullCardDensity.chip}`}>
              {semanticLabel}
            </span>
          </div>
        )}

        {showInlineMedia && firstMediaUrl && !mediaFailed && (
          <div className={`${fullCardDensity.mediaWrap} overflow-hidden ring-1 ring-white/5`}>
            <img
              src={firstMediaUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setMediaFailed(true)}
              className={`w-full ${fullCardDensity.media} object-cover bg-white/5`}
            />
          </div>
        )}

        {visibleTags.length > 0 && (
          <div className={`flex min-w-0 flex-wrap ${fullCardDensity.tagWrap}`}>
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className={`theme-accent-tag max-w-full truncate rounded-full ${fullCardDensity.chip}`}
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
