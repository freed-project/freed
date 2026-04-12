import { useMemo } from "react";
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
  const themeId = useAppStore((state) => state.preferences.display.themeId);

  const { markers } = useResolvedLocations(items, friends);

  const focusedMarker = useMemo(
    () => markers.find((marker) => marker.friend?.id === selectedFriendId) ?? null,
    [markers, selectedFriendId]
  );
  return (
    <div className="app-theme-shell h-full overflow-hidden">
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
        emptyBody="Friends with location data from Instagram and Facebook will appear here."
      />
    </div>
  );
}
