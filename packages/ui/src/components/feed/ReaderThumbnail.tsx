import { useMemo, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem } from "@freed/shared";
import { RssIcon, FacebookIcon, InstagramIcon, YoutubeIcon, RedditIcon, GithubIcon, MastodonIcon } from "../icons.js";

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
};

interface ReaderThumbnailProps {
  item: FeedItem;
}

/**
 * Compact, read-only summary of the currently open feed item.
 * Rendered as the left panel in dual-column reading mode.
 */
export function ReaderThumbnail({ item }: ReaderThumbnailProps) {
  const timeAgo = useMemo(
    () => formatDistanceToNow(item.publishedAt, { addSuffix: true }),
    [item.publishedAt],
  );

  const platformIcon = platformIcons[item.platform] ?? <span className="text-xs">📄</span>;
  const title = item.content.linkPreview?.title;
  const heroImage = item.content.mediaUrls[0];

  return (
    <div className="w-80 shrink-0 border-r border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] overflow-y-auto minimal-scroll flex flex-col">
      <div className="p-4 flex flex-col gap-3">
        {/* Author */}
        <div className="flex items-center gap-3">
          {item.author.avatarUrl ? (
            <img
              src={item.author.avatarUrl}
              alt=""
              className="w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center font-medium shrink-0 text-lg">
              {item.author.displayName[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{item.author.displayName}</p>
            <p className="text-xs text-[#71717a] truncate">@{item.author.handle}</p>
          </div>
        </div>

        {/* Platform + time */}
        <div className="flex items-center gap-2 text-xs text-[#71717a]">
          <span>{platformIcon}</span>
          <span>{timeAgo}</span>
          {item.preservedContent?.readingTime && (
            <>
              <span>&middot;</span>
              <span>{item.preservedContent.readingTime} min</span>
            </>
          )}
        </div>

        {/* Title */}
        {title && (
          <h3 className="font-semibold text-sm leading-snug line-clamp-3">{title}</h3>
        )}

        {/* Preview text */}
        {item.content.text && (
          <p className="text-xs text-[#a1a1aa] leading-relaxed line-clamp-4">
            {item.content.text}
          </p>
        )}

        {/* Hero image */}
        {heroImage && (
          <div className="rounded-lg overflow-hidden ring-1 ring-white/5">
            <img
              src={heroImage}
              alt=""
              className="w-full h-36 object-cover bg-white/5"
            />
          </div>
        )}

        {/* Tags */}
        {item.userState.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.userState.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[10px] rounded-full bg-[#8b5cf6]/20 text-[#8b5cf6]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
