import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";

interface FeedItemProps {
  item: FeedItemType;
  onClick?: () => void;
  compact?: boolean;
  showEngagement?: boolean;
}

const platformIcons: Record<string, string> = {
  x: "𝕏",
  rss: "📡",
  youtube: "▶️",
  reddit: "🔴",
  mastodon: "🐘",
  github: "🐙",
  facebook: "📘",
  instagram: "📸",
  saved: "📌",
};

export function FeedItem({ item, onClick, compact = false, showEngagement = false }: FeedItemProps) {
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const platformIcon = platformIcons[item.platform] || "📄";
  const avatarSize = compact ? "w-8 h-8" : "w-10 h-10";

  return (
    <article
      className={`feed-card cursor-pointer active:scale-[0.99] transition-transform ${compact ? "py-2.5 px-3.5" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
    >
      {/* Author row */}
      <div className={`flex items-center gap-3 ${compact ? "mb-1.5" : "mb-3"}`}>
        {item.author.avatarUrl ? (
          <img
            src={item.author.avatarUrl}
            alt=""
            className={`${avatarSize} rounded-full bg-white/5 ring-1 ring-white/10 shrink-0`}
          />
        ) : (
          <div className={`${avatarSize} rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center font-medium shrink-0 ${compact ? "text-base" : "text-lg"}`}>
            {item.author.displayName[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {item.author.displayName}
            </span>
            {!compact && (
              <span className="text-[#71717a] text-sm">@{item.author.handle}</span>
            )}
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

        {/* Save indicator */}
        {item.userState.saved && (
          <span className="text-[#8b5cf6]" title="Saved">
            📌
          </span>
        )}
      </div>

      {/* Title (for articles) */}
      {item.content.linkPreview?.title && (
        <h3 className={`font-semibold mb-1.5 line-clamp-2 leading-snug ${compact ? "text-base" : "text-lg"}`}>
          {item.content.linkPreview.title}
        </h3>
      )}

      {/* Content */}
      {item.content.text && (
        <p className={`text-[#a1a1aa] leading-relaxed ${compact ? "line-clamp-2 mb-1.5 text-sm" : "line-clamp-3 mb-3"}`}>
          {item.content.text}
        </p>
      )}

      {/* Media preview — hidden in compact mode */}
      {!compact && item.content.mediaUrls.length > 0 && (
        <div className="mt-3 rounded-xl overflow-hidden ring-1 ring-white/5">
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            className="w-full h-48 sm:h-56 object-cover bg-white/5"
          />
        </div>
      )}

      {/* Engagement counts — opt-in only */}
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

      {/* Tags — hidden in compact mode */}
      {!compact && item.userState.tags.length > 0 && (
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
  );
}
