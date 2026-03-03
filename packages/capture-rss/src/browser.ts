/**
 * Browser-safe entry point for @freed/capture-rss
 *
 * Re-exports only Node-free modules (types, opml, normalize, discovery)
 * and provides a `parseFeedXml` implementation built on fast-xml-parser
 * instead of rss-parser (which requires Node.js http/https/url built-ins).
 *
 * The default "." entry still exports rss-parser-based utilities for
 * Node/CLI contexts. Use this subpath in any browser or Tauri renderer:
 *
 *   import { parseFeedXml, feedToFeedItems } from "@freed/capture-rss/browser";
 */

import { XMLParser } from "fast-xml-parser";
import type { ParsedFeed, ParsedFeedItem } from "./types.js";

// Re-export everything that is Node-free
export * from "./types.js";
export * from "./discovery.js";
export {
  rssItemToFeedItem,
  feedToFeedItems,
  feedToRssFeed,
  deduplicateFeedItems,
} from "./normalize.js";
export {
  parseOPML,
  generateOPML,
  validateOPML,
  getOPMLStats,
  mergeOPML,
  opmlFeedsToRssFeeds,
} from "./opml.js";

// =============================================================================
// Browser-native XML parser (no Node.js deps)
// =============================================================================

const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  isArray: (_name, jpath) =>
    jpath === "rss.channel.item" ||
    jpath === "feed.entry" ||
    jpath === "rdf:RDF.item" ||
    jpath === "feed.link" ||
    jpath === "entry.link",
});

/** Coerce a raw XML node (string or `{#text: ...}` object) to a string. */
function text(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string") return val.trim() || undefined;
  if (typeof val === "number" || typeof val === "boolean")
    return String(val).trim() || undefined;
  if (typeof val === "object") {
    const v = (val as Record<string, unknown>)["#text"];
    return v !== undefined ? text(v) : undefined;
  }
  return undefined;
}

type Rec = Record<string, unknown>;

function parseRssItems(rawItems: unknown): ParsedFeedItem[] {
  const arr: unknown[] = Array.isArray(rawItems)
    ? rawItems
    : rawItems
      ? [rawItems]
      : [];

  return arr.filter(Boolean).map((raw) => {
    const it = raw as Rec;
    const enc = it.enclosure as Rec | undefined;
    const guid = it.guid
      ? (text(it.guid) ?? text((it.guid as Rec)?.["#text"]))
      : undefined;

    return {
      title: text(it.title),
      link: text(it.link) ?? text((it["atom:link"] as Rec)?.["@_href"]),
      guid,
      pubDate: text(it.pubDate) ?? text(it["dc:date"]),
      creator: text(it["dc:creator"]) ?? text(it.author),
      content:
        text(it["content:encoded"]) ??
        text((it.content as Rec)?.["#text"]) ??
        text(it.description),
      contentSnippet: text(it.description),
      summary: text(it.summary),
      ...(enc?.["@_url"]
        ? {
            enclosure: {
              url: text(enc["@_url"]) ?? "",
              type: text(enc["@_type"]),
              length: text(enc["@_length"]),
            },
          }
        : {}),
    };
  });
}

function parseRss(rss: Rec): ParsedFeed {
  const ch = ((rss.channel ?? {}) as Rec);
  const img = ch.image as Rec | undefined;

  return {
    title: text(ch.title) ?? "Untitled Feed",
    description: text(ch.description),
    link: text(ch.link),
    feedUrl: "",
    language: text(ch.language),
    lastBuildDate: text(ch.lastBuildDate),
    ...(img?.url ? {
      image: {
        url: text(img.url) ?? "",
        title: text(img.title),
        link: text(img.link),
      },
    } : {}),
    items: parseRssItems(ch.item),
  };
}

function parseAtomItems(rawEntries: unknown): ParsedFeedItem[] {
  const arr: unknown[] = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries
      ? [rawEntries]
      : [];

  return arr.filter(Boolean).map((raw) => {
    const e = raw as Rec;
    const links: Rec[] = Array.isArray(e.link)
      ? (e.link as Rec[])
      : e.link
        ? [e.link as Rec]
        : [];
    const altLink = links.find(
      (l) => !l["@_rel"] || l["@_rel"] === "alternate",
    );

    const author = e.author as Rec | undefined;

    return {
      title: text(e.title),
      link: text(altLink?.["@_href"]) ?? text(altLink?.["href"]),
      guid: text(e.id),
      pubDate: text(e.updated) ?? text(e.published),
      creator: text(author?.name) ?? text(e.author),
      content: text((e.content as Rec)?.["#text"]) ?? text(e.content),
      contentSnippet: text((e.summary as Rec)?.["#text"]) ?? text(e.summary),
      summary: text(e.summary),
    };
  });
}

function parseAtom(feed: Rec): ParsedFeed {
  const links: Rec[] = Array.isArray(feed.link)
    ? (feed.link as Rec[])
    : feed.link
      ? [feed.link as Rec]
      : [];
  const altLink = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate");

  return {
    title: text(feed.title) ?? "Untitled Feed",
    description: text(feed.subtitle),
    link: text(altLink?.["@_href"]) ?? text(altLink?.["href"]),
    feedUrl: "",
    items: parseAtomItems(feed.entry),
  };
}

/**
 * Parse an RSS 2.0, Atom 1.0, or RSS 1.0/RDF XML string into a normalized
 * ParsedFeed. Uses fast-xml-parser — zero Node.js built-in dependencies.
 */
export async function parseFeedXml(
  xml: string,
  feedUrl: string,
): Promise<ParsedFeed> {
  const doc = XML.parse(xml) as Rec;

  let result: ParsedFeed;
  if (doc.rss) {
    result = parseRss(doc.rss as Rec);
  } else if (doc.feed) {
    result = parseAtom(doc.feed as Rec);
  } else if (doc["rdf:RDF"]) {
    // RSS 1.0 / RDF — channel metadata lives at rdf:RDF.channel
    const rdf = doc["rdf:RDF"] as Rec;
    result = parseRss({ channel: { ...rdf.channel, item: rdf.item } });
  } else {
    throw new Error("Unrecognized feed format");
  }

  result.feedUrl = feedUrl;
  return result;
}
