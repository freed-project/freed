/**
 * Browser-side OPML import/export using native DOMParser
 *
 * Handles recursive folder structures, deduplication against existing
 * subscriptions, and clean XML generation with folder grouping.
 */

import type { RssFeed } from "@freed/shared";

// =============================================================================
// Types
// =============================================================================

/** A single feed entry extracted from an OPML document */
export interface OPMLFeedEntry {
  url: string;
  title: string;
  siteUrl?: string;
  folder?: string;
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Get direct `<outline>` children of an element.
 * Uses tagName matching instead of CSS selectors for XML document compatibility.
 */
function getChildOutlines(element: Element): Element[] {
  return Array.from(element.children).filter(
    (el) => el.tagName.toLowerCase() === "outline",
  );
}

/**
 * Parse an OPML XML string into an array of feed entries.
 *
 * Recursively processes nested outlines (folders) and extracts all feeds
 * with their category/folder assignments preserved.
 *
 * @throws {Error} If the XML is malformed or missing required OPML structure
 */
export function parseOPML(xml: string): OPMLFeedEntry[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid OPML: malformed XML");
  }

  const body = doc.querySelector("opml > body");
  if (!body) {
    throw new Error("Invalid OPML: missing <body> element");
  }

  const feeds: OPMLFeedEntry[] = [];

  function processOutline(outline: Element, parentFolder?: string): void {
    const xmlUrl = outline.getAttribute("xmlUrl");
    const text =
      outline.getAttribute("text") || outline.getAttribute("title");

    if (xmlUrl) {
      feeds.push({
        url: xmlUrl,
        title: text || "Untitled Feed",
        siteUrl: outline.getAttribute("htmlUrl") || undefined,
        folder: parentFolder,
      });
    }

    // Recurse into children — if this outline has no xmlUrl, it's a folder
    const folderName = !xmlUrl ? (text || parentFolder) : parentFolder;
    for (const child of getChildOutlines(outline)) {
      processOutline(child, folderName || undefined);
    }
  }

  for (const outline of getChildOutlines(body)) {
    processOutline(outline);
  }

  if (feeds.length === 0) {
    throw new Error("No feeds found in OPML file");
  }

  return feeds;
}

// =============================================================================
// Generation
// =============================================================================

/** Escape special XML characters in attribute values */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate an OPML XML document from an array of RssFeed subscriptions.
 *
 * Feeds with a `folder` property are grouped under category outlines.
 * Ungrouped feeds appear at the top level.
 */
export function generateOPML(
  feeds: RssFeed[],
  title: string = "Freed Feed Subscriptions",
): string {
  const dateStr = new Date().toISOString();

  // Group feeds by folder, preserving insertion order
  const grouped = new Map<string, RssFeed[]>();
  const ungrouped: RssFeed[] = [];

  for (const feed of feeds) {
    if (feed.folder) {
      const bucket = grouped.get(feed.folder) || [];
      bucket.push(feed);
      grouped.set(feed.folder, bucket);
    } else {
      ungrouped.push(feed);
    }
  }

  const feedToOutline = (feed: RssFeed, indent: string): string => {
    const htmlAttr = feed.siteUrl
      ? ` htmlUrl="${escapeXml(feed.siteUrl)}"`
      : "";
    return `${indent}<outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${htmlAttr} />`;
  };

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXml(title)}</title>`,
    `    <dateCreated>${dateStr}</dateCreated>`,
    "  </head>",
    "  <body>",
  ];

  // Grouped feeds (folders)
  for (const [folder, folderFeeds] of grouped) {
    lines.push(
      `    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">`,
    );
    for (const feed of folderFeeds) {
      lines.push(feedToOutline(feed, "      "));
    }
    lines.push("    </outline>");
  }

  // Ungrouped feeds
  for (const feed of ungrouped) {
    lines.push(feedToOutline(feed, "    "));
  }

  lines.push("  </body>", "</opml>");
  return lines.join("\n");
}

// =============================================================================
// Browser File Helpers
// =============================================================================

/** Trigger a browser file download with the given content */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = "application/xml",
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read a File object as text (promisified FileReader) */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}
