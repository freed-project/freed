/**
 * Unit tests for importMarkdownFiles and folderTagsFromRelativePath
 *
 * Strategy:
 *  - The real parseMarkdownArchiveFile is called with VALID markdown content
 *    (mocking it proved unreliable due to ESM static binding constraints).
 *  - External I/O (automerge, content-cache, content-fetcher) is mocked.
 *  - folderTagsFromRelativePath is tested directly with various path shapes.
 *
 * Covers:
 *  - Hierarchical tags from webkitRelativePath
 *  - Phased progress callbacks (scanning → writing → caching → fetching)
 *  - Deduplication against existing Automerge items
 *  - Chunking behaviour for large batches (>500 items)
 *  - Accurate imported / skipped counters
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { folderTagsFromRelativePath } from "@freed/capture-save/import-markdown";
import type { ImportPhase, ImportProgress } from "./import-export.js";
import type { FeedItem } from "@freed/shared";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Only mock I/O — NOT the capture-save parser (ESM live bindings prevent it).

const { mockBatchImport, mockGetAllItemIds, mockCacheSet, mockEnqueue } = vi.hoisted(() => {
  const docStore: Record<string, FeedItem> = {};

  const mockBatchImport = vi.fn(
    async (items: FeedItem[], onChunk?: (c: number, t: number) => void) => {
      const CHUNK = 500;
      const total = Math.ceil(items.length / CHUNK);
      for (let i = 0; i < items.length; i += CHUNK) {
        for (const item of items.slice(i, i + CHUNK)) {
          if (!docStore[item.globalId]) docStore[item.globalId] = item;
        }
        onChunk?.(Math.floor(i / CHUNK) + 1, total);
      }
    },
  );

  return {
    mockBatchImport,
    mockGetAllItemIds: vi.fn(async () => Object.keys(docStore)),
    mockCacheSet: vi.fn(async () => undefined),
    mockEnqueue: vi.fn(),
    _docStore: docStore,
  };
});

// Module-level store accessible to test assertions
const docStore: Record<string, FeedItem> = {};

vi.mock("./automerge.js", () => ({
  docBatchImportItems: mockBatchImport,
  getAllItemIds: mockGetAllItemIds,
}));

vi.mock("./content-cache.js", () => ({
  contentCache: { set: mockCacheSet, get: vi.fn() },
}));

vi.mock("./content-fetcher.js", () => ({ enqueue: mockEnqueue }));

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a File with valid Freed Markdown frontmatter.
 * Every URL is unique so globalIds don't collide between tests.
 */
function makeMdFile(
  idx: number,
  opts: { relativePath?: string; withHtml?: boolean; noBody?: boolean } = {},
): File {
  const url = `https://test.example.com/article-${idx}`;
  const title = `Article ${idx}`;
  const body = opts.noBody ? "" : "Body text with enough words for parsing.";
  const htmlExtra = opts.withHtml ? "\n\n<p>Rich HTML body.</p>" : "";

  const content = [
    "---",
    `title: ${title}`,
    `url: ${url}`,
    `createdAt: 2024-01-01T00:00:00.000Z`,
    "---",
    "",
    body + htmlExtra,
  ].join("\n");

  const file = new File([content], `article-${idx}.md`, { type: "text/markdown" });

  if (opts.relativePath) {
    Object.defineProperty(file, "webkitRelativePath", { value: opts.relativePath, writable: false });
  }
  return file;
}

function makeFileList(files: File[]): FileList {
  // Cast a plain array — Array.from() works directly on arrays
  return files as unknown as FileList;
}

// ── folderTagsFromRelativePath tests ──────────────────────────────────────────

describe("folderTagsFromRelativePath", () => {
  it("returns empty array for a top-level file", () => {
    expect(folderTagsFromRelativePath("export/article.md")).toEqual([]);
  });

  it("extracts single subfolder as tag", () => {
    expect(folderTagsFromRelativePath("export/tech/article.md")).toEqual(["tech"]);
  });

  it("builds all ancestor paths for nested folders", () => {
    const tags = folderTagsFromRelativePath("export/tech/ai/gpt.md");
    expect(tags).toEqual(["tech", "tech/ai"]);
  });

  it("handles Windows-style backslash separators", () => {
    const tags = folderTagsFromRelativePath("export\\reading\\sci-fi\\dune.md");
    expect(tags).toEqual(["reading", "reading/sci-fi"]);
  });

  it("returns empty array when depth < 3 (no folder between root and file)", () => {
    expect(folderTagsFromRelativePath("root/file.md")).toEqual([]);
  });
});

// ── importMarkdownFiles tests ─────────────────────────────────────────────────

describe("importMarkdownFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.keys(docStore).forEach((k) => delete docStore[k]);

    // Restore implementations cleared by resetAllMocks()
    mockBatchImport.mockImplementation(
      async (items: FeedItem[], onChunk?: (c: number, t: number) => void) => {
        const CHUNK = 500;
        const total = Math.ceil(items.length / CHUNK);
        for (let i = 0; i < items.length; i += CHUNK) {
        for (const item of items.slice(i, i + CHUNK)) {
          if (!docStore[item.globalId]) docStore[item.globalId] = item;
        }
        onChunk?.(Math.floor(i / CHUNK) + 1, total);
      }
      },
    );
    mockGetAllItemIds.mockImplementation(async () => Object.keys(docStore));
    mockCacheSet.mockResolvedValue(undefined);
  });

  it("emits scanning and writing phases for a normal import", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    const files = makeFileList([makeMdFile(1)]);

    const phases: ImportPhase[] = [];
    await importMarkdownFiles(files, (p) => {
      if (!phases.includes(p.phase)) phases.push(p.phase);
    });

    expect(phases).toContain("scanning");
    expect(phases).toContain("writing");
  });

  it("counts imported items correctly", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    const files = makeFileList([makeMdFile(10), makeMdFile(11), makeMdFile(12)]);

    const result = await importMarkdownFiles(files);
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips items whose globalId already exists in the doc", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");

    // First import — items are new
    const files = makeFileList([makeMdFile(20)]);
    const first = await importMarkdownFiles(files);
    expect(first.imported).toBe(1);

    // Second import of the same file — should be skipped
    const second = await importMarkdownFiles(files);
    expect(second.skipped).toBe(1);
    expect(second.imported).toBe(0);
  });

  it("assigns folder hierarchy tags from webkitRelativePath", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    const file = makeMdFile(30, { relativePath: "my-export/Technology/AI/post.md" });
    const files = makeFileList([file]);

    const result = await importMarkdownFiles(files);
    expect(result.imported).toBe(1);

    const writtenItem = Object.values(docStore)[0];
    expect(writtenItem).toBeDefined();
    expect(writtenItem!.userState.tags).toContain("Technology");
    expect(writtenItem!.userState.tags).toContain("Technology/AI");
  });

  it("reports errors for unparseable files without aborting the batch", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    // A file with no frontmatter
    const badFile = new File(["not markdown at all"], "bad.md");
    const goodFile = makeMdFile(40);

    const result = await importMarkdownFiles(makeFileList([badFile, goodFile]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.imported).toBe(1);
  });

  it("emits per-chunk writing progress for large batches", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    // 1200 distinct files
    const files = makeFileList(
      Array.from({ length: 1200 }, (_, i) => makeMdFile(1000 + i)),
    );

    const writingPhases: ImportProgress[] = [];
    await importMarkdownFiles(files, (p) => {
      if (p.phase === "writing") writingPhases.push({ ...p });
    });

    // 1200 items → 3 chunks (500 + 500 + 200)
    const lastWrite = writingPhases[writingPhases.length - 1];
    expect(lastWrite?.total).toBe(3);
    expect(lastWrite?.current).toBe(3);
  });

  it("caches HTML via contentCache for items with body text", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    const files = makeFileList([makeMdFile(50, { withHtml: true })]);
    await importMarkdownFiles(files);
    // HTML was rendered from body text and stored in contentCache
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it("does not invoke docBatchImportItems when all items are already known", async () => {
    const { importMarkdownFiles } = await import("./import-export.js");
    const files = makeFileList([makeMdFile(60)]);

    // Pre-fill the doc with the item's globalId
    const firstResult = await importMarkdownFiles(files);
    expect(firstResult.imported).toBe(1);

    vi.clearAllMocks();
    // The mock store now reflects docStore state via mockAllItemIds — no extra setup needed.

    await importMarkdownFiles(files);
    expect(mockBatchImport).not.toHaveBeenCalled();
  });
});
