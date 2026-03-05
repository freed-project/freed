import { useState, useEffect, useMemo, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore, usePlatform, MACOS_TRAFFIC_LIGHT_INSET } from "../../context/PlatformContext.js";
import { applyFocusMode, type FocusOptions } from "@freed/shared";

interface ReaderViewProps {
  item: FeedItemType;
  onClose: () => void;
}

/** Content source labels for the offline badge */
type ContentSource = "cache" | "text" | "live" | null;

/** Strip HTML tags, returning plain text for focus mode rendering */
function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? "";
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const PROSE_CLASSES = `
  prose prose-invert prose-lg max-w-none
  prose-headings:text-[#fafafa] prose-headings:font-semibold
  prose-p:text-[#a1a1aa] prose-p:leading-relaxed
  prose-a:text-[#8b5cf6] prose-a:no-underline hover:prose-a:underline
  prose-strong:text-[#fafafa] prose-strong:font-semibold
  prose-code:text-[#8b5cf6] prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
  prose-pre:bg-[#141414] prose-pre:border prose-pre:border-[rgba(255,255,255,0.08)] prose-pre:rounded-xl
  prose-blockquote:border-l-[#8b5cf6] prose-blockquote:text-[#a1a1aa] prose-blockquote:bg-white/5 prose-blockquote:rounded-r-xl prose-blockquote:py-1
  prose-img:rounded-xl prose-img:ring-1 prose-img:ring-white/5
  prose-li:text-[#a1a1aa]
`.trim();

export function ReaderView({ item, onClose }: ReaderViewProps) {
  const { headerDragRegion, getLocalContent } = usePlatform();
  const updateItem = useAppStore((s) => s.updateItem);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const storedDisplay = useAppStore((s) => s.preferences.display);

  const [focusOptions, setFocusOptions] = useState<FocusOptions>({
    enabled: storedDisplay.reading.focusMode,
    intensity: storedDisplay.reading.focusIntensity,
  });

  // Content waterfall state
  const [html, setHtml] = useState<string | null>(null);
  const [contentSource, setContentSource] = useState<ContentSource>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCaching, setIsCaching] = useState(false);

  const articleUrl = item.content.linkPreview?.url;

  // ─── Content waterfall ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadContent() {
      setIsLoading(true);

      // Layer 1: Device-local content cache (desktop: Tauri FS, PWA: Cache API)
      if (getLocalContent) {
        // Desktop path -- platform provides Tauri FS backed cache
        const cached = await getLocalContent(item.globalId);
        if (!cancelled && cached) {
          setHtml(cached);
          setContentSource("cache");
          setIsLoading(false);
          return;
        }
      } else if (articleUrl && "caches" in window) {
        // PWA path -- check the Workbox-managed Cache API
        try {
          const cache = await caches.open("freed-articles-v1");
          const cachedResponse = await cache.match(articleUrl);
          if (cachedResponse) {
            const text = await cachedResponse.text();
            if (!cancelled && text) {
              setHtml(text);
              setContentSource("cache");
              setIsLoading(false);
              return;
            }
          }
        } catch {
          // Cache API unavailable -- continue waterfall
        }
      }

      // Layer 2: preservedContent.text -- always available for imported items
      if (item.preservedContent?.text) {
        if (!cancelled) {
          // Render text as a simple HTML block for consistent styling
          const escaped = item.preservedContent.text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n\n+/g, "</p><p>")
            .replace(/\n/g, "<br>");
          setHtml(`<p>${escaped}</p>`);
          setContentSource("text");
          setIsLoading(false);
        }

        // Still try a live fetch to get the full HTML (async, non-blocking)
        if (articleUrl && navigator.onLine) {
          liveFetch(articleUrl, item.globalId, cancelled, (h) => {
            if (!cancelled) {
              setHtml(h);
              setContentSource("live");
              setIsCaching(false);
            }
          });
        }
        return;
      }

      // Layer 3: Live fetch (online only)
      if (articleUrl && navigator.onLine) {
        setIsCaching(true);
        liveFetch(
          articleUrl,
          item.globalId,
          cancelled,
          (h) => {
            if (!cancelled) {
              setHtml(h);
              setContentSource("live");
              setIsCaching(false);
              setIsLoading(false);
            }
          },
          () => {
            // Fetch failed (CORS, network error, non-2xx) -- show feed preview text
            if (!cancelled) {
              setHtml(null);
              setContentSource(null);
              setIsCaching(false);
              setIsLoading(false);
            }
          },
        );
      } else {
        // Offline and no cached content -- fall back to feed preview text
        if (!cancelled) {
          setHtml(null);
          setContentSource(null);
          setIsLoading(false);
        }
      }
    }

    loadContent().catch(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [item.globalId, articleUrl, getLocalContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSaved = useCallback(() => {
    const nowSaved = !item.userState.saved;
    updateItem(item.globalId, {
      userState: {
        ...item.userState,
        saved: nowSaved,
        // Omit savedAt when un-saving rather than setting undefined —
        // Automerge's proxy throws on undefined assignments.
        ...(nowSaved ? { savedAt: Date.now() } : {}),
      },
    });
  }, [updateItem, item.globalId, item.userState]);

  const handleToggleArchived = useCallback(() => {
    toggleArchived(item.globalId);
    // Close the reader when archiving — item leaves the active feed
    if (!item.userState.archived) onClose();
  }, [toggleArchived, item.globalId, item.userState.archived, onClose]);

  const toggleFocus = useCallback(() => {
    setFocusOptions((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      updatePreferences({
        display: {
          ...storedDisplay,
          reading: { ...storedDisplay.reading, focusMode: next.enabled, focusIntensity: next.intensity },
        },
      });
      return next;
    });
  }, [updatePreferences, storedDisplay]);

  const timeAgo = useMemo(
    () => formatDistanceToNow(item.publishedAt, { addSuffix: true }),
    [item.publishedAt],
  );

  // Parsing HTML into plain text for focus mode is expensive -- memoize it.
  const plainText = useMemo(
    () => (html ? htmlToText(html) : item.content.text),
    [html, item.content.text],
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-auto">
      {/* Header */}
      <header
        className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)]"
        {...(headerDragRegion
          ? {
              "data-tauri-drag-region": true,
              style: { WebkitAppRegion: "drag" } as React.CSSProperties,
            }
          : {})}
      >
        <div
          className="h-14 w-full px-3 flex items-center gap-2"
          style={headerDragRegion ? { paddingLeft: MACOS_TRAFFIC_LIGHT_INSET } : undefined}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-2 min-w-0 max-w-[50%] -ml-1 px-2 py-2 rounded-lg hover:bg-white/10 transition-colors group"
            style={headerDragRegion ? noDrag : undefined}
            aria-label="Back"
          >
            <svg
              className="w-5 h-5 shrink-0 text-[#71717a] group-hover:text-[#a1a1aa] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm text-[#71717a] group-hover:text-[#a1a1aa] truncate transition-colors">
              {item.author.displayName}
            </span>
          </button>

          <div className="flex-1" />

          {/* Offline / cached badge */}
          {contentSource === "cache" && (
            <span
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
              title="Served from your device cache"
            >
              Offline
            </span>
          )}
          {contentSource === "text" && (
            <span
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20"
              title="Showing text summary -- full content will load when online"
            >
              Summary
            </span>
          )}

          {/* Background caching spinner */}
          {isCaching && (
            <div
              className="w-4 h-4 border border-[#52525b] border-t-[#8b5cf6] rounded-full animate-spin"
              title="Loading full article..."
            />
          )}

          {/* Focus mode toggle */}
          <button
            onClick={toggleFocus}
            title={focusOptions.enabled ? "Disable focus mode" : "Enable focus mode"}
            className={`p-2 rounded-lg transition-colors text-sm font-bold ${
              focusOptions.enabled
                ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                : "hover:bg-white/10 text-[#71717a]"
            }`}
            style={headerDragRegion ? noDrag : undefined}
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
            style={headerDragRegion ? noDrag : undefined}
            aria-label={item.userState.saved ? "Unsave" : "Save"}
          >
            <svg
              className="w-5 h-5"
              fill={item.userState.saved ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>

          <button
            onClick={handleToggleArchived}
            className={`p-2 rounded-lg transition-colors ${
              item.userState.archived
                ? "bg-green-500/20 text-green-400"
                : "hover:bg-white/10 text-[#a1a1aa]"
            }`}
            style={headerDragRegion ? noDrag : undefined}
            aria-label={item.userState.archived ? "Unarchive" : "Archive"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </header>

      {/* Article content */}
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-20">
        {/* Meta */}
        <div className="mb-6">
          <div className="flex items-center gap-3 text-sm text-[#71717a] mb-4 flex-wrap">
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

          <h1 className="text-2xl sm:text-3xl font-bold mb-4 leading-tight">
            {item.content.linkPreview?.title || item.content.text?.slice(0, 100)}
          </h1>

          {articleUrl && (
            <a
              href={articleUrl}
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
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#27272a] border-t-[#8b5cf6] rounded-full animate-spin" />
          </div>
        ) : focusOptions.enabled ? (
          <div className="text-[#a1a1aa] text-lg leading-relaxed">
            <FocusText text={plainText ?? ""} options={focusOptions} />
          </div>
        ) : html ? (
          <div
            className={PROSE_CLASSES}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="text-[#a1a1aa] text-lg leading-relaxed">
            {item.content.text || (
              <span className="text-[#52525b] italic">
                No content available. Connect to the internet to load this article.
              </span>
            )}
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

/**
 * Live-fetch an article URL and cache it in the PWA Cache API.
 * Calls `onDone` with the extracted HTML on success, `onError` on any failure
 * (CORS block, non-2xx response, network error, or cancellation).
 */
async function liveFetch(
  url: string,
  globalId: string,
  cancelled: boolean,
  onDone: (html: string) => void,
  onError?: () => void,
): Promise<void> {
  try {
    const resp = await fetch(url);
    if (!resp.ok || cancelled) {
      onError?.();
      return;
    }
    const html = await resp.text();
    if (cancelled) return;

    // Cache in the PWA Cache API for offline access
    if ("caches" in window) {
      try {
        const cache = await caches.open("freed-articles-v1");
        await cache.put(url, new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
        // Also store by globalId for direct cache lookup
        await cache.put(`/content/${globalId}`, new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
      } catch {
        // Cache write failure is non-fatal
      }
    }

    onDone(html);
  } catch {
    // Network error, CORS block, or any other exception
    onError?.();
  }
}
