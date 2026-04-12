import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore, usePlatform, MACOS_TRAFFIC_LIGHT_INSET } from "../../context/PlatformContext.js";
import { applyFocusMode, type FocusOptions } from "@freed/shared";
import { Tooltip } from "../Tooltip.js";
import { ExternalLinkIcon, TrashIcon } from "../icons.js";

interface ReaderViewProps {
  item: FeedItemType;
  onClose: () => void;
  /** When true, renders inline as a flex child instead of a fixed overlay */
  dualColumn?: boolean;
  onOpenUrl?: (url: string) => void;
}

/** Content source labels for the offline badge */
type ContentSource = "cache" | "text" | "live" | null;

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

export function ReaderView({ item, onClose, dualColumn = false, onOpenUrl }: ReaderViewProps) {
  const { headerDragRegion, getLocalContent } = usePlatform();
  const toggleSaved = useAppStore((s) => s.toggleSaved);
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
        const cached = await getLocalContent(item.globalId);
        if (!cancelled && cached) {
          setHtml(cached);
          setContentSource("cache");
          setIsLoading(false);
          return;
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
          setHtml(null);
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
        updatePreferences({
          display: {
            ...storedDisplay,
            reading: { ...storedDisplay.reading, focusMode: next.enabled, focusIntensity: next.intensity },
          },
        });
      }, 1_000);
      return next;
    });
  }, [updatePreferences, storedDisplay]);

  const toggleDualColumn = useCallback(() => {
    const next = !storedDisplay.reading.dualColumnMode;
    updatePreferences({
      display: {
        ...storedDisplay,
        reading: { ...storedDisplay.reading, dualColumnMode: next },
      },
    });
  }, [updatePreferences, storedDisplay]);

  const timeAgo = useMemo(
    () => formatDistanceToNow(item.publishedAt, { addSuffix: true }),
    [item.publishedAt],
  );

  // Parse content into structured blocks. HTML is parsed via DOMParser (no
  // injection). Plain text is split into paragraphs. Either way, we render
  // React elements, never raw HTML.
  const articleBlocks = useMemo<ContentBlock[]>(() => {
    if (html) return parseArticleBlocks(html);
    const text = item.preservedContent?.text ?? item.content.text;
    if (text) return textToBlocks(text);
    return [];
  }, [html, item.preservedContent?.text, item.content.text]);

  // Plain text for focus mode rendering
  const plainText = useMemo(
    () => htmlToPlainText(html ?? item.content.text ?? ""),
    [html, item.content.text],
  );

  return (
    <div className={dualColumn ? "flex-1 min-w-0 overflow-auto bg-[var(--theme-bg-root)]" : "fixed inset-0 z-50 overflow-auto bg-[var(--theme-bg-root)]"}>
      {/* Header */}
      <header
        className={`theme-topbar sticky top-0 z-10 border-b${
          dualColumn ? " border-l rounded-bl-2xl" : ""
        }`}
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

          {/* Offline / cached badge */}
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

          {/* Focus mode toggle */}
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

          {/* Dual-column mode toggle (desktop only) */}
          <Tooltip label={dualColumn ? "Single column" : "Dual column"}>
            <button
              onClick={toggleDualColumn}
              className={`hidden md:flex p-2 rounded-lg transition-colors ${
                dualColumn
                  ? "theme-accent-button"
                  : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
              }`}
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

      {/* Article content */}
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-20">
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

        {/* Featured image */}
        {item.content.mediaUrls[0] && (
          <img
            src={item.content.mediaUrls[0]}
            alt=""
            loading="lazy"
            decoding="async"
            className="mb-8 w-full rounded-xl bg-[var(--theme-bg-muted)] ring-1 ring-[var(--theme-border-subtle)]"
          />
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
                No content available. Connect to the internet to load this article.
              </span>
            )}
          </div>
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

    if ("caches" in window) {
      try {
        const cache = await caches.open("freed-articles-v1");
        await cache.put(url, new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
        await cache.put(`/content/${globalId}`, new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
      } catch {
        // Cache write failure is non-fatal
      }
    }

    onDone(html);
  } catch {
    onError?.();
  }
}
