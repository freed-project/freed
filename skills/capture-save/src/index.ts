#!/usr/bin/env bun
/**
 * capture-save OpenClaw skill
 * Save any URL to your FREED library
 */

import { saveUrl } from "@freed/capture-save";
import * as Automerge from "@automerge/automerge";
import * as fs from "fs";
import * as path from "path";

// Config and document paths
const CONFIG_DIR = path.join(process.env.HOME || "~", ".freed");
const DOC_PATH = path.join(CONFIG_DIR, "feed.automerge");

interface FreedDoc {
  feedItems: Record<string, unknown>;
  meta: { lastSync: number };
}

function loadDoc(): Automerge.Doc<FreedDoc> {
  if (fs.existsSync(DOC_PATH)) {
    const binary = fs.readFileSync(DOC_PATH);
    return Automerge.load(binary as unknown as Uint8Array);
  }
  return Automerge.from<FreedDoc>({
    feedItems: {},
    meta: { lastSync: 0 },
  });
}

function saveDoc(doc: Automerge.Doc<FreedDoc>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const binary = Automerge.save(doc);
  fs.writeFileSync(DOC_PATH, binary);
}

async function addUrl(
  url: string,
  options: { tags?: string[]; metadataOnly?: boolean },
): Promise<void> {
  console.log(`Saving ${url}...`);

  const item = await saveUrl(url, options);

  let doc = loadDoc();
  doc = Automerge.change(doc, `Save URL: ${url}`, (d) => {
    d.feedItems[item.globalId] = item as unknown as Record<string, unknown>;
    d.meta.lastSync = Date.now();
  });
  saveDoc(doc);

  console.log(`✓ Saved: ${item.content.linkPreview?.title || url}`);
  if (item.preservedContent) {
    console.log(
      `  ${item.preservedContent.wordCount} words, ${item.preservedContent.readingTime} min read`,
    );
  }
  if (options.tags?.length) {
    console.log(`  Tags: ${options.tags.join(", ")}`);
  }
}

function listSaved(): void {
  const doc = loadDoc();
  const items = Object.values(doc.feedItems) as Array<{
    globalId: string;
    platform: string;
    content: { linkPreview?: { title?: string; url?: string } };
    capturedAt: number;
    userState: { tags: string[] };
  }>;

  const savedItems = items.filter((i) => i.platform === "saved");

  if (savedItems.length === 0) {
    console.log("No saved items yet.");
    return;
  }

  console.log(`\n${savedItems.length} saved items:\n`);
  savedItems
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, 20)
    .forEach((item, i) => {
      const title =
        item.content.linkPreview?.title ||
        item.content.linkPreview?.url ||
        item.globalId;
      const date = new Date(item.capturedAt).toLocaleDateString();
      const tags = item.userState.tags.length
        ? ` [${item.userState.tags.join(", ")}]`
        : "";
      console.log(`${i + 1}. ${title}${tags}`);
      console.log(`   ${date}`);
    });
}

function searchSaved(query: string): void {
  const doc = loadDoc();
  const items = Object.values(doc.feedItems) as Array<{
    globalId: string;
    platform: string;
    content: {
      text?: string;
      linkPreview?: { title?: string; url?: string; description?: string };
    };
    preservedContent?: { text: string };
    capturedAt: number;
  }>;

  const lowerQuery = query.toLowerCase();
  const matches = items
    .filter((i) => i.platform === "saved")
    .filter((item) => {
      const title = item.content.linkPreview?.title?.toLowerCase() || "";
      const desc = item.content.linkPreview?.description?.toLowerCase() || "";
      const text = item.preservedContent?.text.toLowerCase() || "";
      return (
        title.includes(lowerQuery) ||
        desc.includes(lowerQuery) ||
        text.includes(lowerQuery)
      );
    });

  if (matches.length === 0) {
    console.log(`No matches for "${query}"`);
    return;
  }

  console.log(`\n${matches.length} matches for "${query}":\n`);
  matches.slice(0, 10).forEach((item, i) => {
    const title = item.content.linkPreview?.title || item.globalId;
    console.log(`${i + 1}. ${title}`);
    console.log(`   ${item.content.linkPreview?.url || ""}`);
  });
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "add": {
    const url = args[1];
    if (!url) {
      console.error(
        "Usage: capture-save add <url> [--tags tag1,tag2] [--metadata-only]",
      );
      process.exit(1);
    }
    const metadataOnly = args.includes("--metadata-only");
    const tagsIndex = args.indexOf("--tags");
    const tags =
      tagsIndex > -1
        ? args[tagsIndex + 1]?.split(",").map((t) => t.trim())
        : [];
    addUrl(url, { tags, metadataOnly }).catch((e) => {
      console.error("Error:", e.message);
      process.exit(1);
    });
    break;
  }
  case "list":
    listSaved();
    break;
  case "search": {
    const query = args[1];
    if (!query) {
      console.error("Usage: capture-save search <query>");
      process.exit(1);
    }
    searchSaved(query);
    break;
  }
  default:
    console.log(`capture-save - Save any URL to your FREED library

Commands:
  add <url>           Save a URL
    --tags t1,t2      Add tags
    --metadata-only   Skip content extraction
  list                List saved items
  search <query>      Search saved content
`);
}
