import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", async () => {
  const actual = await import("../__mocks__/@tauri-apps/api/path");
  return actual;
});

vi.mock("@tauri-apps/plugin-fs", async () => {
  const actual = await import("../__mocks__/@tauri-apps/plugin-fs/index");
  return actual;
});

import {
  __readMemfs,
  __resetMemfs,
} from "../__mocks__/@tauri-apps/plugin-fs/index";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  contentCache,
  MAX_CONTENT_CACHE_HTML_BYTES,
} from "./content-cache";

function cachePath(globalId: string): string {
  return `/mock/app-data/content/${globalId}.html`;
}

describe("desktop content cache", () => {
  beforeEach(() => {
    __resetMemfs();
  });

  it("stores and reads HTML within the renderer budget", async () => {
    await contentCache.set("article-small", "<article>Readable</article>");

    expect(new TextDecoder().decode(__readMemfs(cachePath("article-small")))).toContain("Readable");
    await expect(contentCache.get("article-small")).resolves.toContain("Readable");
  });

  it("skips oversized HTML writes and removes stale cache content for that item", async () => {
    await writeTextFile(cachePath("article-huge"), "<article>old</article>");

    await contentCache.set("article-huge", "x".repeat(MAX_CONTENT_CACHE_HTML_BYTES + 1));

    expect(__readMemfs(cachePath("article-huge"))).toBeUndefined();
    await expect(contentCache.get("article-huge")).resolves.toBeNull();
  });

  it("deletes oversized legacy files before returning cached HTML", async () => {
    await writeTextFile(cachePath("article-legacy"), "x".repeat(MAX_CONTENT_CACHE_HTML_BYTES + 1));

    await expect(contentCache.get("article-legacy")).resolves.toBeNull();
    expect(__readMemfs(cachePath("article-legacy"))).toBeUndefined();
  });

  it("prunes oversized legacy files without touching small cached articles", async () => {
    await writeTextFile(cachePath("article-small"), "<article>small</article>");
    await writeTextFile(cachePath("article-legacy"), "x".repeat(MAX_CONTENT_CACHE_HTML_BYTES + 1));

    await expect(contentCache.pruneOversized()).resolves.toBe(1);

    expect(__readMemfs(cachePath("article-small"))).toBeDefined();
    expect(__readMemfs(cachePath("article-legacy"))).toBeUndefined();
  });
});
