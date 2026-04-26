import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import {
  useAppStore,
  usePlatform,
  MACOS_TRAFFIC_LIGHT_INSET,
  type ReaderHydrationResult,
  type ReaderThreadReply,
} from "../../context/PlatformContext.js";
import { applyFocusMode, type FocusOptions } from "@freed/shared";
import { cacheArticleHtml, warmArticleImageCache } from "../../lib/article-cache.js";
import {
  getReaderOfflineCacheMode,
  shouldPinOpenedReaderItem,
} from "../../lib/reader-cache-settings.js";
import { Tooltip } from "../Tooltip.js";
import { ExternalLinkIcon, TrashIcon } from "../icons.js";

interface ReaderViewProps {
  item: FeedItemType;
  onClose: () => void;
  /** When true, renders inline as a flex child instead of a fixed overlay */
  dualColumn?: boolean;
  /** When true, renders inline within the workspace shell and hides the local header. */
  inline?: boolean;
  onOpenUrl?: (url: string) => void;
}

/** Content source labels for the offline badge */
type ContentSource = "cache" | "text" | "live" | null;
type HydrationStatus = NonNullable<ReaderHydrationResult["status"]> | null;

// ─── Structured content parser ───────────────────────────────────────────────
//
// Converts HTML into an array of typed content blocks using DOMParser. No HTML
// is ever injected back into the DOM. We read data (textContent, src, alt) from
// the parsed tree and render React elements ourselves. Secure by construction.

type ContentBlock =
  | { kind: "text"; content: string }
  | { kind: "heading"; level: number; content: string }
  | { kind: "image"; src: string; alt: string; caption?: string }
  | { kind: "blockquote"; content: string }
  | { kind: "code"; content: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "ul", "ol", "figure", "section",
  "article", "main", "header", "footer", "aside", "nav",
]);

function isAllowedImageSrc(src: string): boolean {
  try {
    const parsed = new URL(src, "https://placeholder.invalid");
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Parse HTML into structured content blocks via DOMParser. */
function parseArticleBlocks(html: string): ContentBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: ContentBlock[] = [];

  function pushText(text: string | null | undefined): void {
    const trimmed = text?.trim();
    if (trimmed) blocks.push({ kind: "text", content: trimmed });
  }

  function pushImage(el: Element): void {
    const src = el.getAttribute("src");
    if (src && isAllowedImageSrc(src)) {
      blocks.push({ kind: "image", src, alt: el.getAttribute("alt") ?? "" });
    }
  }

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = el.textContent?.trim();
      if (text) blocks.push({ kind: "heading", level: parseInt(tag[1]), content: text });
      return;
    }

    if (tag === "img") { pushImage(el); return; }

    if (tag === "picture") {
      const img = el.querySelector("img");
      if (img) pushImage(img);
      return;
    }

    if (tag === "figure") {
      const img = el.querySelector("img");
      const caption = el.querySelector("figcaption");
      if (img) {
        const src = img.getAttribute("src");
        if (src && isAllowedImageSrc(src)) {
          blocks.push({
            kind: "image",
            src,
            alt: img.getAttribute("alt") ?? "",
            caption: caption?.textContent?.trim() || undefined,
          });
        }
      } else {
        for (const child of el.childNodes) processNode(child);
      }
      return;
    }

    if (tag === "blockquote") {
      const text = el.textContent?.trim();
      if (text) blocks.push({ kind: "blockquote", content: text });
      return;
    }

    if (tag === "pre") {
      const text = el.textContent?.trim();
      if (text) blocks.push({ kind: "code", content: text });
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.querySelectorAll(":scope > li"))
        .map((li) => li.textContent?.trim() ?? "")
        .filter(Boolean);
      if (items.length > 0) {
        blocks.push({ kind: "list", ordered: tag === "ol", items });
      }
      return;
    }

    // Container elements: if they contain nested blocks, recurse; otherwise
    // treat as a leaf paragraph and extract text + any embedded images.
    if (tag === "p" || tag === "div" || tag === "section" ||
        tag === "article" || tag === "main" || tag === "aside") {
      const hasNestedBlocks = Array.from(el.children).some(
        (c) => BLOCK_TAGS.has(c.tagName.toLowerCase()) || c.tagName.toLowerCase() === "img",
      );

      if (hasNestedBlocks) {
        for (const child of el.childNodes) processNode(child);
      } else {
        pushText(el.textContent);
      }
      return;
    }

    // Inline elements (span, a, em, strong, etc.): recurse into children
    for (const child of el.childNodes) processNode(child);
  }

  for (const child of doc.body.childNodes) processNode(child);

  // Deduplicate consecutive identical text blocks (DOMParser artifact)
  return blocks.filter((block, i) => {
    if (block.kind !== "text") return true;
    if (i === 0) return true;
    const prev = blocks[i - 1];
    return !(prev.kind === "text" && prev.content === block.content);
  });
}

/** Convert plain text (preservedContent.text) to content blocks. */
function textToBlocks(text: string): ContentBlock[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((content) => ({ kind: "text" as const, content }));
}

/** Extract plain text from HTML for focus mode. Uses DOMParser (no execution). */
function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}

// ─── Heading size classes by level ───────────────────────────────────────────

const HEADING_CLASSES: Record<number, string> = {
  1: "mt-8 mb-3 text-2xl font-semibold text-[var(--theme-text-primary)]",
  2: "mt-8 mb-3 text-xl font-semibold text-[var(--theme-text-primary)]",
  3: "mt-6 mb-2 text-lg font-semibold text-[var(--theme-text-primary)]",
  4: "mt-4 mb-2 text-base font-semibold text-[var(--theme-text-primary)]",
  5: "mt-4 mb-2 text-base font-medium text-[var(--theme-text-primary)]",
  6: "mt-4 mb-2 text-sm font-medium text-[var(--theme-text-primary)]",
};

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function ReaderView({ item, onClose, dualColumn = false, inline = false, onOpenUrl }: ReaderViewProps) {
  const {
    headerDragRegion,
    getLocalContent,
    getLocalPreservedText,
    hydrateReaderItem,
    pinReaderItem,
  } = usePlatform();
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const storedDisplay = useAppStore((s) => s.preferences.display);

  const [focusOptions, setFocusOptions] = useState<FocusOptions>({
    enabled: storedDisplay.reading.focusMode,
    intensity: storedDisplay.reading.focusIntensity,
  });
  const storedDisplayRef = useRef(storedDisplay);

  useEffect(() => {
    storedDisplayRef.current = storedDisplay;
  }, [storedDisplay]);

  useEffect(() => {
    setFocusOptions({
      enabled: storedDisplay.reading.focusMode,
      intensity: storedDisplay.reading.focusIntensity,
    });
  }, [storedDisplay.reading.focusIntensity, storedDisplay.reading.focusMode]);

  // Content waterfall state
  const [html, setHtml] = useState<string | null>(null);
  const [preservedText, setPreservedText] = useState<string | null>(item.preservedContent?.text ?? null);
  const [contentSource, setContentSource] = useState<ContentSource>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCaching, setIsCaching] = useState(false);
  const [hydrationStatus, setHydrationStatus] = useState<HydrationStatus>(null);
  const [hydrationMessage, setHydrationMessage] = useState<string | null>(null);
  const [readerMediaUrls, setReaderMediaUrls] = useState<string[] | null>(null);
  const [readerMediaTypes, setReaderMediaTypes] = useState<Array<"image" | "video" | "link"> | null>(null);
  const [threadReplies, setThreadReplies] = useState<ReaderThreadReply[]>([]);
  const [isThreadLoading, setIsThreadLoading] = useState(false);

  const articleUrl = item.content.linkPreview?.url;
  const displayMediaUrls = readerMediaUrls ?? item.content.mediaUrls;
  const displayMediaTypes = readerMediaTypes ?? item.content.mediaTypes;
  const isStory = item.contentType === "story";
  const supportsThreadHydration =
    !isStory &&
    (item.platform === "x" || item.platform === "facebook" || item.platform === "instagram");

  // ─── Content waterfall ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadContent() {
      const cacheMode = getReaderOfflineCacheMode();
      const shouldPin = item.userState.saved || shouldPinOpenedReaderItem(cacheMode);
      let hasReaderContent = false;

      setIsLoading(true);
      setIsCaching(false);
      setHydrationStatus(null);
      setHydrationMessage(null);
      setReaderMediaUrls(null);
      setReaderMediaTypes(null);
      setThreadReplies([]);
      setIsThreadLoading(false);
      setPreservedText(item.preservedContent?.text ?? null);

      if (item.userState.saved && pinReaderItem) {
        void pinReaderItem(item);
      }

      // Layer 1: Device-local content cache (desktop: Tauri FS, PWA: Cache API)
      if (getLocalContent) {
        const cached = await getLocalContent(item.globalId);
        if (!cancelled && cached) {
          setHtml(cached);
          setContentSource("cache");
          setIsLoading(false);
          hasReaderContent = true;
        }
      } else if (articleUrl && "caches" in window) {
        try {
          const cache = await caches.open("freed-articles-v1");
          const cachedResponse = await cache.match(articleUrl);
          if (cachedResponse) {
            const text = await cachedResponse.text();
            if (!cancelled && text) {
              setHtml(text);
              setContentSource("cache");
              setIsLoading(false);
              hasReaderContent = true;
            }
          }
        } catch {
          // Cache API unavailable, continue waterfall.
        }
      }

      // Layer 2: preservedContent.text -- always available for imported items
      if (!hasReaderContent && item.preservedContent?.text) {
        let localPreservedText = item.preservedContent.text;
        if (getLocalPreservedText) {
          try {
            localPreservedText = (await getLocalPreservedText(item.globalId)) ?? localPreservedText;
          } catch {
            localPreservedText = item.preservedContent.text;
          }
        }
        if (!cancelled) {
          setPreservedText(localPreservedText);
          setHtml(null);
          setContentSource("text");
          setIsLoading(false);
        }
        hasReaderContent = true;
      }

      // Layer 3: platform hydration. Desktop uses native fetch or authenticated
      // provider paths here, so reader failures are not confused with CORS.
      if (hydrateReaderItem && navigator.onLine) {
        setIsCaching(true);
        setIsThreadLoading(supportsThreadHydration);
        try {
          const hydrated = await hydrateReaderItem(item, { cacheMode, pin: shouldPin });
          if (!cancelled) {
            if (hydrated.html) {
              setHtml(hydrated.html);
              setContentSource("live");
              hasReaderContent = true;
            }
            if (hydrated.text) {
              setPreservedText(hydrated.text);
              if (!hydrated.html) {
                setHtml(null);
                setContentSource("text");
              }
              hasReaderContent = true;
            }
            if (hydrated.mediaUrls?.length) {
              setReaderMediaUrls(hydrated.mediaUrls);
              setReaderMediaTypes(hydrated.mediaTypes ?? []);
            }
            if (hydrated.replies) {
              setThreadReplies(hydrated.replies);
            }
            setHydrationStatus(hydrated.status ?? null);
            setHydrationMessage(hydrated.message ?? null);
            setIsLoading(false);
          }
        } catch {
          if (!cancelled && !hasReaderContent) {
            setHydrationStatus("unsupported");
            setHydrationMessage("Freed could not hydrate this item inside the reader.");
            setIsLoading(false);
          }
        } finally {
          if (!cancelled) {
            setIsCaching(false);
            setIsThreadLoading(false);
          }
        }
        return;
      }

      if (hasReaderContent) {
        return;
      }

      // Layer 4: browser fetch fallback for platforms without a native hydrator.
      if (articleUrl && navigator.onLine) {
        setIsCaching(true);
        liveFetch(
          articleUrl,
          item.globalId,
          shouldPin,
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
            if (!cancelled) {
              setHtml(null);
              setContentSource(null);
              setIsCaching(false);
              setIsLoading(false);
            }
          },
        );
      } else {
        if (!cancelled) {
          setHtml(null);
          setContentSource(null);
          if (isStory && displayMediaUrls.length === 0) {
            setHydrationStatus("expired");
            setHydrationMessage("This story media was not captured before the source expired it.");
          }
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
  }, [
    item.globalId,
    articleUrl,
    getLocalContent,
    getLocalPreservedText,
    hydrateReaderItem,
    pinReaderItem,
    item.preservedContent?.text,
    item.userState.saved,
    supportsThreadHydration,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleSaved = useCallback(() => {
    toggleSaved(item.globalId);
  }, [toggleSaved, item.globalId]);

  const handleToggleArchived = useCallback(() => {
    toggleArchived(item.globalId);
    if (!item.userState.archived) onClose();
  }, [toggleArchived, item.globalId, item.userState.archived, onClose]);

  const prefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFocus = useCallback(() => {
    setFocusOptions((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      if (prefTimerRef.current) clearTimeout(prefTimerRef.current);
      prefTimerRef.current = setTimeout(() => {
        prefTimerRef.current = null;
        const latestDisplay = storedDisplayRef.current;
        updatePreferences({
          display: {
            ...latestDisplay,
            reading: { ...latestDisplay.reading, focusMode: next.enabled, focusIntensity: next.intensity },
          },
        });
      }, 1_000);
      return next;
    });
  }, [updatePreferences, storedDisplay]);

  const toggleDualColumn = useCallback(() => {
    const latestDisplay = storedDisplayRef.current;
    const next = !latestDisplay.reading.dualColumnMode;
    updatePreferences({
      display: {
        ...latestDisplay,
        reading: { ...latestDisplay.reading, dualColumnMode: next },
      },
    });
  }, [updatePreferences]);

  const timeAgo = useMemo(
    () => formatDistanceToNow(item.publishedAt, { addSuffix: true }),
    [item.publishedAt],
  );

  // Parse content into structured blocks. HTML is parsed via DOMParser (no
  // injection). Plain text is split into paragraphs. Either way, we render
  // React elements, never raw HTML.
  const articleBlocks = useMemo<ContentBlock[]>(() => {
    if (html) return parseArticleBlocks(html);
    const text = preservedText ?? item.content.text;
    if (text) return textToBlocks(text);
    return [];
  }, [html, preservedText, item.content.text]);

  // Plain text for focus mode rendering
  const plainText = useMemo(
    () => htmlToPlainText(html ?? preservedText ?? item.content.text ?? ""),
    [html, preservedText, item.content.text],
  );

  return (
    <div
      className={
        inline
          ? "theme-scroll-fade-y flex-1 min-w-0 overflow-auto bg-transparent"
          : "theme-scroll-fade-y fixed inset-0 z-50 overflow-auto bg-[var(--theme-bg-root)]"
      }
    >
      {!inline && (
        <header
          className="theme-topbar sticky top-0 z-10 border-b"
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
              className="group -ml-1 flex min-w-0 max-w-[50%] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--theme-bg-muted)]"
              style={headerDragRegion ? noDrag : undefined}
              aria-label="Back"
            >
              <svg
                className="w-5 h-5 shrink-0 text-[var(--theme-text-muted)] transition-colors group-hover:text-[var(--theme-text-secondary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="truncate text-sm text-[var(--theme-text-muted)] transition-colors group-hover:text-[var(--theme-text-secondary)]">
                {item.author.displayName}
              </span>
            </button>

            <div className="flex-1" />

            {contentSource === "cache" && (
              <Tooltip label="Served from your device cache">
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  Offline
                </span>
              </Tooltip>
            )}
            {contentSource === "text" && (
              <Tooltip label="Full content will load when online">
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  Summary
                </span>
              </Tooltip>
            )}

            {isCaching && (
              <Tooltip label="Loading full article">
                <div className="w-4 h-4 rounded-full border border-[var(--theme-text-soft)] border-t-[var(--theme-accent-secondary)] animate-spin" />
              </Tooltip>
            )}

            <Tooltip label={focusOptions.enabled ? "Disable focus mode" : "Enable focus mode"}>
              <button
                onClick={toggleFocus}
                className={`p-2 rounded-lg transition-colors text-sm font-bold ${
                  focusOptions.enabled
                    ? "theme-accent-button"
                    : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
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
            </Tooltip>

            <Tooltip label={item.userState.saved ? "Remove bookmark" : "Bookmark"}>
              <button
                onClick={handleToggleSaved}
                className={`p-2 rounded-lg transition-colors ${
                  item.userState.saved
                    ? "theme-accent-button"
                    : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
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
            </Tooltip>

            <Tooltip label={item.userState.archived ? "Unarchive" : "Archive"}>
              <button
                onClick={handleToggleArchived}
                className={`p-2 rounded-lg transition-colors ${
                  item.userState.archived
                    ? "theme-status-pill-success hover:bg-[rgb(var(--theme-feedback-success-rgb)/0.18)]"
                    : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                }`}
                style={headerDragRegion ? noDrag : undefined}
                aria-label={item.userState.archived ? "Unarchive" : "Archive"}
              >
                <TrashIcon className="w-5 h-5" />
              </button>
            </Tooltip>

            {onOpenUrl && item.sourceUrl && (
              <button
                onClick={() => onOpenUrl(item.sourceUrl!)}
                className="theme-subtle-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm"
                style={headerDragRegion ? noDrag : undefined}
                aria-label="Open"
              >
                <ExternalLinkIcon className="w-4 h-4" />
                <span>Open</span>
              </button>
            )}

            <Tooltip label={dualColumn ? "Single column" : "Dual column"}>
              <button
                onClick={toggleDualColumn}
                className="theme-toolbar-button-ghost hidden rounded-lg p-2 md:flex"
                style={headerDragRegion ? noDrag : undefined}
                aria-pressed={dualColumn}
                aria-label="Toggle dual column layout"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
                  <path d="M9 4v16" />
                  <path d={dualColumn ? "M15 10l-2 2l2 2" : "M14 10l2 2l-2 2"} />
                </svg>
              </button>
            </Tooltip>
          </div>
        </header>
      )}

      {/* Article content */}
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Meta */}
        <div className="mb-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[var(--theme-text-muted)]">
            <span className="font-medium text-[var(--theme-text-secondary)]">{item.author.displayName}</span>
            <span>•</span>
            <span>{timeAgo}</span>
            {item.preservedContent?.readingTime && (
              <>
                <span>•</span>
                <span>{item.preservedContent.readingTime} min read</span>
              </>
            )}
          </div>

          <h1 className="theme-display-large text-2xl sm:text-3xl font-bold mb-4 leading-tight">
            {item.content.linkPreview?.title || item.content.text?.slice(0, 100)}
          </h1>

          {articleUrl && (
            <a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--theme-accent-secondary)] transition-colors hover:opacity-80"
            >
              View original
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>

        {/* Media */}
        {isStory && displayMediaUrls.length > 0 ? (
          <StoryMediaGallery urls={displayMediaUrls} types={displayMediaTypes} />
        ) : !isStory && item.content.mediaUrls[0] ? (
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            loading="lazy"
            decoding="async"
            className="mb-8 w-full rounded-xl bg-[var(--theme-bg-muted)] ring-1 ring-[var(--theme-border-subtle)]"
          />
        ) : null}

        {hydrationMessage && (
          <div
            className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
              hydrationStatus === "expired" || hydrationStatus === "auth_required"
                ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
                : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] text-[var(--theme-text-secondary)]"
            }`}
          >
            {hydrationMessage}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--theme-border-quiet)] border-t-[var(--theme-accent-secondary)] animate-spin" />
          </div>
        ) : focusOptions.enabled ? (
          <div className="text-lg leading-relaxed text-[var(--theme-text-secondary)]">
            <FocusText text={plainText ?? ""} options={focusOptions} />
          </div>
        ) : articleBlocks.length > 0 ? (
          <ArticleContent blocks={articleBlocks} />
        ) : (
          <div className="text-lg leading-relaxed text-[var(--theme-text-secondary)]">
            {item.content.text || (
              <span className="italic text-[var(--theme-text-soft)]">
                {isStory
                  ? "This story has no cached media. If the source still allows access, Freed will recover it while you are online."
                  : "No reader content is available yet."}
              </span>
            )}
          </div>
        )}

        {(threadReplies.length > 0 || isThreadLoading) && (
          <ThreadReplies replies={threadReplies} loading={isThreadLoading} />
        )}

        {/* Tags */}
        {item.userState.tags.length > 0 && (
          <div className="mt-8 border-t border-[var(--theme-border-subtle)] pt-8">
            <h3 className="mb-3 text-sm font-medium text-[var(--theme-text-muted)]">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {item.userState.tags.map((tag) => (
                <span
                  key={tag}
                  className="theme-accent-tag rounded-full px-3 py-1.5 text-sm"
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

// ─── Article content renderer ────────────────────────────────────────────────
//
// Renders structured content blocks as React elements. No HTML injection, no
// dangerouslySetInnerHTML. Every element is a controlled React component.

function ArticleContent({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "text":
            return (
              <p key={i} className="text-lg leading-relaxed text-[var(--theme-text-secondary)]">
                {block.content}
              </p>
            );
          case "heading": {
            const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={i} className={HEADING_CLASSES[block.level] ?? HEADING_CLASSES[4]}>
                {block.content}
              </Tag>
            );
          }
          case "image":
            return (
              <figure key={i}>
                <img
                  src={block.src}
                  alt={block.alt}
                  className="w-full rounded-xl bg-white/5 ring-1 ring-white/5"
                  loading="lazy"
                />
                {block.caption && (
                  <figcaption className="mt-2 text-center text-sm text-[var(--theme-text-muted)]">
                    {block.caption}
                  </figcaption>
                )}
              </figure>
            );
          case "blockquote":
            return (
              <blockquote
                key={i}
                className="rounded-r-xl border-l-2 border-[var(--theme-accent-secondary)] bg-[var(--theme-bg-muted)] py-3 pl-4 italic text-[var(--theme-text-secondary)]"
              >
                {block.content}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-code-background)] p-4"
              >
                <code className="whitespace-pre-wrap text-sm font-mono text-[var(--theme-accent-secondary)]">
                  {block.content}
                </code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={`space-y-1 pl-6 text-lg leading-relaxed text-[var(--theme-text-secondary)] ${
                  block.ordered ? "list-decimal" : "list-disc"
                }`}
              >
                {block.items.map((text, j) => (
                  <li key={j}>{text}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}

function StoryMediaGallery({
  urls,
  types,
}: {
  urls: string[];
  types: Array<"image" | "video" | "link">;
}) {
  return (
    <div className="mb-8 space-y-3">
      {urls.map((url, index) => {
        const type = types[index] ?? inferMediaType(url);
        return (
          <div
            key={`${url}-${index}`}
            className="overflow-hidden rounded-xl bg-[var(--theme-bg-muted)] ring-1 ring-[var(--theme-border-subtle)]"
          >
            {type === "video" ? (
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                className="max-h-[70vh] w-full bg-black object-contain"
              />
            ) : (
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-[70vh] w-full object-contain"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThreadReplies({
  replies,
  loading,
}: {
  replies: ReaderThreadReply[];
  loading: boolean;
}) {
  return (
    <section className="mt-10 border-t border-[var(--theme-border-subtle)] pt-8">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Replies</h2>
        {loading && (
          <div className="h-4 w-4 rounded-full border border-[var(--theme-border-quiet)] border-t-[var(--theme-accent-secondary)] animate-spin" />
        )}
      </div>
      <div className="space-y-5">
        {replies.map((reply) => (
          <ReplyCard key={reply.id} reply={reply} />
        ))}
      </div>
    </section>
  );
}

function ReplyCard({ reply }: { reply: ReaderThreadReply }) {
  const timeLabel = reply.publishedAt
    ? formatDistanceToNow(reply.publishedAt, { addSuffix: true })
    : null;
  const metrics = [
    formatMetric(reply.engagement?.comments, "comments"),
    formatMetric(reply.engagement?.reposts, "reposts"),
    formatMetric(reply.engagement?.likes, "likes"),
    formatMetric(reply.engagement?.views, "views"),
  ].filter(Boolean);

  return (
    <article className="rounded-xl border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_55%,transparent)] p-4">
      <div className="flex gap-3">
        {reply.authorAvatarUrl ? (
          <img
            src={reply.authorAvatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-10 w-10 shrink-0 rounded-full bg-[var(--theme-bg-muted)]"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--theme-bg-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-[var(--theme-text-primary)]">{reply.authorName}</span>
            {reply.authorHandle && (
              <span className="text-[var(--theme-text-muted)]">@{reply.authorHandle}</span>
            )}
            {timeLabel && (
              <>
                <span className="text-[var(--theme-text-soft)]">•</span>
                <span className="text-[var(--theme-text-muted)]">{timeLabel}</span>
              </>
            )}
          </div>
          {reply.text && (
            <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-[var(--theme-text-secondary)]">
              {reply.text}
            </p>
          )}
          {reply.mediaUrls.length > 0 && (
            <ReplyMediaGrid urls={reply.mediaUrls} types={reply.mediaTypes} />
          )}
          {metrics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--theme-text-muted)]">
              {metrics.map((metric) => (
                <span key={metric}>{metric}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ReplyMediaGrid({
  urls,
  types,
}: {
  urls: string[];
  types: Array<"image" | "video" | "link">;
}) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {urls.slice(0, 4).map((url, index) => {
        const type = types[index] ?? inferMediaType(url);
        return (
          <div
            key={`${url}-${index}`}
            className="overflow-hidden rounded-lg bg-[var(--theme-bg-muted)] ring-1 ring-[var(--theme-border-subtle)]"
          >
            {type === "video" ? (
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
              />
            ) : (
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-video w-full object-cover"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function inferMediaType(url: string): "image" | "video" | "link" {
  const pathname = url.split("?", 1)[0]?.toLowerCase() ?? "";
  return /\.(mp4|m4v|webm|mov)$/.test(pathname) ? "video" : "image";
}

function formatMetric(value: number | undefined, label: string): string | null {
  if (typeof value !== "number" || value <= 0) return null;
  return `${value.toLocaleString()} ${label}`;
}

// ─── Focus text renderer ─────────────────────────────────────────────────────
//
// Renders text with focus-mode bolding on word beginnings. Each segment becomes
// a React element (no dangerouslySetInnerHTML). The segments are memoized so
// the element array is only rebuilt when text or options change.

function FocusText({ text, options }: { text: string; options: FocusOptions }) {
  const elements = useMemo(() => {
    const segments = applyFocusMode(text, options);
    return segments.map((seg, i) =>
      seg.emphasis
        ? <strong key={i} className="font-bold text-[var(--theme-text-primary)]">{seg.text}</strong>
        : <span key={i}>{seg.text}</span>,
    );
  }, [text, options]);

  return <div>{elements}</div>;
}

// ─── Live fetch helper ───────────────────────────────────────────────────────

/**
 * Live-fetch an article URL and cache it in the PWA Cache API.
 * The returned HTML is parsed into structured blocks at the rendering layer,
 * never injected as raw HTML.
 */
async function liveFetch(
  url: string,
  globalId: string,
  pinned: boolean,
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

    try {
      await cacheArticleHtml(url, globalId, html, { pinned });
      void warmArticleImageCache(html, url);
    } catch {
      // Cache write failure is non-fatal
    }

    onDone(html);
  } catch {
    onError?.();
  }
}
