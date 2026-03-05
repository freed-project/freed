import { memo, useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { RssIcon, FacebookIcon, InstagramIcon, YoutubeIcon, RedditIcon, GithubIcon, MastodonIcon, BookmarkIcon } from "../icons.js";

interface FeedItemProps {
  item: FeedItemType;
  onClick?: () => void;
  showEngagement?: boolean;
  focused?: boolean;
  onMouseEnter?: () => void;
  onSave?: (e: React.MouseEvent) => void;
  onArchive?: (e: React.MouseEvent) => void;
}

const cls = "w-3.5 h-3.5";

const platformIcons: Record<string, ReactNode> = {
  x: <span className="text-xs font-bold leading-none">𝕏</span>,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  saved: <BookmarkIcon className={cls} />,
};

const SWIPE_THRESHOLD = 72;

export const FeedItem = memo(function FeedItem({
  item,
  onClick,
  showEngagement = false,
  focused = false,
  onMouseEnter,
  onSave,
  onArchive,
}: FeedItemProps) {
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const platformIcon = platformIcons[item.platform] ?? <span className="text-xs">📄</span>;

  // Swipe-to-archive state (mobile only)
  const [swipeX, setSwipeX] = useState(0);
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
      // Determine swipe axis on first meaningful move
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      swipeLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }

    if (swipeLocked.current === "vertical") return;

    // Only track leftward swipe
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

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Archive action revealed by swipe — only rendered when actively swiping */}
      {onArchive && swipeX < 0 && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-2xl transition-colors"
          style={{
            width: `${Math.abs(swipeX) + 16}px`,
            backgroundColor: pastThreshold ? "rgb(34 197 94 / 0.25)" : "rgb(34 197 94 / 0.12)",
          }}
          aria-hidden
        >
          <svg
            className="w-5 h-5 text-green-400 transition-transform"
            style={{ transform: `scale(${0.7 + swipeProgress * 0.3})`, opacity: swipeProgress }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      <article
        className={`feed-card group cursor-pointer active:scale-[0.99] transition-transform ${focused ? "ring-2 ring-[#8b5cf6]/60 ring-inset" : ""}`}
        style={{
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: swipeX === 0 ? "transform 0.25s ease" : undefined,
          willChange: swipeX !== 0 ? "transform" : undefined,
        }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onTouchStart={onArchive ? handleTouchStart : undefined}
        onTouchMove={onArchive ? handleTouchMove : undefined}
        onTouchEnd={onArchive ? handleTouchEnd : undefined}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      >
        {/* Author row */}
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
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center font-medium shrink-0 text-lg">
              {item.author.displayName[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{item.author.displayName}</span>
              <span className="text-[#71717a] text-sm">@{item.author.handle}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#71717a]">
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

          {/* Action buttons — shown on hover (desktop) */}
          <div className="flex items-center gap-0.5 shrink-0">
            {onSave && (
              <button
                onClick={onSave}
                title={item.userState.saved ? "Remove bookmark" : "Bookmark"}
                className={`p-1.5 rounded-lg transition-colors ${
                  item.userState.saved
                    ? "text-[#8b5cf6]"
                    : "text-[#52525b] hover:text-[#8b5cf6] opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg className="w-4 h-4" fill={item.userState.saved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}

            {onArchive && (
              <button
                onClick={onArchive}
                title="Archive"
                className="p-1.5 rounded-lg transition-colors text-[#52525b] hover:text-green-400 opacity-0 group-hover:opacity-100"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
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
          <p className="text-[#a1a1aa] leading-relaxed line-clamp-3 mb-3">
            {item.content.text}
          </p>
        )}

        {item.content.mediaUrls.length > 0 && (
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

        {showEngagement && item.engagement && (
          <div className="mt-2 flex items-center gap-4 text-xs text-[#52525b]">
            {item.engagement.likes !== undefined && (
              <span title="Likes">♥ {item.engagement.likes.toLocaleString()}</span>
            )}
            {item.engagement.reposts !== undefined && (
              <span title="Reposts">↺ {item.engagement.reposts.toLocaleString()}</span>
            )}
            {item.engagement.comments !== undefined && (
              <span title="Comments">💬 {item.engagement.comments.toLocaleString()}</span>
            )}
          </div>
        )}

        {item.userState.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.userState.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 text-xs rounded-full bg-[#8b5cf6]/20 text-[#8b5cf6]"
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
