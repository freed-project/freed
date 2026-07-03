import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLocationTimelineBounds,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  resolveMapMode,
  type LocationTimeRange,
} from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useResolvedLocations } from "../../hooks/useResolvedLocations.js";
import { openAccountFromMap, openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
import { MapSurface } from "./MapSurface.js";

const timeRangeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

type TimePreset = "all" | "today-future" | "today" | "last-week";

type MapViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

interface MapViewProps {
  viewportInsets?: MapViewportInsets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameTimeRange(a: LocationTimeRange, b: LocationTimeRange): boolean {
  return a.startAt === b.startAt && a.endAt === b.endAt;
}

function formatRangeEdge(value: number): string {
  return timeRangeFormatter.format(value);
}

function isFullTimeRange(range: LocationTimeRange, bounds: LocationTimeRange): boolean {
  return range.startAt <= bounds.startAt && range.endAt >= bounds.endAt;
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function addLocalDays(value: number, days: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function clampTimeRangeToBounds(range: LocationTimeRange, bounds: LocationTimeRange): LocationTimeRange {
  const startAt = clamp(range.startAt, bounds.startAt, bounds.endAt);
  const endAt = clamp(range.endAt, bounds.startAt, bounds.endAt);
  if (startAt <= endAt) {
    return { startAt, endAt };
  }
  return { startAt: endAt, endAt };
}

function presetTimeRange(preset: Exclude<TimePreset, "all">, bounds: LocationTimeRange): LocationTimeRange {
  const now = Date.now();
  if (preset === "today") {
    return clampTimeRangeToBounds({
      startAt: addLocalDays(now, -1),
      endAt: endOfLocalDay(now),
    }, bounds);
  }
  if (preset === "today-future") {
    return clampTimeRangeToBounds({
      startAt: addLocalDays(now, -1),
      endAt: bounds.endAt,
    }, bounds);
  }

  return clampTimeRangeToBounds({
    startAt: addLocalDays(now, -7),
    endAt: endOfLocalDay(now),
  }, bounds);
}

function snapTimeBoundsToDays(bounds: LocationTimeRange): LocationTimeRange {
  return {
    startAt: startOfLocalDay(bounds.startAt),
    endAt: endOfLocalDay(bounds.endAt),
  };
}

function snapRangeStartToDay(value: number): number {
  return startOfLocalDay(value);
}

function snapRangeEndToDay(value: number): number {
  return endOfLocalDay(value);
}

function labelPositionStyle(
  percent: number,
  edge: "start" | "end",
  offsetForCollision = false,
): { left: string; transform: string } {
  if (offsetForCollision) {
    if (edge === "start") {
      if (percent <= 8) {
        return { left: `${percent}%`, transform: "translateX(0)" };
      }
      return { left: `${percent}%`, transform: "translateX(calc(-100% - 0.375rem))" };
    }

    if (percent >= 92) {
      return { left: `${percent}%`, transform: "translateX(-100%)" };
    }
    return { left: `${percent}%`, transform: "translateX(0.375rem)" };
  }

  if (percent <= 2) {
    return { left: "0%", transform: "translateX(0)" };
  }
  if (percent >= 98) {
    return { left: "100%", transform: "translateX(-100%)" };
  }
  return { left: `${percent}%`, transform: "translateX(-50%)" };
}

export function MapView({ viewportInsets }: MapViewProps) {
  const items = useAppStore((state) => state.items);
  const persons = useAppStore((state) => state.persons);
  const accounts = useAppStore((state) => state.accounts);
  const selectedPersonId = useAppStore((state) => state.selectedPersonId);
  const setSelectedPerson = useAppStore((state) => state.setSelectedPerson);
  const setSelectedAccount = useAppStore((state) => state.setSelectedAccount);
  const setSelectedItem = useAppStore((state) => state.setSelectedItem);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setFilter = useAppStore((state) => state.setFilter);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const display = useAppStore((state) => state.preferences.display);
  const themeId = display.themeId;
  const [rangeSelection, setRangeSelection] = useState<LocationTimeRange | null>(null);

  const { resolvedItems } = useResolvedLocations(items, persons, accounts);
  const rawTimeBounds = useMemo(() => getLocationTimelineBounds(resolvedItems), [resolvedItems]);
  const timeBounds = useMemo(
    () => (rawTimeBounds ? snapTimeBoundsToDays(rawTimeBounds) : null),
    [rawTimeBounds],
  );
  const effectiveTimeRange = useMemo<LocationTimeRange | null>(() => {
    if (!timeBounds) return null;
    if (!rangeSelection) return timeBounds;

    const startAt = clamp(rangeSelection.startAt, timeBounds.startAt, timeBounds.endAt);
    const endAt = clamp(rangeSelection.endAt, startAt, timeBounds.endAt);
    return { startAt, endAt };
  }, [rangeSelection, timeBounds]);
  const friendMarkers = useMemo(
    () =>
      getLatestFriendLocationMarkers(resolvedItems, {
        timeRange: effectiveTimeRange,
      }),
    [effectiveTimeRange, resolvedItems],
  );
  const allContentMarkers = useMemo(
    () =>
      getLatestAuthorLocationMarkers(resolvedItems, {
        timeRange: effectiveTimeRange,
      }),
    [effectiveTimeRange, resolvedItems],
  );
  const effectiveMode = resolveMapMode(
    display.mapMode,
    friendMarkers.length,
    allContentMarkers.length,
  );
  const markers = effectiveMode === "friends" ? friendMarkers : allContentMarkers;

  useEffect(() => {
    if (!timeBounds) {
      setRangeSelection(null);
      return;
    }

    setRangeSelection((current) => {
      if (!current) return current;

      const next = {
        startAt: clamp(current.startAt, timeBounds.startAt, timeBounds.endAt),
        endAt: clamp(current.endAt, timeBounds.startAt, timeBounds.endAt),
      };
      if (next.startAt > next.endAt) {
        next.startAt = next.endAt;
      }
      if (isFullTimeRange(next, timeBounds)) return null;
      return sameTimeRange(current, next) ? current : next;
    });
  }, [timeBounds]);

  const handleRangeStartChange = useCallback((value: number) => {
    if (!timeBounds) return;

    setRangeSelection((current) => {
      const currentRange = current ?? timeBounds;
      const maxStartAt = startOfLocalDay(currentRange.endAt);
      const next = {
        startAt: clamp(snapRangeStartToDay(value), timeBounds.startAt, maxStartAt),
        endAt: currentRange.endAt,
      };
      return isFullTimeRange(next, timeBounds) ? null : next;
    });
  }, [timeBounds]);

  const handleRangeEndChange = useCallback((value: number) => {
    if (!timeBounds) return;

    setRangeSelection((current) => {
      const currentRange = current ?? timeBounds;
      const minEndAt = endOfLocalDay(currentRange.startAt);
      const next = {
        startAt: currentRange.startAt,
        endAt: clamp(snapRangeEndToDay(value), minEndAt, timeBounds.endAt),
      };
      return isFullTimeRange(next, timeBounds) ? null : next;
    });
  }, [timeBounds]);

  const handlePresetChange = useCallback((preset: TimePreset) => {
    if (!timeBounds) return;
    if (preset === "all") {
      setRangeSelection(null);
      return;
    }

    const next = presetTimeRange(preset, timeBounds);
    setRangeSelection(isFullTimeRange(next, timeBounds) ? null : next);
  }, [timeBounds]);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedPersonId) ?? null,
    [markers, selectedPersonId]
  );

  const rangeDuration = timeBounds ? Math.max(1, timeBounds.endAt - timeBounds.startAt) : 1;
  const rangeStartPercent =
    timeBounds && effectiveTimeRange
      ? ((effectiveTimeRange.startAt - timeBounds.startAt) / rangeDuration) * 100
      : 0;
  const rangeEndPercent =
    timeBounds && effectiveTimeRange
      ? ((effectiveTimeRange.endAt - timeBounds.startAt) / rangeDuration) * 100
      : 100;
  const rangeWidthPercent = Math.max(0, rangeEndPercent - rangeStartPercent);
  const labelsAreClose = Math.abs(rangeEndPercent - rangeStartPercent) < 12;
  const minRangeValue = timeBounds?.startAt ?? 0;
  const maxRangeValue = timeBounds?.endAt ?? 0;
  const rangeStep = timeBounds ? "any" : 1;
  const activePreset =
    timeBounds && effectiveTimeRange
      ? isFullTimeRange(effectiveTimeRange, timeBounds)
        ? "all"
        : sameTimeRange(effectiveTimeRange, presetTimeRange("today", timeBounds))
          ? "today"
          : sameTimeRange(effectiveTimeRange, presetTimeRange("today-future", timeBounds))
            ? "today-future"
            : sameTimeRange(effectiveTimeRange, presetTimeRange("last-week", timeBounds))
              ? "last-week"
              : null
      : null;
  const timePresets: Array<{ value: TimePreset; label: string; testId: string }> = [
    { value: "last-week", label: "last week", testId: "map-time-preset-last-week" },
    { value: "today", label: "today", testId: "map-time-preset-today" },
    { value: "today-future", label: "today + future", testId: "map-time-preset-today-future" },
    { value: "all", label: "all time", testId: "map-time-preset-all" },
  ];
  const emptyTitle = effectiveMode === "friends" ? "No friend pins in this time range." : "No location pins in this time range.";
  const emptyBody =
    effectiveMode === "friends"
      ? "Expand the time range or switch to All content to see more location history."
      : "Expand the time range to include more captured posts and planning windows.";

  return (
    <div className="app-theme-shell relative h-full overflow-hidden">
      <div
        className="pointer-events-none absolute bottom-4 z-20 flex justify-start"
        style={{
          left: "calc(var(--freed-canvas-viewport-inset-left, 0px) + 1rem)",
          maxWidth: "calc(100% - var(--freed-canvas-viewport-inset-left, 0px) - var(--freed-canvas-viewport-inset-right, 0px) - 2rem)",
        }}
      >
        <div
          className="pointer-events-auto theme-floating-panel w-[min(32rem,calc(100vw-2rem))] px-4 py-3"
          data-testid="map-time-range-slider"
        >
          <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-[color:var(--theme-text-muted)]">
            <span>Time</span>
            <div className="flex flex-wrap items-center justify-end gap-1 text-right">
              {timePresets.map((preset) => {
                const active = activePreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    data-testid={preset.testId}
                    aria-pressed={active}
                    disabled={!timeBounds}
                    className={`rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${
                      active
                        ? "border-[color:rgb(var(--theme-accent-secondary-rgb)/0.28)] bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.14)] text-[color:var(--theme-text-primary)]"
                        : "border-transparent text-[color:var(--theme-text-muted)] hover:bg-[color:var(--theme-bg-soft)] hover:text-[color:var(--theme-text-secondary)]"
                    } disabled:pointer-events-none disabled:opacity-50`}
                    onClick={() => handlePresetChange(preset.value)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="relative mt-3 h-11">
            <div className="absolute left-0 right-0 top-3.5 h-1 -translate-y-1/2 rounded-full bg-[color:var(--theme-border-subtle)]" />
            <div
              className="absolute top-3.5 h-1 -translate-y-1/2 rounded-full bg-[color:var(--theme-accent-secondary)]"
              style={{
                left: `${rangeStartPercent}%`,
                width: `${rangeWidthPercent}%`,
              }}
            />
            <input
              type="range"
              min={minRangeValue}
              max={maxRangeValue}
              step={rangeStep}
              value={effectiveTimeRange?.startAt ?? minRangeValue}
              aria-label="Map time range start"
              data-testid="map-time-range-start"
              disabled={!timeBounds || !effectiveTimeRange}
              className="freed-map-range-input"
              onChange={(event) => handleRangeStartChange(Number.parseInt(event.currentTarget.value, 10))}
            />
            <input
              type="range"
              min={minRangeValue}
              max={maxRangeValue}
              step={rangeStep}
              value={effectiveTimeRange?.endAt ?? maxRangeValue}
              aria-label="Map time range end"
              data-testid="map-time-range-end"
              disabled={!timeBounds || !effectiveTimeRange}
              className="freed-map-range-input"
              onChange={(event) => handleRangeEndChange(Number.parseInt(event.currentTarget.value, 10))}
            />
            <span
              className="absolute top-8 whitespace-nowrap text-[10px] text-[color:var(--theme-text-soft)]"
              data-testid="map-time-range-start-label"
              style={labelPositionStyle(rangeStartPercent, "start", labelsAreClose)}
            >
              {effectiveTimeRange ? formatRangeEdge(effectiveTimeRange.startAt) : "Start"}
            </span>
            <span
              className="absolute top-8 whitespace-nowrap text-[10px] text-[color:var(--theme-text-soft)]"
              data-testid="map-time-range-end-label"
              style={labelPositionStyle(rangeEndPercent, "end", labelsAreClose)}
            >
              {effectiveTimeRange ? formatRangeEdge(effectiveTimeRange.endAt) : "End"}
            </span>
          </div>
        </div>
      </div>

      <MapSurface
        markers={markers}
        focusedMarkerKey={focusedMarker?.key ?? null}
        themeId={themeId}
        viewportInsets={viewportInsets}
        onOpenFriend={(marker) => {
          openFriendFromMap(marker, {
            setActiveView,
            setSelectedPerson,
            setSelectedAccount,
            setSelectedItem,
          });
        }}
        onPromoteAccount={(marker) => {
          openAccountFromMap(marker, accounts, {
            setActiveView,
            setSelectedPerson,
            setSelectedAccount,
            setSelectedItem,
          });
        }}
        onLinkAccount={(marker) => {
          openAccountFromMap(marker, accounts, {
            setActiveView,
            setSelectedPerson,
            setSelectedAccount,
            setSelectedItem,
          });
        }}
        onOpenPost={(marker) => {
          openPostFromMap(marker, {
            setActiveView,
            setSelectedPerson,
            setSelectedAccount,
            setSelectedItem,
            setFilter,
            setSearchQuery,
          });
        }}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
      />
    </div>
  );
}
