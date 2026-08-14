import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

import {
  isLibraryCoreProviderSettingsReaderDisabled,
  readSavedLibraryCoreYouTubeVideoUrls,
  scanLibraryCoreProviderItems,
} from "./library-core-provider-settings-runtime";

const LIBRARY_CORE_PROVIDER_SETTINGS_READER_DISABLED_KEY =
  "freed.libraryCore.providerSettingsReaderV1.disabled";
type ScanLibraryCoreProviderSettingsItems = (
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
) => Promise<void>;

function item(
  index: number,
  platform: FeedItem["platform"],
  overrides: Partial<FeedItem> = {},
): FeedItem {
  return {
    globalId: `${platform}:item-${index}`,
    platform,
    contentType: "post",
    capturedAt: index,
    publishedAt: index,
    author: {
      id: `author-${index}`,
      handle: `author-${index}`,
      displayName: `Author ${index}`,
    },
    content: { mediaUrls: [], mediaTypes: [] },
    userState: { saved: false, hidden: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

function pagedScan(
  items: readonly FeedItem[],
): ScanLibraryCoreProviderSettingsItems {
  return async (visitPage) => {
    for (let start = 0; start < items.length; start += 64) {
      await visitPage(items.slice(start, start + 64));
    }
  };
}

describe("Library Core provider settings runtime", () => {
  beforeEach(() => {
    localStorage.removeItem(LIBRARY_CORE_PROVIDER_SETTINGS_READER_DISABLED_KEY);
  });

  it("streams more than 2,500 rows through provider-filtered pages bounded at 64", async () => {
    const corpus = Array.from({ length: 2_624 }, (_, index) =>
      item(
        index,
        index % 4 === 0
          ? "facebook"
          : index % 4 === 1
            ? "instagram"
            : index % 4 === 2
              ? "youtube"
              : "rss",
        index === 5
          ? {
              userState: {
                saved: false,
                hidden: true,
                archived: false,
                tags: [],
              },
            }
          : {},
      ),
    );
    const visitedIds: string[] = [];
    let maximumResidentRows = 0;

    await scanLibraryCoreProviderItems(
      "instagram",
      async (page) => {
        maximumResidentRows = Math.max(maximumResidentRows, page.length);
        expect(page.every((entry) => entry.platform === "instagram")).toBe(
          true,
        );
        visitedIds.push(...page.map((entry) => entry.globalId));
        await Promise.resolve();
      },
      { scanItems: pagedScan(corpus) },
    );

    expect(maximumResidentRows).toBeLessThanOrEqual(64);
    expect(visitedIds).toEqual(
      corpus
        .filter(
          (entry) => entry.platform === "instagram" && !entry.userState.hidden,
        )
        .map((entry) => entry.globalId),
    );
  });

  it("reports and enforces the device-local rollback before scanning", async () => {
    localStorage.setItem(
      LIBRARY_CORE_PROVIDER_SETTINGS_READER_DISABLED_KEY,
      "1",
    );
    const scan = vi.fn<ScanLibraryCoreProviderSettingsItems>();

    expect(isLibraryCoreProviderSettingsReaderDisabled()).toBe(true);
    await expect(
      scanLibraryCoreProviderItems("facebook", vi.fn(), { scanItems: scan }),
    ).rejects.toThrow("provider settings reader is disabled");
    await expect(
      readSavedLibraryCoreYouTubeVideoUrls({ scanItems: scan }),
    ).rejects.toThrow("provider settings reader is disabled");
    expect(scan).not.toHaveBeenCalled();
  });

  it("fails closed on invalid scanner pages and propagates source and visitor failures", async () => {
    const oversize = Array.from({ length: 65 }, (_, index) =>
      item(index, "facebook"),
    );
    await expect(
      scanLibraryCoreProviderItems("facebook", vi.fn(), {
        scanItems: async (visitPage) => {
          await visitPage(oversize);
        },
      }),
    ).rejects.toThrow("page exceeds 64 rows");

    await expect(
      scanLibraryCoreProviderItems("facebook", vi.fn(), {
        scanItems: async () => {
          throw new Error("Library Core item scan source changed during read");
        },
      }),
    ).rejects.toThrow("source changed during read");

    await expect(
      scanLibraryCoreProviderItems(
        "facebook",
        async () => {
          throw new Error("visitor rejected page");
        },
        { scanItems: pagedScan([item(1, "facebook")]) },
      ),
    ).rejects.toThrow("visitor rejected page");

    const controller = new AbortController();
    await expect(
      scanLibraryCoreProviderItems(
        "facebook",
        () => {
          controller.abort();
        },
        {
          scanItems: pagedScan([item(1, "facebook"), item(2, "facebook")]),
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("scan was cancelled");
  });

  it("preserves visible saved YouTube parsing, stable order, and cross-page dedupe semantics", async () => {
    const firstId = "ABCDEFGHIJK";
    const secondId = "LMNOPQRSTUV";
    const thirdId = "ZYXWVUTSRQP";
    const firstPage = [
      item(1, "youtube", {
        sourceUrl: `https://youtu.be/${firstId}?feature=share`,
        content: {
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: `https://www.youtube.com/watch?v=${secondId}`,
            title: "secondary identity",
          },
        },
        userState: { saved: true, hidden: true, archived: false, tags: [] },
      }),
      item(2, "youtube", {
        sourceUrl: "https://www.youtube.com/watch?v=invalid",
        content: {
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: `https://www.youtube.com/watch?v=${secondId}`,
            title: "valid fallback",
          },
        },
        userState: { saved: true, hidden: false, archived: false, tags: [] },
      }),
      item(3, "facebook", {
        sourceUrl: `https://www.youtube.com/watch?v=${thirdId}`,
        userState: { saved: true, hidden: false, archived: false, tags: [] },
      }),
    ];
    const secondPage = [
      item(4, "youtube", {
        sourceUrl: `https://www.youtube.com/shorts/${secondId}`,
        userState: { saved: true, hidden: false, archived: false, tags: [] },
      }),
      item(5, "youtube", {
        sourceUrl: "https://example.test/not-youtube",
        userState: { saved: true, hidden: false, archived: false, tags: [] },
      }),
      item(6, "youtube", {
        sourceUrl: `https://www.youtube.com/watch?v=${thirdId}`,
        userState: { saved: false, hidden: false, archived: false, tags: [] },
      }),
    ];
    const scan: ScanLibraryCoreProviderSettingsItems = async (visitPage) => {
      await visitPage(firstPage);
      await visitPage(secondPage);
    };

    await expect(
      readSavedLibraryCoreYouTubeVideoUrls({ scanItems: scan }),
    ).resolves.toEqual([
      `https://www.youtube.com/watch?v=${secondId}`,
      `https://www.youtube.com/watch?v=${thirdId}`,
    ]);
  });
});
