import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { usePlatform } from "../../context/PlatformContext.js";
import { DESKTOP_FEED_CARD_HEIGHT_BY_DENSITY, type FeedCardDensity } from "../../lib/feed-card-density.js";
import { useDebugStore, type RuntimeMemorySnapshot } from "../../lib/debug-store.js";
import { useHasTouchOnlyPointer } from "../../hooks/useHasTouchOnlyPointer.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { ChannelAvatar } from "../ChannelAvatar.js";
import { isSamplePreviewItem } from "../../lib/sample-preview-media.js";
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
  /** Text-only activity preview, using the same bounded card structure. */
  summary?: boolean;
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
  /** Fixed primary-feed card height, shared by desktop and mobile virtualization. */
  fixedHeight?: number;
}

function feedCardTransitionName(globalId: string): string {
  return `feed-card-${globalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const cls = "w-3.5 h-3.5";
const SWIPE_THRESHOLD = 72;
const EVENT_CHIP_THRESHOLD = 0.7;
const COMPACT_CARD_TEXT_LIMIT = 500;
const COMPACT_CARD_WORD_LIMIT = 45;
const FIXED_CARD_TEXT_LIMIT = 900;
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
  showReadInGrayscale = true,
  focused = false,
  compact = false,
  summary = false,
  narrow = false,
  selected = false,
  onMouseEnter,
  onArchive,
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
  const semanticLabel = semanticChip(item);
  const firstMediaUrl = item.content.mediaUrls[0];
  // Layout is a presentation option, never a separate card implementation.
  const photoLayout = !summary && (compact || item.contentType === "story");
  const cardHeight = compact ? undefined : photoLayout ? storyHeight : fixedHeight ?? DESKTOP_FEED_CARD_HEIGHT_BY_DENSITY[density];
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
    if (!photoLayout || !area) return;
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
  }, [photoLayout, narrow, item.globalId, compactPreviewText, item.content.linkPreview?.title]);
  const previewText = cardPreviewText(summary
    ? item.content.text?.trim() || item.content.linkPreview?.title || "Open post"
    : item.content.text, FIXED_CARD_TEXT_LIMIT);

  const [swipeX, setSwipeX] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const cardDensity = {
    compact: {
      padding: "0.75rem",
      textInset: "0.375rem",
      headerGap: "mb-1.5 gap-2",
      author: "text-[0.8125rem]",
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
      padding: "1.25rem",
      textInset: "0.5rem",
      headerGap: "mb-3 gap-3",
      author: "",
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
      padding: "1.75rem",
      textInset: "0.75rem",
      headerGap: "mb-4 gap-3.5",
      author: "text-[1.0625rem]",
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
  const showMedia = !summary && showInlineMedia && firstMediaUrl && !mediaFailed;
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
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.();
  };

  const photoMedia = photoLayout && showMedia;
  const visibleTags = !photoLayout
    ? item.userState.tags.slice(
        0,
        showMedia
          ? cardDensity.tagLimitWithMedia
          : cardDensity.tagLimitWithoutMedia,
      )
    : [];

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
        data-feed-card-layout={summary ? "summary" : photoLayout ? "photo" : "split"}
        data-selected={selected ? "true" : "false"}
        className={`feed-card group relative overflow-hidden min-w-0 cursor-pointer active:scale-[0.99] transition-transform !p-0 ${summary ? "!rounded-2xl" : ""} ${quickActionsEnabled ? photoLayout ? "hover:!bg-[var(--theme-bg-muted)]" : "hover:!bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)]" : ""} ${compact ? "aspect-square" : ""} ${selected ? "border-l-2 border-l-[var(--theme-accent-secondary)] bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)]" : ""} ${readVisualClass}`}
        style={{
          ...FEED_CARD_LAYOUT_CONTAINMENT_STYLE,
          height: cardHeight,
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
        aria-label={summary ? `Read post: ${previewText}` : undefined}
        tabIndex={0}
        onKeyDown={handleActivateKeyDown}
      >

        {showMedia && (
          <div aria-hidden={item.content.mediaTypes[0] === "video" ? undefined : true} className="absolute inset-y-0 right-0 overflow-hidden" style={{
            width: photoLayout ? "100%" : `calc(50% + 1.5rem)`,
            maskImage: photoLayout ? undefined : "linear-gradient(to right, transparent, black 65%)",
            WebkitMaskImage: photoLayout ? undefined : "linear-gradient(to right, transparent, black 65%)",
          }}>
            {photoLayout && item.content.mediaTypes[0] === "video" ? (
              <video src={firstMediaUrl} muted playsInline controls={!compact} preload="metadata"
                onClick={(event) => { if (!compact) event.stopPropagation(); }}
                onError={() => setMediaFailed(true)} className="h-full w-full object-cover" />
            ) : (
              <img src={firstMediaUrl} alt="" loading="lazy" decoding="async"
                onError={() => setMediaFailed(true)}
                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none" />
            )}
            <div aria-hidden="true" className={`pointer-events-none absolute mix-blend-soft-light ${photoLayout ? "inset-0 opacity-15" : "inset-y-0 left-0 w-[65%] opacity-30"}`} style={{
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
                backgroundSize: "160px 160px",
                maskImage: photoLayout ? "linear-gradient(to bottom, black, transparent 40%, black)" : "linear-gradient(to right, black, transparent)",
                WebkitMaskImage: photoLayout ? "linear-gradient(to bottom, black, transparent 40%, black)" : "linear-gradient(to right, black, transparent)",
              }} />
            {photoLayout && <>
              <div className="absolute inset-0 pointer-events-none transition-opacity duration-300 ease-out group-hover:opacity-0 motion-reduce:transition-none" style={{ background: "linear-gradient(to bottom, rgb(var(--theme-thumbnail-tint-rgb) / .3), rgb(var(--theme-thumbnail-tint-rgb) / .05), rgb(var(--theme-thumbnail-tint-rgb) / .7))" }} />
              <div className="pointer-events-none absolute inset-0 bg-[rgb(var(--theme-thumbnail-tint-rgb)/0.45)] transition-opacity duration-300 ease-out motion-reduce:transition-none group-hover:opacity-0" />
            </>}
          </div>
        )}
        {!showMedia && photoLayout && item.contentType === "story" && (
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.platform === "instagram" ? "from-[var(--theme-media-rss)] via-[var(--theme-media-instagram)] to-[var(--theme-accent-secondary)]" : "from-[var(--theme-media-facebook)] to-[var(--theme-media-linkedin)]"}`} />
        )}
        <div className="relative flex h-full min-h-0 min-w-0 pointer-events-none">
          <div className="flex min-w-0 flex-col pointer-events-auto" style={{ padding: summary ? 12 : compact ? photoSizing.padding / 2 : cardDensity.padding, width: !photoLayout && showMedia ? "55%" : "100%" }}>

            <div className={`flex min-w-0 items-center ${photoLayout ? "gap-2" : cardDensity.headerGap}`} style={compact ? { padding: photoSizing.padding / 2 } : undefined}>
              {!summary && <ChannelAvatar
                name={item.author.displayName}
                avatarUrl={showAvatarImages ? item.author.avatarUrl : null}
                size={photoSizing.avatar}
                className={`text-xs ring-1 ${photoMedia ? "ring-white/40" : "ring-white/10"}`}
              />}
              <div className="min-w-0 flex-1 leading-tight" style={{ columnGap: "inherit" }}>
                {!summary && <div className="flex min-w-0 items-center" style={{ columnGap: "inherit" }}>
                  <span className={`truncate font-medium ${compact ? "text-xs" : cardDensity.author} ${photoMedia ? "text-white drop-shadow" : ""}`}>{item.author.displayName}</span>
                  <span className={`flex shrink-0 items-center ${photoLayout ? "ml-auto" : ""} ${photoMedia ? "text-white/70" : "text-[var(--theme-text-muted)]"}`}>{platformIcon}</span>
                </div>}
                {(!photoLayout || showPhotoTime) && <div className={`flex min-w-0 items-center gap-2 ${summary ? "justify-end" : "mt-0.5"} ${cardDensity.meta} ${photoMedia ? "text-white/70" : "text-[var(--theme-text-muted)]"}`}>
                  <span className="min-w-0 truncate">{timeAgo}</span>
                  {item.preservedContent?.readingTime && (
                    <>
                      <span>•</span>
                      <span>{item.preservedContent.readingTime} min</span>
                    </>
                  )}
                </div>}
              </div>

            </div>

            <div ref={compactTextAreaRef} className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${photoMedia ? "feed-card-photo-copy" : ""} ${photoLayout ? "justify-end" : "justify-center"}`} style={{ padding: summary ? 0 : compact ? photoSizing.padding / 2 : cardDensity.textInset }}>
              {!summary && item.content.linkPreview?.title && (
                <h3 className={`min-w-0 shrink-0 break-words font-semibold ${photoLayout ? "m-0 truncate leading-[1.6] " + (compact && narrow ? "text-xs" : "text-sm") : cardDensity.title} ${photoMedia ? "text-white drop-shadow" : ""}`}>
                  {item.content.linkPreview.title}
                </h3>
              )}

              {(photoLayout ? compactPreviewText : previewText) && (
                <p style={photoLayout ? { display: compactTextLines ? "-webkit-box" : "none", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, Math.min(2, compactTextLines)) } : undefined} className={`min-h-0 min-w-0 overflow-hidden break-words ${photoMedia ? "text-white/85 drop-shadow" : summary ? "text-[var(--theme-text-primary)]" : "text-[var(--theme-text-secondary)]"} ${photoLayout ? "m-0 shrink-0 leading-[1.6] " + (compact ? narrow ? "text-[0.625rem]" : "text-xs" : "text-sm") : summary ? "line-clamp-3 text-sm" : showMedia ? cardDensity.bodyWithMedia : cardDensity.bodyWithoutMedia}`}>
                  {photoLayout ? compactPreviewText : previewText}
                </p>
              )}
            </div>

            <div className={`relative flex min-w-0 shrink-0 items-center gap-3 ${photoMedia ? "text-white/85 drop-shadow" : "text-[var(--theme-text-muted)]"}`}>
              {!summary && item.location?.name && (
                <span title={item.location.name} className={`${photoLayout ? "ml-auto" : "mr-auto"} flex min-w-0 whitespace-nowrap items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] ${photoMedia ? "bg-[rgb(var(--theme-thumbnail-tint-rgb)/0.35)]" : "bg-[var(--theme-bg-muted)]"}`}>
                  <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                  </svg>
                  <span className="min-w-0 truncate">{item.location.name}</span>
                </span>
              )}
            </div>

            {(!compact && !summary && (semanticLabel || visibleTags.length > 0)) && (
              <div className={`mt-auto flex min-w-0 flex-wrap overflow-hidden ${cardDensity.chipWrap}`}>
                {semanticLabel && (
                  <span className={`theme-accent-tag max-w-full truncate rounded-full ${cardDensity.chip}`}>
                    {semanticLabel}
                  </span>
                )}
                {visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className={`theme-accent-tag max-w-full truncate rounded-full ${cardDensity.chip}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
});
