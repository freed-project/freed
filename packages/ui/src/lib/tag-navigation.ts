export interface TopLevelTagFilter {
  label: string;
  tags: string[];
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
