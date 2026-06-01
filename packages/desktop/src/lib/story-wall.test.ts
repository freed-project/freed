import { describe, expect, it } from "vitest";
import type { FeedItem, StoryWallPreferences } from "@freed/shared";
import {
  buildStoryWallManifest,
  selectStoryWallItems,
  storyWallYearForItem,
} from "@freed/shared";

function item(
  id: string,
  platform: FeedItem["platform"],
  publishedAt: number,
  overrides: Partial<FeedItem> = {},
): FeedItem {
  return {
    globalId: id,
    platform,
    contentType: platform === "instagram" ? "story" : "post",
    capturedAt: publishedAt + 100,
    publishedAt,
    author: {
      id: `${platform}-ada`,
      handle: "ada",
      displayName: "Ada",
    },
    content: {
      text: "A bright day",
      mediaUrls: [`https://cdn.example.com/${id}.jpg`],
      mediaTypes: ["image"],
    },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    sourceUrl: `https://example.com/${id}`,
    ...overrides,
  };
}

const preferences: StoryWallPreferences = {
  enabled: true,
  selectedYears: [2024],
  includedPlatforms: ["instagram", "facebook"],
  includedAccountIds: [],
  visibilityDefault: "private_review",
  layoutPreset: "mosaic",
  style: {
    palette: "paper",
    typographyScale: 1,
    mediaDensity: 0.7,
    captionsEnabled: true,
    locationGroupingEnabled: true,
    dateGroupingEnabled: true,
    motionLevel: "light",
  },
  embedModeEnabled: true,
  publishTarget: {
    provider: "github_pages",
    repoName: "freed-story-wall",
    branch: "main",
    directory: "docs",
    status: "idle",
  },
  featuredItemIds: ["instagram:one"],
  hiddenItemIds: ["facebook:hidden"],
};

describe("story wall selection", () => {
  it("groups content by publish year", () => {
    expect(storyWallYearForItem(item("instagram:one", "instagram", Date.UTC(2024, 3, 2)))).toBe(2024);
  });

  it("filters by year, platform, hidden item, and archive state", () => {
    const selected = selectStoryWallItems([
      item("instagram:one", "instagram", Date.UTC(2024, 3, 2)),
      item("instagram:no-media", "instagram", Date.UTC(2024, 3, 3), {
        content: {
          text: "Only text",
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
      item("facebook:hidden", "facebook", Date.UTC(2024, 4, 2)),
      item("x:wrong-platform", "x", Date.UTC(2024, 5, 2)),
      item("instagram:old", "instagram", Date.UTC(2023, 5, 2)),
      item("instagram:archived", "instagram", Date.UTC(2024, 6, 2), {
        userState: { hidden: false, saved: false, archived: true, tags: [] },
      }),
    ], preferences);

    expect(selected.map((entry) => entry.globalId)).toEqual(["instagram:one"]);
  });

  it("builds a publish manifest with captions and featured state", () => {
    const manifest = buildStoryWallManifest([
      item("instagram:one", "instagram", Date.UTC(2024, 3, 2)),
    ], preferences, { generatedAt: 1 });

    expect(manifest.totalItems).toBe(1);
    expect(manifest.totalMedia).toBe(1);
    expect(manifest.years[0]?.items[0]).toMatchObject({
      id: "instagram:one",
      featured: true,
      text: "A bright day",
    });
  });
});
