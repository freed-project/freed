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
import { openAccountFromMap, openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
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
  const selectedPersonId = useAppStore((state) => state.selectedPersonId);
  const setSelectedPerson = useAppStore((state) => state.setSelectedPerson);
  const setSelectedAccount = useAppStore((state) => state.setSelectedAccount);
  const setSelectedItem = useAppStore((state) => state.setSelectedItem);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setFilter = useAppStore((state) => state.setFilter);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const display = useAppStore((state) => state.preferences.display);
  const themeId = display.themeId;
  const savedTimeMode = display.mapTimeMode ?? "current";
  const [referenceNow, setReferenceNow] = useState(() => Date.now());
  const [timelineIndexes, setTimelineIndexes] = useState<Record<Exclude<MapTimeMode, "current">, number | null>>({
    past: null,
    future: null,
  });

  const { resolvedItems } = useResolvedLocations(items, persons, accounts);
  const timelineMoments = useMemo(
    () => getLocationTimelineMoments(resolvedItems, { timeMode: savedTimeMode, now: referenceNow }),
    [referenceNow, resolvedItems, savedTimeMode],
  );
  const selectedTimelineIndex =
    savedTimeMode === "current"
      ? null
      : timelineIndexes[savedTimeMode];
  const fallbackTimelineIndex =
    savedTimeMode === "current"
      ? null
      : DEFAULT_TIMELINE_INDEX[savedTimeMode] < 0
        ? Math.max(0, timelineMoments.length - 1)
        : DEFAULT_TIMELINE_INDEX[savedTimeMode];
  const effectiveTimelineIndex =
    savedTimeMode === "current" || timelineMoments.length === 0
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
        timeMode: savedTimeMode,
        now: referenceNow,
        playbackAt,
      }),
    [playbackAt, referenceNow, resolvedItems, savedTimeMode],
  );
  const allContentMarkers = useMemo(
    () =>
      getLatestAuthorLocationMarkers(resolvedItems, {
        timeMode: savedTimeMode,
        now: referenceNow,
        playbackAt,
      }),
    [playbackAt, referenceNow, resolvedItems, savedTimeMode],
  );
  const defaultMode = useMemo(
    () => getDefaultMapMode(friendMarkers.length, allContentMarkers.length),
    [allContentMarkers.length, friendMarkers.length],
  );
  const effectiveMode = display.mapMode ?? defaultMode;
  const markers = effectiveMode === "friends" ? friendMarkers : allContentMarkers;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceNow(Date.now());
    }, MAP_TIME_REFRESH_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedPersonId) ?? null,
    [markers, selectedPersonId]
  );

  const handleTimelineScrub = (nextIndex: number) => {
    if (savedTimeMode === "current") return;
    setTimelineIndexes((current) => ({
      ...current,
      [savedTimeMode]: nextIndex,
    }));
  };

  const emptyState = (() => {
    if (savedTimeMode === "future") {
      return {
        title: "No future location windows yet.",
        body: "Future-dated travel or event plans will appear here once captured.",
      };
    }
    if (savedTimeMode === "past") {
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
      {savedTimeMode !== "current" && timelineMoments.length > 0 && effectiveTimelineIndex !== null ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex justify-start">
          <div
            className="pointer-events-auto theme-floating-panel w-[min(25rem,calc(100vw-2rem))] px-4 py-3"
            data-testid="map-timeline-scrubber"
          >
            <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-[color:var(--theme-text-muted)]">
              <span>{savedTimeMode === "past" ? "History" : "Future"}</span>
              <span className="text-right text-[color:var(--theme-text-secondary)]">
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
              className="mt-3 h-2 w-full accent-[var(--theme-accent-secondary)]"
              onChange={(event) => handleTimelineScrub(Number.parseInt(event.currentTarget.value, 10))}
            />
            <div className="mt-2 flex items-center justify-between text-[10px] text-[color:var(--theme-text-soft)]">
              <span>{formatTimelineEdge(timelineMoments[0])}</span>
              <span>{formatTimelineEdge(timelineMoments[timelineMoments.length - 1])}</span>
            </div>
          </div>
        </div>
      ) : null}

      <MapSurface
        markers={markers}
        focusedMarkerKey={focusedMarker?.key ?? null}
        themeId={themeId}
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
        emptyTitle={emptyState.title}
        emptyBody={emptyState.body}
      />
    </div>
  );
}
