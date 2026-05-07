import { useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SearchField } from "../SearchField.js";

export interface SettingsListPanelProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => Key;
  getSearchText: (item: T) => string;
  title?: string;
  summary?: ReactNode;
  searchPlaceholder: string;
  ariaLabel: string;
  emptyLabel: string;
  noMatchesLabel?: string;
  actions?: (filteredItems: readonly T[], query: string) => ReactNode;
  reserveScrollHeight?: boolean;
  className?: string;
  listClassName?: string;
  dataTestId?: string;
  searchDataTestId?: string;
  scrollDataTestId?: string;
  estimateItemSize?: number;
}

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function SettingsListPanel<T>({
  items,
  renderItem,
  itemKey,
  getSearchText,
  title,
  summary,
  searchPlaceholder,
  ariaLabel,
  emptyLabel,
  noMatchesLabel = "No matches.",
  actions,
  reserveScrollHeight = false,
  className,
  listClassName,
  dataTestId,
  searchDataTestId,
  scrollDataTestId,
  estimateItemSize = 72,
}: SettingsListPanelProps<T>) {
  const [query, setQuery] = useState("");
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const normalizedQuery = normalizeSearchText(query);

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      normalizeSearchText(getSearchText(item)).includes(normalizedQuery),
    );
  }, [getSearchText, items, normalizedQuery]);

  const countLabel = normalizedQuery
    ? `${filteredItems.length.toLocaleString()} of ${items.length.toLocaleString()}`
    : `${items.length.toLocaleString()} total`;

  const contentLabel =
    items.length === 0 ? emptyLabel : filteredItems.length === 0 ? noMatchesLabel : null;
  const virtualizer = useVirtualizer({
    count: contentLabel ? 0 : filteredItems.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateItemSize,
    initialRect: { width: 0, height: estimateItemSize * 8 },
    overscan: 6,
    getItemKey: (index) => itemKey(filteredItems[index] as T, index),
  });

  useEffect(() => {
    virtualizer.measure();
  }, [filteredItems.length, normalizedQuery, virtualizer]);

  const measuredVirtualItems = virtualizer.getVirtualItems();
  const virtualRows = measuredVirtualItems.length > 0
    ? measuredVirtualItems
    : filteredItems.slice(0, Math.min(filteredItems.length, 12)).map((_, index) => ({
        index,
        key: itemKey(filteredItems[index] as T, index),
        start: index * estimateItemSize,
      }));
  const totalVirtualSize = Math.max(
    virtualizer.getTotalSize(),
    filteredItems.length * estimateItemSize,
  );

  return (
    <div
      className={joinClasses(
        "settings-list-panel space-y-2 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-3",
        className,
      )}
      data-testid={dataTestId}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {title ? (
            <p className="text-sm text-[var(--theme-text-secondary)]">{title}</p>
          ) : null}
          {summary ? (
            <div className="mt-0.5 text-xs text-[var(--theme-text-muted)]">{summary}</div>
          ) : null}
        </div>
        <p className="shrink-0 text-xs tabular-nums text-[var(--theme-text-muted)]">
          {countLabel}
        </p>
      </div>

      <SearchField
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onClear={() => setQuery("")}
        placeholder={searchPlaceholder}
        aria-label={ariaLabel}
        density="compact"
        containerClassName="shrink-0"
        data-testid={searchDataTestId}
      />

      {actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions(filteredItems, normalizedQuery)}
        </div>
      ) : null}

      <div
        ref={setScrollElement}
        className={joinClasses(
          "settings-list-panel-scroll min-h-0 overflow-y-auto pr-1",
          listClassName,
        )}
        style={{
          maxHeight: "var(--settings-inner-list-max-height)",
          height: reserveScrollHeight
            ? "var(--settings-inner-list-max-height)"
            : undefined,
        }}
        data-testid={scrollDataTestId}
      >
        {contentLabel ? (
          <div className="rounded-lg bg-[var(--theme-bg-muted)] px-3 py-4 text-center text-sm text-[var(--theme-text-muted)]">
            {contentLabel}
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: totalVirtualSize }}
          >
            {virtualRows.map((virtualItem) => {
              const item = filteredItems[virtualItem.index];
              if (!item) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  data-testid="settings-list-virtual-row"
                  className="absolute left-0 top-0 w-full pb-2"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {renderItem(item, virtualItem.index)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
