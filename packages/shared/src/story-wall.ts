import { PLATFORM_LABELS } from "./types.js";
import type { FeedItem, Platform, StoryWallPreferences } from "./types.js";

export interface StoryWallCandidate {
  readonly accountId: string | null;
  readonly item: FeedItem;
  readonly personId: string | null;
}

export interface StoryWallMediaAsset {
  id: string;
  itemId?: string;
  provider: Platform | "archive";
  mediaType: "image" | "video" | "link" | "unknown";
  sourceUrl?: string;
  publishedPath?: string;
  byteSize?: number;
  capturedAt: number;
}

export interface StoryWallManifestItem {
  id: string;
  year: number;
  platform: Platform;
  platformLabel: string;
  accountId: string;
  authorName: string;
  authorHandle?: string;
  text?: string;
  capturedAt: number;
  publishedAt: number;
  locationName?: string;
  sourceUrl?: string;
  featured: boolean;
  media: StoryWallMediaAsset[];
}

export interface StoryWallManifestYear {
  year: number;
  itemCount: number;
  mediaCount: number;
  items: StoryWallManifestItem[];
}

export interface StoryWallManifest {
  version: 1;
  generatedAt: number;
  layoutPreset: StoryWallPreferences["layoutPreset"];
  style: StoryWallPreferences["style"];
  embedModeEnabled: boolean;
  years: StoryWallManifestYear[];
  totalItems: number;
  totalMedia: number;
}

export interface StoryWallMediaReference {
  itemId?: string;
  provider?: Platform | "archive";
  mediaType?: "image" | "video" | "link" | "unknown";
  sourceUrl?: string;
  publishedPath?: string;
  byteSize?: number;
  capturedAt?: number;
}

export interface BuildStoryWallManifestOptions {
  generatedAt?: number;
  mediaReferences?: StoryWallMediaReference[];
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => b - a);
}

function itemTimestamp(item: FeedItem): number {
  return item.publishedAt || item.capturedAt;
}

function storyWallYearForItem(item: FeedItem): number {
  return new Date(itemTimestamp(item)).getFullYear();
}

function itemHasStoryWallMedia(item: FeedItem): boolean {
  return item.content.mediaUrls.some((url) => typeof url === "string" && url.trim().length > 0);
}

export function selectableStoryWallYears(items: readonly FeedItem[]): number[] {
  return uniqueSortedNumbers(
    items
      .filter((item) => !item.userState.hidden && !item.userState.archived && itemHasStoryWallMedia(item))
      .map(storyWallYearForItem),
  );
}

export function selectStoryWallCandidates(
  candidates: readonly StoryWallCandidate[],
  preferences: StoryWallPreferences,
): StoryWallCandidate[] {
  const selectedYears = new Set(preferences.selectedYears);
  const includedPlatforms = new Set<Platform>(preferences.includedPlatforms);
  const includedAccountIds = new Set(preferences.includedAccountIds);
  const hiddenIds = new Set(preferences.hiddenItemIds);

  return candidates
    .filter((candidate) => {
      const item = candidate.item;
      if (hiddenIds.has(item.globalId)) return false;
      if (item.userState.hidden || item.userState.archived) return false;
      if (!itemHasStoryWallMedia(item)) return false;
      if (!includedPlatforms.has(item.platform)) return false;
      if (selectedYears.size > 0 && !selectedYears.has(storyWallYearForItem(item))) return false;
      if (includedAccountIds.size === 0) return true;
      return [item.author.id, candidate.accountId, candidate.personId].some(
        (id) => id !== null && includedAccountIds.has(id),
      );
    })
    .sort((a, b) => itemTimestamp(b.item) - itemTimestamp(a.item));
}

function referencesForItem(
  item: FeedItem,
  references: readonly StoryWallMediaReference[],
): StoryWallMediaAsset[] {
  const matched = references
    .filter((reference) => reference.itemId === item.globalId)
    .map((reference, index) => ({
      id: `${item.globalId}:asset:${index}`,
      itemId: item.globalId,
      provider: reference.provider ?? item.platform,
      mediaType: reference.mediaType ?? "unknown",
      sourceUrl: reference.sourceUrl,
      publishedPath: reference.publishedPath,
      byteSize: reference.byteSize,
      capturedAt: reference.capturedAt ?? item.capturedAt,
    }));

  if (matched.length > 0) return matched;

  return item.content.mediaUrls.map((sourceUrl, index) => ({
    id: `${item.globalId}:media:${index}`,
    itemId: item.globalId,
    provider: item.platform,
    mediaType: item.content.mediaTypes[index] ?? "unknown",
    sourceUrl,
    capturedAt: item.capturedAt,
  }));
}

export function buildStoryWallManifest(
  candidates: readonly StoryWallCandidate[],
  preferences: StoryWallPreferences,
  options: BuildStoryWallManifestOptions = {},
): StoryWallManifest {
  const featuredIds = new Set(preferences.featuredItemIds);
  const filtered = selectStoryWallCandidates(candidates, preferences);
  const grouped = new Map<number, StoryWallCandidate[]>();
  for (const candidate of filtered) {
    const year = storyWallYearForItem(candidate.item);
    grouped.set(year, [...(grouped.get(year) ?? []), candidate]);
  }
  const years = Array.from(grouped.entries())
    .sort(([left], [right]) => right - left)
    .map(([year, yearCandidates]) => {
      const manifestItems = yearCandidates.map((candidate) => {
        const item = candidate.item;
        const media = referencesForItem(item, options.mediaReferences ?? []);
        return {
          id: item.globalId,
          year,
          platform: item.platform,
          platformLabel: PLATFORM_LABELS[item.platform],
          accountId: candidate.accountId ?? item.author.id,
          authorName: item.author.displayName || item.author.handle || "Unknown",
          authorHandle: item.author.handle,
          text: preferences.style.captionsEnabled ? item.content.text : undefined,
          capturedAt: item.capturedAt,
          publishedAt: item.publishedAt,
          locationName: item.location?.name,
          sourceUrl: item.sourceUrl,
          featured: featuredIds.has(item.globalId),
          media,
        } satisfies StoryWallManifestItem;
      });
      return {
        year,
        itemCount: manifestItems.length,
        mediaCount: manifestItems.reduce((sum, item) => sum + item.media.length, 0),
        items: manifestItems,
      };
    });

  return {
    version: 1,
    generatedAt: options.generatedAt ?? Date.now(),
    layoutPreset: preferences.layoutPreset,
    style: preferences.style,
    embedModeEnabled: preferences.embedModeEnabled,
    years,
    totalItems: years.reduce((sum, year) => sum + year.itemCount, 0),
    totalMedia: years.reduce((sum, year) => sum + year.mediaCount, 0),
  };
}

export function estimateStoryWallPublishSize(manifest: StoryWallManifest): number {
  const jsonSize = new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
  const mediaSize = manifest.years.reduce(
    (sum, year) =>
      sum + year.items.reduce(
        (itemSum, item) => itemSum + item.media.reduce((mediaSum, media) => mediaSum + (media.byteSize ?? 0), 0),
        0,
      ),
    0,
  );
  return jsonSize + mediaSize;
}
