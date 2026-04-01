import type { LocationMarkerSummary } from "@freed/shared";

interface MapNavigationActions {
  setActiveView: (view: "feed" | "friends" | "map") => void;
  setSelectedFriend: (id: string | null) => void;
  setSelectedItem: (id: string | null) => void;
  setFilter: (filter: Record<string, never>) => void;
  setSearchQuery: (query: string) => void;
}

export function openFriendFromMap(
  marker: LocationMarkerSummary,
  actions: Pick<
    MapNavigationActions,
    "setActiveView" | "setSelectedFriend" | "setSelectedItem"
  >
): void {
  if (!marker.friend) return;
  actions.setSelectedFriend(marker.friend.id);
  actions.setSelectedItem(null);
  actions.setActiveView("friends");
}

export function openPostFromMap(
  marker: LocationMarkerSummary,
  actions: MapNavigationActions
): void {
  actions.setFilter({});
  actions.setSearchQuery("");
  actions.setSelectedFriend(marker.friend?.id ?? null);
  actions.setSelectedItem(marker.item.globalId);
  actions.setActiveView("feed");
}
