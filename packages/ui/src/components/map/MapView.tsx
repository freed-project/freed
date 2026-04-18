import { useEffect, useMemo, useState } from "react";
import { type MapMode, type MapTimeMode } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useResolvedLocations } from "../../hooks/useResolvedLocations.js";
import { openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
import { MapSurface } from "./MapSurface.js";

const MAP_TIME_REFRESH_MS = 60_000;

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

  const effectiveTimeMode = pendingTimeMode ?? savedTimeMode;
  const { friendMarkers, allContentMarkers, defaultMode } = useResolvedLocations(items, persons, accounts, {
    timeMode: effectiveTimeMode,
    now: referenceNow,
  });
  const savedMode = display.mapMode;
  const [pendingMode, setPendingMode] = useState<MapMode | null>(null);
  const effectiveMode = pendingMode ?? savedMode ?? defaultMode;
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
    if (pendingMode && savedMode === pendingMode) {
      setPendingMode(null);
    }
  }, [pendingMode, savedMode]);

  useEffect(() => {
    if (pendingTimeMode && savedTimeMode === pendingTimeMode) {
      setPendingTimeMode(null);
    }
  }, [pendingTimeMode, savedTimeMode]);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedFriendId) ?? null,
    [markers, selectedFriendId]
  );

  const handleModeChange = (mode: MapMode) => {
    setPendingMode(mode);
    void updatePreferences({
      display: {
        mapMode: mode,
      },
    } as Parameters<typeof updatePreferences>[0]).catch(() => {
      setPendingMode(null);
    });
  };

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
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-[28px] border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-elevated)_88%,transparent)] p-2 shadow-[var(--theme-glow-sm)] backdrop-blur-md">
          <div className="inline-flex items-center gap-1 rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_82%,transparent)] p-1">
            {([
              ["friends", "Friends"],
              ["all_content", "All content"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleModeChange(mode)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  effectiveMode === mode
                    ? "theme-chip-active"
                    : "theme-chip"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
