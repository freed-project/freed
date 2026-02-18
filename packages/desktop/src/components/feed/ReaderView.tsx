import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore } from "../../lib/store";
import { applyFocusMode, type FocusOptions } from "../../lib/focus-text";

interface ReaderViewProps {
  item: FeedItemType;
  onClose: () => void;
}

/** Strip HTML tags, returning plain text for focus mode rendering */
function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? "";
}

export function ReaderView({ item, onClose }: ReaderViewProps) {
  const updateItem = useAppStore((s) => s.updateItem);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const storedDisplay = useAppStore((s) => s.preferences.display);
  const [focusOptions, setFocusOptions] = useState<FocusOptions>({
    enabled: storedDisplay.reading.focusMode,
    intensity: storedDisplay.reading.focusIntensity,
  });

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

  const toggleFocus = () => {
    setFocusOptions((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      updatePreferences({
        display: {
          ...storedDisplay,
          reading: { focusMode: next.enabled, focusIntensity: next.intensity },
        },
      });
      return next;
    });
  };

  const hasContent = item.preservedContent?.html;
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });

  // For focus mode on HTML content: render as plain text with emphasis
  const plainText = hasContent
    ? htmlToText(item.preservedContent!.html)
    : item.content.text;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <span className="text-sm text-[#71717a] truncate flex-1">
            {item.author.displayName}
          </span>

          {/* Focus mode toggle */}
          <button
            onClick={toggleFocus}
            title={focusOptions.enabled ? "Disable focus mode" : "Enable focus mode"}
            className={`p-2 rounded-lg transition-colors text-sm font-bold ${
              focusOptions.enabled
                ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                : "hover:bg-white/10 text-[#71717a]"
            }`}
            aria-pressed={focusOptions.enabled}
            aria-label="Toggle focus reading mode"
          >
            <span aria-hidden="true">
              <span className="font-black">F</span>
              <span className="font-light text-xs">ocus</span>
            </span>
          </button>

          <button
            onClick={toggleSaved}
            className={`p-2 rounded-lg transition-colors ${
              item.userState.saved
                ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                : "hover:bg-white/10 text-[#a1a1aa]"
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
                : "hover:bg-white/10 text-[#a1a1aa]"
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
      <article className="max-w-3xl mx-auto px-6 py-8">
        {/* Meta */}
        <div className="mb-6">
          <div className="flex items-center gap-3 text-sm text-[#71717a] mb-4">
            <span className="font-medium text-[#a1a1aa]">{item.author.displayName}</span>
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
          <h1 className="text-3xl font-bold mb-4 leading-tight">
            {item.content.linkPreview?.title || item.content.text?.slice(0, 100)}
          </h1>

          {/* Source link */}
          {item.content.linkPreview?.url && (
            <a
              href={item.content.linkPreview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#8b5cf6] hover:text-[#a78bfa] text-sm font-medium transition-colors"
            >
              View original
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>

        {/* Featured image */}
        {item.content.mediaUrls[0] && (
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            className="w-full rounded-xl mb-8 bg-white/5 ring-1 ring-white/5"
          />
        )}

        {/* Content */}
        {focusOptions.enabled ? (
          // Focus mode: render as plain text with emphasis segments
          <div className="text-[#a1a1aa] text-lg leading-relaxed">
            <FocusText text={plainText ?? ""} options={focusOptions} />
          </div>
        ) : hasContent ? (
          // Rich HTML content
          <div
            className="prose prose-invert prose-lg max-w-none
              prose-headings:text-[#fafafa] prose-headings:font-semibold
              prose-p:text-[#a1a1aa] prose-p:leading-relaxed
              prose-a:text-[#8b5cf6] prose-a:no-underline hover:prose-a:underline
              prose-strong:text-[#fafafa] prose-strong:font-semibold
              prose-code:text-[#8b5cf6] prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-[#141414] prose-pre:border prose-pre:border-[rgba(255,255,255,0.08)] prose-pre:rounded-xl
              prose-blockquote:border-l-[#8b5cf6] prose-blockquote:text-[#a1a1aa] prose-blockquote:bg-white/5 prose-blockquote:rounded-r-xl prose-blockquote:py-1
              prose-img:rounded-xl prose-img:ring-1 prose-img:ring-white/5
              prose-li:text-[#a1a1aa]"
            dangerouslySetInnerHTML={{ __html: item.preservedContent!.html }}
          />
        ) : (
          // Plain text
          <div className="text-[#a1a1aa] text-lg leading-relaxed">
            {item.content.text}
          </div>
        )}

        {/* Tags */}
        {item.userState.tags.length > 0 && (
          <div className="mt-8 pt-8 border-t border-[rgba(255,255,255,0.08)]">
            <h3 className="text-sm font-medium text-[#71717a] mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {item.userState.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 text-sm rounded-full bg-[#8b5cf6]/20 text-[#8b5cf6]"
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

/** Renders text with focus mode bolding applied to word beginnings */
function FocusText({ text, options }: { text: string; options: FocusOptions }) {
  const segments = applyFocusMode(text, options);
  return (
    <>
      {segments.map((seg, i) =>
        seg.emphasis ? (
          <strong key={i} className="text-[#fafafa] font-bold">
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
