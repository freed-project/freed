import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  chromium,
  expect,
  test,
  webkit,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  pwaCorpusHardeningBaseUrl,
  pwaCorpusHardeningBrowser,
} from "./corpus-hardening-e2e-settings";

/**
 * Nightly tier. This catches PWA OPFS regressions that only appear once the
 * Library is large, including an unbounded named query, a corpus-sized browser
 * allocation, or storage growth that cannot be compared across exact fixtures.
 * It is deliberately absent from pull request and release gates.
 */
const requestedTarget = Number(process.env.FREED_PWA_CORPUS_TARGET ?? "100000");
const smokeTarget = 256;
const contractTargets = [25_000, 100_000] as const;
const supportedTargets = [smokeTarget, ...contractTargets] as const;

if (!supportedTargets.includes(requestedTarget as 256 | 25_000 | 100_000)) {
  throw new Error("FREED_PWA_CORPUS_TARGET must be 256, 25000, or 100000");
}

const target = requestedTarget as 256 | 25_000 | 100_000;
const milestones =
  target === smokeTarget
    ? [smokeTarget]
    : contractTargets.filter((value) => value <= target);
const reportPath = resolve(
  process.cwd(),
  process.env.FREED_PWA_CORPUS_REPORT ??
    "test-results/pwa-library-corpus-hardening.json",
);

interface BrowserLibraryCore {
  addItems(items: unknown[]): Promise<void>;
  facetSummary(): Promise<{ totalCount: number }>;
  queryNormalized(query: unknown): Promise<unknown>;
}

interface MemorySample {
  readonly measurement:
    "measureUserAgentSpecificMemory" | "performance.memory" | "unsupported";
  readonly bytes: number | null;
  readonly sampledPeakPageHeapBytes: number | null;
}

interface MilestoneReport {
  readonly corpusCount: number;
  readonly feedPage: {
    readonly durationMs: number;
    readonly rowCount: number;
    readonly totalCount: number;
  };
  readonly facets: {
    readonly durationMs: number;
    readonly totalCount: number;
  };
  readonly memory: MemorySample;
  readonly searchPage: {
    readonly durationMs: number;
    readonly rowCount: number;
    readonly scannedRows: number;
  };
  readonly storage: {
    readonly quotaBytes: number | null;
    readonly usageBytes: number | null;
  };
}

async function acceptLegalGate(page: Page): Promise<void> {
  const accept = page.getByTestId("legal-gate-accept");
  if (!(await accept.isVisible({ timeout: 5_000 }).catch(() => false))) return;
  await page.getByRole("checkbox").check();
  await expect(accept).toBeEnabled();
  await accept.click();
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto(pwaCorpusHardeningBaseUrl);
  await acceptLegalGate(page);
  await page.waitForFunction(() => {
    const current = window as unknown as Record<string, unknown>;
    const store = current.__FREED_STORE__ as
      { getState(): { isInitialized: boolean } } | undefined;
    return (
      store?.getState().isInitialized === true &&
      typeof current.__FREED_LIBRARY_CORE__ === "object"
    );
  });
}

async function seedUntil(
  page: Page,
  from: number,
  to: number,
): Promise<number | null> {
  return page.evaluate(
    async ({ start, end }) => {
      const library = (window as unknown as Record<string, unknown>)
        .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
      const batchSize = 128;
      const publishedBase = 1_800_000_000_000;
      const memory = performance as Performance & {
        memory?: { usedJSHeapSize: number };
      };
      let sampledPeakPageHeapBytes: number | null = null;
      for (let offset = start; offset < end; offset += batchSize) {
        const batchEnd = Math.min(offset + batchSize, end);
        const batch = [];
        for (let index = offset; index < batchEnd; index += 1) {
          batch.push({
            globalId: `rss:https://corpus.invalid/feed.xml:item-${index}`,
            platform: "rss",
            contentType: "article",
            capturedAt: publishedBase - index,
            publishedAt: publishedBase - index,
            author: {
              id: "corpus-author",
              handle: "corpus-author",
              displayName: "Corpus Author",
            },
            content: {
              text: `Deterministic SQLite benchmark item ${index.toLocaleString()}`,
              mediaUrls: [],
              mediaTypes: [],
            },
            userState: {
              hidden: false,
              saved: false,
              archived: false,
              tags: [],
            },
            topics: [],
            rssSource: {
              feedUrl: "https://corpus.invalid/feed.xml",
              feedTitle: "Deterministic Corpus",
            },
          });
        }
        await library.addItems(batch);
        const usedHeap = memory.memory?.usedJSHeapSize;
        if (Number.isFinite(usedHeap)) {
          sampledPeakPageHeapBytes = Math.max(
            sampledPeakPageHeapBytes ?? 0,
            usedHeap ?? 0,
          );
        }
        if (batchEnd % 5_000 === 0 || batchEnd === end) {
          console.info(
            `PWA corpus seed reached ${batchEnd.toLocaleString()} items`,
          );
        }
      }
      return sampledPeakPageHeapBytes;
    },
    { start: from, end: to },
  );
}

async function measureMemory(
  page: Page,
  sampledPeakPageHeapBytes: number | null,
): Promise<MemorySample> {
  const current = await page.evaluate(async () => {
    const candidate = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      memory?: { usedJSHeapSize: number };
    };
    if (
      crossOriginIsolated &&
      typeof candidate.measureUserAgentSpecificMemory === "function"
    ) {
      try {
        const measured = await candidate.measureUserAgentSpecificMemory();
        return {
          bytes: measured.bytes,
          measurement: "measureUserAgentSpecificMemory" as const,
        };
      } catch {
        // Fall through to the Chromium heap counter when the memory API is
        // present but temporarily unavailable.
      }
    }
    if (Number.isFinite(candidate.memory?.usedJSHeapSize)) {
      return {
        bytes: candidate.memory?.usedJSHeapSize ?? null,
        measurement: "performance.memory" as const,
      };
    }
    return { bytes: null, measurement: "unsupported" as const };
  });
  return { ...current, sampledPeakPageHeapBytes };
}

async function measureMilestone(
  page: Page,
  baselineCount: number,
  corpusCount: number,
): Promise<MilestoneReport> {
  return page.evaluate(
    async ({ baseline, count }) => {
      const library = (window as unknown as Record<string, unknown>)
        .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
      const measure = async <T>(operation: () => Promise<T>) => {
        const startedAt = performance.now();
        const value = await operation();
        return { durationMs: performance.now() - startedAt, value };
      };
      const token = crypto.randomUUID();
      const feed = await measure(
        () =>
          library.queryNormalized({
            cancellationId: `corpus-feed-cancel:${token}`,
            cursor: null,
            limit: 64,
            queryId: "feed_page_v1",
            readerSessionId: `corpus-feed-reader:${token}`,
            schemaVersion: 1,
          }) as Promise<{
            rows: unknown[];
            totalCount: number;
          }>,
      );
      const facets = await measure(() => library.facetSummary());
      const search = await measure(
        () =>
          library.queryNormalized({
            cancellationId: `corpus-search-cancel:${token}`,
            cursor: null,
            filter: {
              archivedOnly: false,
              authorId: null,
              feedUrl: null,
              platform: null,
              savedOnly: false,
              schemaVersion: 1,
              showHidden: false,
              signals: [],
              socialContentFilter: "all",
              tags: [],
            },
            friendsPredicateSchemaVersion: 1,
            identityMode: "all_content",
            limit: 32,
            query: "deterministic benchmark",
            queryId: "search_page_v1",
            readerSessionId: `corpus-search-reader:${token}`,
            recommendationOrderSchemaVersion: 1,
            schemaVersion: 1,
          }) as Promise<{ rows: unknown[]; scannedRows: number }>,
      );
      const storage = await navigator.storage.estimate();
      return {
        corpusCount: count,
        feedPage: {
          durationMs: feed.durationMs,
          rowCount: feed.value.rows.length,
          totalCount: feed.value.totalCount - baseline,
        },
        facets: {
          durationMs: facets.durationMs,
          totalCount: facets.value.totalCount - baseline,
        },
        memory: {
          bytes: null,
          measurement: "unsupported" as const,
          sampledPeakPageHeapBytes: null,
        },
        searchPage: {
          durationMs: search.durationMs,
          rowCount: search.value.rows.length,
          scannedRows: search.value.scannedRows,
        },
        storage: {
          quotaBytes: Number.isFinite(storage.quota)
            ? (storage.quota ?? null)
            : null,
          usageBytes: Number.isFinite(storage.usage)
            ? (storage.usage ?? null)
            : null,
        },
      };
    },
    { baseline: baselineCount, count: corpusCount },
  );
}

async function writeReport(
  context: BrowserContext,
  reports: readonly MilestoneReport[],
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        browserEngine: pwaCorpusHardeningBrowser,
        browserVersion: context.browser()?.version() ?? "unknown",
        generatedAt: new Date().toISOString(),
        milestones: reports,
        schemaVersion: 2,
        target,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("OPFS SQLite keeps PWA queries bounded at representative corpus scale", async () => {
  test.setTimeout(3_600_000);
  const profileRoot = resolve(
    process.cwd(),
    `test-results/pwa-library-corpus-${pwaCorpusHardeningBrowser}-profile`,
  );
  let context: BrowserContext | null = null;
  const reports: MilestoneReport[] = [];
  let completed = false;
  let sampledPeakPageHeapBytes: number | null = null;

  try {
    await rm(profileRoot, { force: true, recursive: true });
    context =
      pwaCorpusHardeningBrowser === "webkit"
        ? await webkit.launchPersistentContext(profileRoot, {
            baseURL: pwaCorpusHardeningBaseUrl,
            headless: true,
          })
        : await chromium.launchPersistentContext(profileRoot, {
            args: ["--enable-precise-memory-info"],
            baseURL: pwaCorpusHardeningBaseUrl,
            headless: true,
          });
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (message) => {
      if (message.type() === "info") console.info(message.text());
    });
    await openLibrary(page);
    const baseline = await page.evaluate(async () => {
      const library = (window as unknown as Record<string, unknown>)
        .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
      return (await library.facetSummary()).totalCount;
    });

    let seeded = 0;
    for (const milestone of milestones) {
      const segmentPeak = await seedUntil(page, seeded, milestone);
      if (segmentPeak !== null) {
        sampledPeakPageHeapBytes = Math.max(
          sampledPeakPageHeapBytes ?? 0,
          segmentPeak,
        );
      }
      seeded = milestone;
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const library = (window as unknown as Record<string, unknown>)
                .__FREED_LIBRARY_CORE__ as BrowserLibraryCore;
              return (await library.facetSummary()).totalCount;
            }),
          { timeout: 120_000 },
        )
        .toBe(baseline + milestone);
      const report = await measureMilestone(page, baseline, milestone);
      reports.push({
        ...report,
        memory: await measureMemory(page, sampledPeakPageHeapBytes),
      });
      await writeReport(context, reports);
      expect(report.feedPage.rowCount).toBeLessThanOrEqual(64);
      expect(report.feedPage.totalCount).toBe(report.corpusCount);
      expect(report.facets.totalCount).toBe(report.corpusCount);
      expect(report.searchPage.rowCount).toBeLessThanOrEqual(32);
      expect(report.searchPage.scannedRows).toBeLessThanOrEqual(256);
      expect(report.storage.usageBytes).not.toBeNull();
    }

    console.info(`PWA corpus report: ${reportPath}`);
    completed = true;
  } finally {
    await context?.close();
    if (completed) await rm(profileRoot, { force: true, recursive: true });
  }
});
