import { PLATFORM_LABELS } from "./types";
import type { Account, FeedItem, Platform, StoryWallPreferences } from "./types.js";

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

function accountIdsForAuthor(item: FeedItem, accounts: Record<string, Account>): string[] {
  const ids = new Set<string>([item.author.id]);
  for (const account of Object.values(accounts)) {
    if (account.provider !== item.platform) continue;
    if (account.externalId === item.author.id || account.handle === item.author.handle) {
      ids.add(account.id);
      if (account.personId) ids.add(account.personId);
    }
  }
  return Array.from(ids);
}

function itemTimestamp(item: FeedItem): number {
  return item.publishedAt || item.capturedAt;
}

export function storyWallYearForItem(item: FeedItem): number {
  return new Date(itemTimestamp(item)).getFullYear();
}

export function selectableStoryWallYears(items: readonly FeedItem[]): number[] {
  return uniqueSortedNumbers(
    items
      .filter((item) => !item.userState.hidden && !item.userState.archived)
      .map(storyWallYearForItem),
  );
}

export function selectStoryWallItems(
  items: readonly FeedItem[],
  preferences: StoryWallPreferences,
  accounts: Record<string, Account> = {},
): FeedItem[] {
  const selectedYears = new Set(preferences.selectedYears);
  const includedPlatforms = new Set<Platform>(preferences.includedPlatforms);
  const includedAccountIds = new Set(preferences.includedAccountIds);
  const hiddenIds = new Set(preferences.hiddenItemIds);

  return items
    .filter((item) => {
      if (hiddenIds.has(item.globalId)) return false;
      if (item.userState.hidden || item.userState.archived) return false;
      if (!includedPlatforms.has(item.platform)) return false;
      if (selectedYears.size > 0 && !selectedYears.has(storyWallYearForItem(item))) return false;
      if (includedAccountIds.size === 0) return true;
      return accountIdsForAuthor(item, accounts).some((id) => includedAccountIds.has(id));
    })
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
}

export function groupStoryWallItemsByYear(items: readonly FeedItem[]): Map<number, FeedItem[]> {
  const groups = new Map<number, FeedItem[]>();
  for (const item of items) {
    const year = storyWallYearForItem(item);
    groups.set(year, [...(groups.get(year) ?? []), item]);
  }
  return new Map(
    Array.from(groups.entries()).sort(([left], [right]) => right - left),
  );
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
  items: readonly FeedItem[],
  preferences: StoryWallPreferences,
  options: BuildStoryWallManifestOptions = {},
): StoryWallManifest {
  const featuredIds = new Set(preferences.featuredItemIds);
  const filtered = selectStoryWallItems(items, preferences);
  const years = Array.from(groupStoryWallItemsByYear(filtered).entries()).map(([year, yearItems]) => {
    const manifestItems = yearItems.map((item) => {
      const media = referencesForItem(item, options.mediaReferences ?? []);
      return {
        id: item.globalId,
        year,
        platform: item.platform,
        platformLabel: PLATFORM_LABELS[item.platform],
        accountId: item.author.id,
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
