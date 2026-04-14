export type ReadTrackRow<TItem> =
  | { type: "item"; item: TItem }
  | { type: "stories"; items: TItem[] };

export interface VirtualRowRange {
  index: number;
  end: number;
}

export interface ListViewportMetrics {
  scrollTop: number;
  viewportBottom: number;
}

export function collectUnreadIdsFromRows<TItem extends { globalId: string; userState: { readAt?: number } }>(
  rows: Array<ReadTrackRow<TItem>>,
  startIndex: number,
  endIndex: number,
): string[] {
  if (endIndex < startIndex) return [];
  const unreadIds: string[] = [];
  for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex++) {
    const row = rows[rowIndex];
    if (!row) continue;
    const rowItems = row.type === "item" ? [row.item] : row.items;
    for (const item of rowItems) {
      if (!item.userState.readAt) unreadIds.push(item.globalId);
    }
  }
  return unreadIds;
}

export function getNewlyPassedRowEnd(
  virtualRows: VirtualRowRange[],
  scrollTop: number,
  rowCount: number,
  previousMaxPassedRowIndex: number,
): number | null {
  const firstVisible = virtualRows.find((row) => row.end > scrollTop);
  const newlyPassedEnd = (firstVisible?.index ?? rowCount) - 1;
  return newlyPassedEnd > previousMaxPassedRowIndex ? newlyPassedEnd : null;
}

export function getRemainingUnreadIds<TItem extends { globalId: string; userState: { readAt?: number } }>(
  items: TItem[],
): string[] {
  return items
    .filter((item) => !item.userState.readAt)
    .map((item) => item.globalId);
}

export function getListViewportMetrics(
  rawScrollTop: number,
  viewportHeight: number,
  scrollMargin: number = 0,
): ListViewportMetrics {
  const scrollTop = Math.max(0, rawScrollTop - scrollMargin);
  return {
    scrollTop,
    viewportBottom: scrollTop + viewportHeight,
  };
}

export function hasReachedListBottom(
  rowCount: number,
  viewportBottom: number,
  totalSize: number,
): boolean {
  return rowCount > 0 && viewportBottom >= totalSize - 1;
}
