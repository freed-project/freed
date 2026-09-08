import type { FeedItem } from "@freed/shared";

const MAX_DISPLACEMENT = 5;
const MAX_ASSEMBLED_STORIES = 6;
const LOOKAHEAD = MAX_DISPLACEMENT + MAX_ASSEMBLED_STORIES - 1;
const OPENING_STORY_WINDOW = 10;

export interface FeedPresentation {
  /** Canonical rank order, used only to detect a changed ranking. */
  sourceIds: string[];
  /** One opening story may move from the first ten items to the first row. */
  openingStoryId: string | null;
  items: FeedItem[];
  /** A group stays closed when a later reader page arrives. */
  groupById: ReadonlyMap<string, string>;
}

export type FeedRow =
  | { type: "item"; item: FeedItem; itemIndex: number; key: string }
  | {
      type: "stories";
      items: FeedItem[];
      itemIndices: number[];
      numCols: number;
      key: string;
    };

/** Stable partition of a small neighborhood, with displacement checked for
 * articles as well as stories. Never feed the output back in as ranked input. */
function arrange(source: FeedItem[], opening = false, enabled = true): FeedPresentation {
  const firstStory = opening
    ? source.slice(0, OPENING_STORY_WINDOW).findIndex((item) => item.contentType === "story")
    : -1;
  const openingStoryId = firstStory >= 0 ? source[firstStory].globalId : null;
  const items = firstStory > 0
    ? [source[firstStory], ...source.slice(0, firstStory), ...source.slice(firstStory + 1)]
    : source;
  const originalRanks = new Map(source.map((item, i) => [item.globalId, i]));
  const result: FeedItem[] = [];
  const groupById = new Map<string, string>();
  let start = 0;
  while (start < items.length) {
    if (items[start].contentType !== "story") {
      result.push(items[start++]);
      continue;
    }
    let end = start + 1;
    while (end < items.length && items[end].contentType === "story") end++;
    // Preserve an existing uninterrupted run, even when it exceeds six tiles.
    let indices = Array.from({ length: end - start }, (_, i) => start + i);
    for (
      let candidate = end;
      enabled && candidate < items.length && candidate <= start + LOOKAHEAD;
      candidate++
    ) {
      if (indices.length >= MAX_ASSEMBLED_STORIES) break;
      if (items[candidate].contentType !== "story") continue;
      const stories = [
        ...indices.filter((i) => items[i].contentType === "story"),
        candidate,
      ];
      const storySet = new Set(stories);
      const articles = Array.from(
        { length: candidate - start + 1 },
        (_, i) => start + i,
      ).filter((i) => !storySet.has(i));
      const proposed = [...stories, ...articles];
      if (
        proposed.some(
          (original, position) =>
            items[original].globalId !== openingStoryId &&
            Math.abs(originalRanks.get(items[original].globalId)! - (start + position)) > MAX_DISPLACEMENT,
        )
      )
        break;
      indices = proposed;
      end = candidate + 1;
    }
    const group = items[start].globalId;
    for (const index of indices) {
      result.push(items[index]);
      if (items[index].contentType === "story")
        groupById.set(items[index].globalId, group);
    }
    start = end;
  }
  return {
    sourceIds: source.map((item) => item.globalId),
    openingStoryId,
    items: result,
    groupById,
  };
}

/** Keep resident groups on append, prepend, eviction and presentation-only
 * patches. New edges are arranged independently; ranking changes start afresh.
 * All retained state is bounded by the current resident window. */
export function presentFeed(
  items: FeedItem[],
  previous?: FeedPresentation,
  enabled = true,
  opening = false,
): FeedPresentation {
  if (!enabled && !opening) return {
    sourceIds: items.map((item) => item.globalId), items,
    openingStoryId: null, groupById: new Map(),
  };
  if (!enabled) return arrange(items, opening, false);
  if (!previous?.items.length) return arrange(items, opening);
  // Startup imports can first publish a short post-only prefix. Apply the
  // opening rule once its top-ten story arrives, then keep the chosen row.
  if (opening && previous.openingStoryId === null &&
      items.slice(0, OPENING_STORY_WINDOW).some((item) => item.contentType === "story")) {
    return arrange(items, true);
  }
  const sourceIds = items.map((item) => item.globalId);
  const byId = new Map(items.map((item) => [item.globalId, item]));
  const previousIds = new Set(previous.sourceIds);
  const retained = sourceIds.filter((id) => previousIds.has(id));
  const oldRetained = previous.sourceIds.filter((id) => byId.has(id));
  if (!retained.length || retained.some((id, i) => id !== oldRetained[i]))
    return arrange(items, opening);
  const first = sourceIds.indexOf(retained[0]);
  const last = sourceIds.indexOf(retained[retained.length - 1]);
  if (last - first + 1 !== retained.length) return arrange(items, opening);
  const oldById = new Map(previous.items.map((item) => [item.globalId, item]));
  if (
    retained.some(
      (id) => byId.get(id)!.contentType !== oldById.get(id)!.contentType,
    )
  )
    return arrange(items, opening);
  const prefix = arrange(items.slice(0, first));
  const suffix = arrange(items.slice(last + 1));
  const middle = previous.items
    .filter((item) => byId.has(item.globalId))
    .map((item) => byId.get(item.globalId)!);
  const result = [...prefix.items, ...middle, ...suffix.items];
  const ranks = new Map(sourceIds.map((id, index) => [id, index]));
  if (
    result.some(
      (item, index) =>
        item.globalId !== previous.openingStoryId &&
        Math.abs(ranks.get(item.globalId)! - index) > MAX_DISPLACEMENT,
    )
  )
    return arrange(items, opening);
  const groupById = new Map([...prefix.groupById, ...suffix.groupById]);
  for (const item of middle) {
    const group = previous.groupById.get(item.globalId);
    if (group) groupById.set(item.globalId, group);
  }
  return { sourceIds, items: result, groupById, openingStoryId: previous.openingStoryId };
}

/** Row geometry is independent of ranking and navigation order. */
export function buildFeedRows(
  items: FeedItem[],
  maxCols: number,
  groupById?: ReadonlyMap<string, string>,
): FeedRow[] {
  const cols = Math.max(1, Math.min(3, Math.floor(maxCols)));
  const rows: FeedRow[] = [];
  let i = 0;
  while (i < items.length) {
    if (items[i].contentType !== "story") {
      rows.push({
        type: "item",
        item: items[i],
        itemIndex: i,
        key: JSON.stringify([items[i].globalId]),
      });
      i++;
      continue;
    }
    const start = i++;
    while (
      i < items.length &&
      items[i].contentType === "story" &&
      (!groupById ||
        groupById.get(items[i].globalId) ===
          groupById.get(items[start].globalId))
    )
      i++;
    let offset = start;
    let remaining = i - start;
    while (remaining > 0) {
      const size =
        remaining <= cols
          ? remaining
          : cols > 1 && remaining === cols + 1
            ? Math.ceil(remaining / 2)
            : cols;
      const rowItems = items.slice(offset, offset + size);
      rows.push({
        type: "stories",
        items: rowItems,
        itemIndices: Array.from({ length: size }, (_, k) => offset + k),
        numCols: size,
        key: JSON.stringify(rowItems.map((item) => item.globalId)),
      });
      remaining -= size;
      offset += size;
    }
  }
  return rows;
}
