import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../context/PlatformContext.js";
import { useResolvedLocations } from "../../hooks/useResolvedLocations.js";
import { openAccountFromMap, openFriendFromMap, openPostFromMap } from "../../lib/map-navigation.js";
import { MapSurface } from "./MapSurface.js";

const MAP_TIME_REFRESH_MS = 60_000;

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
  const { friendMarkers, allContentMarkers, defaultMode } = useResolvedLocations(items, persons, accounts, {
    timeMode: display.mapTimeMode ?? "current",
    now: referenceNow,
  });
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

  const emptyState = (() => {
    if ((display.mapTimeMode ?? "current") === "future") {
      return {
        title: "No future location windows yet.",
        body: "Future-dated travel or event plans will appear here once captured.",
      };
    }
    if ((display.mapTimeMode ?? "current") === "past") {
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
