/**
 * OPML import/export for feed subscriptions
 *
 * Uses fast-xml-parser (Node-compatible) rather than browser DOMParser.
 * The data shape (OPMLFeed.folder) is aligned with @freed/shared's
 * OPMLFeedEntry.folder and RssFeed.folder so round-trips are lossless.
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { OPMLDocument, OPMLOutline, OPMLFeed } from "./types.js";
import type { RssFeed } from "@freed/shared";

// =============================================================================
// OPML Parsing
// =============================================================================

/**
 * Parse an OPML document and extract feed subscriptions
 *
 * @param xml - OPML XML content
 * @returns Array of feeds with folder assignments preserved
 */
export function parseOPML(xml: string): OPMLFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  let doc: OPMLDocument;
  try {
    doc = parser.parse(xml);
  } catch (error) {
    throw new Error(`Failed to parse OPML: ${error}`);
  }

  if (!doc.opml?.body?.outline) {
    throw new Error("Invalid OPML: missing body/outline");
  }

  const feeds: OPMLFeed[] = [];
  const outlines = doc.opml.body.outline;

  function processOutline(outline: OPMLOutline, parentFolder?: string): void {
    if (outline["@_xmlUrl"]) {
      // This outline is a feed — determine its folder assignment
      const folder =
        outline["@_type"] === "rss" ? parentFolder : parentFolder;
      feeds.push({
        url: outline["@_xmlUrl"],
        title: outline["@_title"] || outline["@_text"] || "Untitled Feed",
        siteUrl: outline["@_htmlUrl"],
        description: outline["@_description"],
        ...(folder ? { folder } : {}),
      });
    }

    // Recurse into nested outlines (folder containers)
    if (outline.outline) {
      const children = Array.isArray(outline.outline)
        ? outline.outline
        : [outline.outline];

      for (const child of children) {
        // Non-feed outlines are folders — pass their name down
        const folderName = !outline["@_xmlUrl"]
          ? (outline["@_text"] || outline["@_title"] || parentFolder)
          : parentFolder;
        processOutline(child, folderName);
      }
    }
  }

  const topLevel = Array.isArray(outlines) ? outlines : [outlines];
  for (const outline of topLevel) {
    processOutline(outline);
  }

  return feeds;
}

/**
 * Convert parsed OPML feeds to RssFeed objects
 */
export function opmlFeedsToRssFeeds(feeds: OPMLFeed[]): RssFeed[] {
  return feeds.map((feed) => ({
    url: feed.url,
    title: feed.title,
    ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
    ...(feed.folder ? { folder: feed.folder } : {}),
    enabled: true,
    trackUnread: false,
  }));
}

// =============================================================================
// OPML Generation
// =============================================================================

/**
 * Generate an OPML document from feed subscriptions.
 *
 * Feeds are grouped by their `folder` field, producing nested outline
 * elements that round-trip correctly through parseOPML.
 *
 * @param feeds - Array of RssFeed objects
 * @param title - Title for the OPML document
 * @returns OPML XML string
 */
export function generateOPML(
  feeds: RssFeed[],
  title: string = "Freed Feed Subscriptions"
): string {
  // Group feeds by folder
  const folders = new Map<string | undefined, RssFeed[]>();
  for (const feed of feeds) {
    const key = feed.folder;
    if (!folders.has(key)) folders.set(key, []);
    folders.get(key)!.push(feed);
  }

  const outlines: OPMLOutline[] = [];

  // Feeds without a folder go at the top level
  for (const feed of folders.get(undefined) ?? []) {
    outlines.push(feedToOutline(feed));
  }

  // Feeds with a folder are wrapped in a folder outline
  for (const [folder, folderFeeds] of folders) {
    if (folder === undefined) continue;
    outlines.push({
      "@_text": folder,
      "@_title": folder,
      outline: folderFeeds.map(feedToOutline),
    });
  }

  const doc: OPMLDocument = {
    opml: {
      head: {
        title,
        dateCreated: new Date().toISOString(),
      },
      body: {
        outline: outlines,
      },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    indentBy: "  ",
  });

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(doc);
}

function feedToOutline(feed: RssFeed): OPMLOutline {
  return {
    "@_type": "rss",
    "@_text": feed.title,
    "@_title": feed.title,
    "@_xmlUrl": feed.url,
    ...(feed.siteUrl ? { "@_htmlUrl": feed.siteUrl } : {}),
  };
}

// =============================================================================
// OPML Utilities
// =============================================================================

/**
 * Validate an OPML document
 */
export function validateOPML(xml: string): { valid: boolean; error?: string } {
  try {
    const feeds = parseOPML(xml);
    if (feeds.length === 0) {
      return { valid: false, error: "No feeds found in OPML" };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get statistics about an OPML document
 */
export function getOPMLStats(xml: string): {
  feedCount: number;
  folders: string[];
} {
  const feeds = parseOPML(xml);
  const folders = [
    ...new Set(feeds.map((f) => f.folder).filter(Boolean)),
  ] as string[];

  return {
    feedCount: feeds.length,
    folders,
  };
}

/**
 * Merge two OPML documents, deduplicating by URL
 */
export function mergeOPML(opml1: string, opml2: string): OPMLFeed[] {
  const feeds1 = parseOPML(opml1);
  const feeds2 = parseOPML(opml2);

  const urlSet = new Set<string>();
  const merged: OPMLFeed[] = [];

  for (const feed of [...feeds1, ...feeds2]) {
    if (!urlSet.has(feed.url)) {
      urlSet.add(feed.url);
      merged.push(feed);
    }
  }

  return merged;
}
