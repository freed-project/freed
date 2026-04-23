import type { FeedItem } from "@freed/shared";

export interface TopLevelTagFilter {
  label: string;
  tags: string[];
}

export function collectAllTags(items: readonly FeedItem[]): string[] {
  const tagSet = new Set<string>();
  for (const item of items) {
    for (const tag of item.userState.tags ?? []) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

export function childTagsOf(allTags: readonly string[], topLevelTag: string): string[] {
  return allTags.filter((tag) => tag === topLevelTag || tag.startsWith(`${topLevelTag}/`));
}

export function buildTopLevelTagFilters(allTags: readonly string[]): TopLevelTagFilter[] {
  const topLevelTags = Array.from(
    new Set(allTags.map((tag) => tag.split("/")[0])),
  ).sort();

  return topLevelTags.map((label) => ({
    label,
    tags: childTagsOf(allTags, label),
  }));
}
