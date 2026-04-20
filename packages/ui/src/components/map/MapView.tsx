import { useEffect, useMemo, useState } from "react";
import {
  getDefaultMapMode,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLocationTimelineMoments,
  type MapTimeMode,
} from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useResolvedLocations } from "../../hooks/useResolvedLocations.js";
import { openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
import { MapSurface } from "./MapSurface.js";

const MAP_TIME_REFRESH_MS = 60_000;
const timelineMomentFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const timelineEdgeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const DEFAULT_TIMELINE_INDEX: Record<Exclude<MapTimeMode, "current">, number> = {
  past: -1,
  future: 0,
};

function formatTimelineMoment(value: number): string {
  return timelineMomentFormatter.format(value);
}

function formatTimelineEdge(value: number): string {
  return timelineEdgeFormatter.format(value);
}

export function MapView() {
  const items = useAppStore((state) => state.items);
  const persons = useAppStore((state) => state.persons);
  const accounts = useAppStore((state) => state.accounts);
  const selectedFriendId = useAppStore((state) => state.selectedPersonId);
  const setSelectedFriend = useAppStore((state) => state.setSelectedPerson);
  const setSelectedItem = useAppStore((state) => state.setSelectedItem);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setFilter = useAppStore((state) => state.setFilter);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const display = useAppStore((state) => state.preferences.display);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const themeId = display.themeId;
  const savedTimeMode = display.mapTimeMode ?? "current";
  const [referenceNow, setReferenceNow] = useState(() => Date.now());
  const [pendingTimeMode, setPendingTimeMode] = useState<MapTimeMode | null>(null);
  const [timelineIndexes, setTimelineIndexes] = useState<Record<Exclude<MapTimeMode, "current">, number | null>>({
    past: null,
    future: null,
  });

  const effectiveTimeMode = pendingTimeMode ?? savedTimeMode;
  const { resolvedItems } = useResolvedLocations(items, persons, accounts);
  const timelineMoments = useMemo(
    () => getLocationTimelineMoments(resolvedItems, { timeMode: effectiveTimeMode, now: referenceNow }),
    [effectiveTimeMode, referenceNow, resolvedItems],
  );
  const selectedTimelineIndex =
    effectiveTimeMode === "current"
      ? null
      : timelineIndexes[effectiveTimeMode];
  const fallbackTimelineIndex =
    effectiveTimeMode === "current"
      ? null
      : DEFAULT_TIMELINE_INDEX[effectiveTimeMode] < 0
        ? Math.max(0, timelineMoments.length - 1)
        : DEFAULT_TIMELINE_INDEX[effectiveTimeMode];
  const effectiveTimelineIndex =
    effectiveTimeMode === "current" || timelineMoments.length === 0
      ? null
      : Math.min(
          selectedTimelineIndex ?? fallbackTimelineIndex ?? 0,
          timelineMoments.length - 1,
        );
  const playbackAt =
    effectiveTimelineIndex === null ? null : timelineMoments[effectiveTimelineIndex] ?? null;
  const friendMarkers = useMemo(
    () =>
      getLatestFriendLocationMarkers(resolvedItems, {
        timeMode: effectiveTimeMode,
        now: referenceNow,
        playbackAt,
      }),
    [effectiveTimeMode, playbackAt, referenceNow, resolvedItems],
  );
  const allContentMarkers = useMemo(
    () =>
      getLatestAuthorLocationMarkers(resolvedItems, {
        timeMode: effectiveTimeMode,
        now: referenceNow,
        playbackAt,
      }),
    [effectiveTimeMode, playbackAt, referenceNow, resolvedItems],
  );
  const defaultMode = useMemo(
    () => getDefaultMapMode(friendMarkers.length, allContentMarkers.length),
    [allContentMarkers.length, friendMarkers.length],
  );
  const savedMode = display.mapMode;
  const effectiveMode = savedMode ?? defaultMode;
  const markers = effectiveMode === "friends" ? friendMarkers : allContentMarkers;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceNow(Date.now());
    }, MAP_TIME_REFRESH_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (pendingTimeMode && savedTimeMode === pendingTimeMode) {
      setPendingTimeMode(null);
    }
  }, [pendingTimeMode, savedTimeMode]);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedFriendId) ?? null,
    [markers, selectedFriendId]
  );

  const handleTimeModeChange = (timeMode: MapTimeMode) => {
    setPendingTimeMode(timeMode);
    void updatePreferences({
      display: {
        mapTimeMode: timeMode,
      },
    } as Parameters<typeof updatePreferences>[0]).catch(() => {
      setPendingTimeMode(null);
    });
  };

  const handleTimelineScrub = (nextIndex: number) => {
    if (effectiveTimeMode === "current") return;
    setTimelineIndexes((current) => ({
      ...current,
      [effectiveTimeMode]: nextIndex,
    }));
  };

  const emptyState = (() => {
    if (effectiveTimeMode === "future") {
      return {
        title: "No future location windows yet.",
        body: "Future-dated travel or event plans will appear here once captured.",
      };
    }
    if (effectiveTimeMode === "past") {
      return {
        title: effectiveMode === "friends" ? "No friend location history yet." : "No past location pins yet.",
        body:
          effectiveMode === "friends"
            ? "Switch to Current or All content to see active last-seen pins."
            : "Captured historical check-ins and posts will appear here.",
      };
    }
    return {
      title: effectiveMode === "friends" ? "No friend pins yet." : "No location pins yet.",
      body:
        effectiveMode === "friends"
          ? "Switch to All content to see the latest locations from followed accounts."
          : "Followed accounts with valid location data will appear here.",
    };
  })();

  return (
    <div className="app-theme-shell relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
        <div className="pointer-events-auto flex w-full max-w-[min(56rem,calc(100vw-2rem))] flex-col gap-2 rounded-[28px] border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-elevated)_88%,transparent)] p-2 shadow-[var(--theme-glow-sm)] backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_82%,transparent)] p-1">
              {([
                ["current", "Current"],
                ["future", "Future"],
                ["past", "Past"],
              ] as const).map(([timeMode, label]) => (
                <button
                  key={timeMode}
                  type="button"
                  onClick={() => handleTimeModeChange(timeMode)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    effectiveTimeMode === timeMode
                      ? "theme-chip-active"
                      : "theme-chip"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {effectiveTimeMode !== "current" && timelineMoments.length > 0 && effectiveTimelineIndex !== null ? (
            <div
              className="rounded-[24px] border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_82%,transparent)] px-4 py-3"
              data-testid="map-timeline-scrubber"
            >
              <div className="flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--theme-text-muted)]">
                <span>{effectiveTimeMode === "past" ? "History scrub" : "Future playback"}</span>
                <span className="text-right normal-case tracking-normal text-[color:var(--theme-text-primary)]">
                  {formatTimelineMoment(timelineMoments[effectiveTimelineIndex])}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, timelineMoments.length - 1)}
                step={1}
                value={effectiveTimelineIndex}
                aria-label="Map timeline scrubber"
                className="mt-3 h-2 w-full accent-[var(--theme-accent-primary)]"
                onChange={(event) => handleTimelineScrub(Number.parseInt(event.currentTarget.value, 10))}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-[color:var(--theme-text-muted)]">
                <span>{formatTimelineEdge(timelineMoments[0])}</span>
                <span>{formatTimelineEdge(timelineMoments[timelineMoments.length - 1])}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <MapSurface
        markers={markers}
        focusedMarkerKey={focusedMarker?.key ?? null}
        themeId={themeId}
        onOpenFriend={(marker) => {
          openFriendFromMap(marker, {
            setActiveView,
            setSelectedFriend,
            setSelectedItem,
          });
        }}
        onOpenPost={(marker) => {
          openPostFromMap(marker, {
            setActiveView,
            setSelectedFriend,
            setSelectedItem,
            setFilter,
            setSearchQuery,
          });
        }}
        emptyTitle={emptyState.title}
        emptyBody={emptyState.body}
      />
    </div>
  );
}
