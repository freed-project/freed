import { useEffect, useMemo, useState } from "react";
import { type MapMode } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useResolvedLocations } from "../../hooks/useResolvedLocations.js";
import { openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
import { MapSurface } from "./MapSurface.js";

export function MapView() {
  const items = useAppStore((state) => state.items);
  const friends = useAppStore((state) => state.friends);
  const selectedFriendId = useAppStore((state) => state.selectedFriendId);
  const setSelectedFriend = useAppStore((state) => state.setSelectedFriend);
  const setSelectedItem = useAppStore((state) => state.setSelectedItem);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setFilter = useAppStore((state) => state.setFilter);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const display = useAppStore((state) => state.preferences.display);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const themeId = display.themeId;

  const { friendMarkers, allContentMarkers, defaultMode } = useResolvedLocations(items, friends);
  const savedMode = display.mapMode;
  const [pendingMode, setPendingMode] = useState<MapMode | null>(null);
  const effectiveMode = pendingMode ?? savedMode ?? defaultMode;
  const markers = effectiveMode === "friends" ? friendMarkers : allContentMarkers;

  useEffect(() => {
    if (pendingMode && savedMode === pendingMode) {
      setPendingMode(null);
    }
  }, [pendingMode, savedMode]);

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

  return (
    <div className="app-theme-shell relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-elevated)_88%,transparent)] p-1 shadow-[var(--theme-glow-sm)] backdrop-blur-md">
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
        emptyTitle={
          effectiveMode === "friends"
            ? "No friend pins yet."
            : "No location pins yet."
        }
        emptyBody={
          effectiveMode === "friends"
            ? "Switch to All content to see the latest locations from followed accounts."
            : "Followed accounts with valid location data will appear here."
        }
      />
    </div>
  );
}
