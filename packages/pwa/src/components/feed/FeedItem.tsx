import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";

interface FeedItemProps {
  item: FeedItemType;
  onClick?: () => void;
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

export function FeedItem({ item, onClick }: FeedItemProps) {
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const platformIcon = platformIcons[item.platform] || "📄";

  return (
    <article
      className="feed-card cursor-pointer active:scale-[0.99] transition-transform"
      onClick={onClick}
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
            className="w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center text-lg font-medium">
            {item.author.displayName[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {item.author.displayName}
            </span>
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

        {/* Save indicator */}
        {item.userState.saved && (
          <span className="text-[#8b5cf6]" title="Saved">
            📌
          </span>
        )}
      </div>

      {/* Title (for articles) */}
      {item.content.linkPreview?.title && (
        <h3 className="font-semibold text-lg mb-2 line-clamp-2 leading-snug">
          {item.content.linkPreview.title}
        </h3>
      )}

      {/* Content */}
      {item.content.text && (
        <p className="text-[#a1a1aa] line-clamp-3 mb-3 leading-relaxed">{item.content.text}</p>
      )}

      {/* Media preview */}
      {item.content.mediaUrls.length > 0 && (
        <div className="mt-3 rounded-xl overflow-hidden ring-1 ring-white/5">
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            className="w-full h-48 sm:h-56 object-cover bg-white/5"
          />
        </div>
      )}

      {/* Tags */}
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
  );
}
