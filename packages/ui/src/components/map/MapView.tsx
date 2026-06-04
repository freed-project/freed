import { useEffect, useMemo, useState } from "react";
import {
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLocationTimelineBounds,
  resolveMapMode,
  type LocationTimeRange,
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
const TIME_RANGE_SLIDER_STEPS = 1_000;

function getMapTimeRefreshMs(): number {
  if (typeof window === "undefined") return MAP_TIME_REFRESH_MS;
  const override = (
    window as Window & {
      __FREED_E2E_MAP_TIME_REFRESH_MS__?: number;
    }
  ).__FREED_E2E_MAP_TIME_REFRESH_MS__;
  return typeof override === "number" && Number.isFinite(override) && override > 0
    ? override
    : MAP_TIME_REFRESH_MS;
}

function formatTimelineMoment(value: number): string {
  return timelineMomentFormatter.format(value);
}

function formatTimelineEdge(value: number): string {
  return timelineEdgeFormatter.format(value);
}

function formatTimelineRange(range: LocationTimeRange, bounds: LocationTimeRange): string {
  if (range.startAt === bounds.startAt && range.endAt === bounds.endAt) {
    return "All time";
  }
  return `${formatTimelineMoment(range.startAt)} to ${formatTimelineMoment(range.endAt)}`;
}

function timeToSliderStep(value: number, bounds: LocationTimeRange): number {
  const span = bounds.endAt - bounds.startAt;
  if (span <= 0) return 0;
  return Math.round(((value - bounds.startAt) / span) * TIME_RANGE_SLIDER_STEPS);
}

function sliderStepToTime(step: number, bounds: LocationTimeRange): number {
  const span = bounds.endAt - bounds.startAt;
  if (span <= 0) return bounds.startAt;
  return bounds.startAt + (span * step) / TIME_RANGE_SLIDER_STEPS;
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
  const [referenceNow, setReferenceNow] = useState(() => Date.now());
  const [selectedTimeRange, setSelectedTimeRange] = useState<LocationTimeRange | null>(null);

  const { resolvedItems } = useResolvedLocations(items, persons, accounts);
  const timelineBounds = useMemo(() => getLocationTimelineBounds(resolvedItems), [resolvedItems]);
  const effectiveTimeRange = selectedTimeRange ?? timelineBounds;
  const sliderStartStep =
    timelineBounds && effectiveTimeRange ? timeToSliderStep(effectiveTimeRange.startAt, timelineBounds) : 0;
  const sliderEndStep =
    timelineBounds && effectiveTimeRange ? timeToSliderStep(effectiveTimeRange.endAt, timelineBounds) : 0;
  const sliderStartPercent = (sliderStartStep / TIME_RANGE_SLIDER_STEPS) * 100;
  const sliderEndPercent = (sliderEndStep / TIME_RANGE_SLIDER_STEPS) * 100;
  const timeRangeLabel =
    timelineBounds && effectiveTimeRange ? formatTimelineRange(effectiveTimeRange, timelineBounds) : "No location dates";
  const sliderDisabled = !timelineBounds || timelineBounds.startAt === timelineBounds.endAt;
  const friendMarkers = useMemo(
    () =>
      getLatestFriendLocationMarkers(resolvedItems, {
        now: referenceNow,
        timeRange: effectiveTimeRange,
      }),
    [effectiveTimeRange, referenceNow, resolvedItems],
  );
  const allContentMarkers = useMemo(
    () =>
      getLatestAuthorLocationMarkers(resolvedItems, {
        now: referenceNow,
        timeRange: effectiveTimeRange,
      }),
    [effectiveTimeRange, referenceNow, resolvedItems],
  );
  const effectiveMode = resolveMapMode(
    display.mapMode,
    friendMarkers.length,
    allContentMarkers.length,
  );
  const markers = effectiveMode === "friends" ? friendMarkers : allContentMarkers;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceNow(Date.now());
    }, getMapTimeRefreshMs());
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setSelectedTimeRange((current) => {
      if (!timelineBounds || !current) return null;

      const startAt = Math.max(timelineBounds.startAt, Math.min(current.startAt, timelineBounds.endAt));
      const endAt = Math.max(startAt, Math.min(current.endAt, timelineBounds.endAt));

      if (startAt === current.startAt && endAt === current.endAt) return current;
      return { startAt, endAt };
    });
  }, [timelineBounds]);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedPersonId) ?? null,
    [markers, selectedPersonId]
  );

  const handleTimeRangeStartChange = (nextStep: number) => {
    if (!timelineBounds || !effectiveTimeRange) return;
    const endStep = timeToSliderStep(effectiveTimeRange.endAt, timelineBounds);
    const clampedStep = Math.min(nextStep, endStep);
    setSelectedTimeRange({
      startAt: sliderStepToTime(clampedStep, timelineBounds),
      endAt: effectiveTimeRange.endAt,
    });
  };

  const handleTimeRangeEndChange = (nextStep: number) => {
    if (!timelineBounds || !effectiveTimeRange) return;
    const startStep = timeToSliderStep(effectiveTimeRange.startAt, timelineBounds);
    const clampedStep = Math.max(nextStep, startStep);
    setSelectedTimeRange({
      startAt: effectiveTimeRange.startAt,
      endAt: sliderStepToTime(clampedStep, timelineBounds),
    });
  };

  const emptyState = (() => {
    return {
      title: effectiveMode === "friends" ? "No friend pins yet." : "No location pins yet.",
      body:
        effectiveMode === "friends"
          ? "Drag the time slider wider or switch to All content to see followed accounts."
          : "Drag the time slider wider or capture followed accounts with valid location data.",
    };
  })();

  return (
    <div className="app-theme-shell relative h-full overflow-hidden">
      <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex justify-start">
        <div
          className="pointer-events-auto theme-floating-panel w-[min(27rem,calc(100vw-2rem))] px-4 py-3"
          data-testid="map-time-range-slider"
        >
          <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-[color:var(--theme-text-muted)]">
            <span>Time</span>
            <span className="text-right text-[color:var(--theme-text-secondary)]">{timeRangeLabel}</span>
          </div>
          <div className="relative mt-3 h-7">
            <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--theme-border-subtle)]" />
            <div
              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--theme-accent-secondary)]"
              style={{
                left: `${sliderStartPercent}%`,
                right: `${100 - sliderEndPercent}%`,
              }}
            />
            <input
              type="range"
              min={0}
              max={TIME_RANGE_SLIDER_STEPS}
              step={1}
              value={sliderStartStep}
              disabled={sliderDisabled}
              aria-label="Map time range start"
              data-testid="map-time-range-start"
              className="theme-map-time-range-slider"
              style={{ zIndex: sliderStartStep > TIME_RANGE_SLIDER_STEPS - 40 ? 3 : 2 }}
              onChange={(event) => handleTimeRangeStartChange(Number.parseInt(event.currentTarget.value, 10))}
            />
            <input
              type="range"
              min={0}
              max={TIME_RANGE_SLIDER_STEPS}
              step={1}
              value={sliderEndStep}
              disabled={sliderDisabled}
              aria-label="Map time range end"
              data-testid="map-time-range-end"
              className="theme-map-time-range-slider"
              style={{ zIndex: 2 }}
              onChange={(event) => handleTimeRangeEndChange(Number.parseInt(event.currentTarget.value, 10))}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-[color:var(--theme-text-soft)]">
            <span>{timelineBounds ? formatTimelineEdge(timelineBounds.startAt) : "Start"}</span>
            <span>{timelineBounds ? formatTimelineEdge(timelineBounds.endAt) : "End"}</span>
          </div>
        </div>
      </div>

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
