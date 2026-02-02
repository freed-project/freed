import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore } from "../../lib/store";

interface ReaderViewProps {
  item: FeedItemType;
  onClose: () => void;
}

export function ReaderView({ item, onClose }: ReaderViewProps) {
  const updateItem = useAppStore((s) => s.updateItem);

  const toggleSaved = () => {
    updateItem(item.globalId, {
      userState: {
        ...item.userState,
        saved: !item.userState.saved,
        savedAt: item.userState.saved ? undefined : Date.now(),
      },
    });
  };

  const toggleArchived = () => {
    updateItem(item.globalId, {
      userState: {
        ...item.userState,
        archived: !item.userState.archived,
      },
    });
  };

  const hasContent = item.preservedContent?.html;
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });

  return (
    <div className="fixed inset-0 z-50 bg-[#121212] overflow-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-glass-primary/90 backdrop-blur-xl border-b border-glass-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div className="flex-1" />

          <button
            onClick={toggleSaved}
            className={`p-2 rounded-lg transition-colors ${
              item.userState.saved
                ? "bg-accent/20 text-accent"
                : "hover:bg-white/10"
            }`}
            aria-label={item.userState.saved ? "Unsave" : "Save"}
          >
            <svg
              className="w-5 h-5"
              fill={item.userState.saved ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
          </button>

          <button
            onClick={toggleArchived}
            className={`p-2 rounded-lg transition-colors ${
              item.userState.archived
                ? "bg-green-500/20 text-green-400"
                : "hover:bg-white/10"
            }`}
            aria-label={item.userState.archived ? "Unarchive" : "Archive"}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Article content */}
      <article className="max-w-3xl mx-auto px-4 py-8">
        {/* Meta */}
        <div className="mb-6">
          <div className="flex items-center gap-3 text-sm text-white/55 mb-4">
            <span>{item.author.displayName}</span>
            <span>•</span>
            <span>{timeAgo}</span>
            {item.preservedContent?.readingTime && (
              <>
                <span>•</span>
                <span>{item.preservedContent.readingTime} min read</span>
              </>
            )}
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold mb-4">
            {item.content.linkPreview?.title ||
              item.content.text?.slice(0, 100)}
          </h1>

          {/* Source link */}
          {item.content.linkPreview?.url && (
            <a
              href={item.content.linkPreview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover text-sm"
            >
              View original →
            </a>
          )}
        </div>

        {/* Featured image */}
        {item.content.mediaUrls[0] && (
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            className="w-full rounded-lg mb-8 bg-white/5"
          />
        )}

        {/* Content */}
        {hasContent ? (
          <div
            className="prose prose-invert prose-lg max-w-none
              prose-headings:text-white prose-headings:font-semibold
              prose-p:text-white/85 prose-p:leading-relaxed
              prose-a:text-accent prose-a:no-underline hover:prose-a:underline
              prose-strong:text-white prose-strong:font-semibold
              prose-code:text-accent prose-code:bg-white/5 prose-code:px-1 prose-code:rounded
              prose-pre:bg-white/5 prose-pre:border prose-pre:border-glass-border
              prose-blockquote:border-l-accent prose-blockquote:text-white/70
              prose-img:rounded-lg"
            dangerouslySetInnerHTML={{ __html: item.preservedContent!.html }}
          />
        ) : (
          <div className="text-white/70 text-lg leading-relaxed">
            {item.content.text}
          </div>
        )}

        {/* Tags */}
        {item.userState.tags.length > 0 && (
          <div className="mt-8 pt-8 border-t border-glass-border">
            <h3 className="text-sm font-medium text-white/55 mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {item.userState.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-sm rounded-full bg-accent/20 text-accent"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
