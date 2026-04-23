import { socialAccountForAuthor, type Account, type LocationMarkerSummary } from "@freed/shared";

interface MapNavigationActions {
  setActiveView: (view: "feed" | "friends" | "map") => void;
  setSelectedPerson: (id: string | null) => void;
  setSelectedAccount: (id: string | null) => void;
  setSelectedItem: (id: string | null) => void;
  setFilter: (filter: Record<string, never>) => void;
  setSearchQuery: (query: string) => void;
}

function findMarkerAccount(
  marker: LocationMarkerSummary,
  accounts: Record<string, Account>,
): Account | null {
  return socialAccountForAuthor(accounts, marker.item.platform, marker.item.author.id);
}

export function openFriendFromMap(
  marker: LocationMarkerSummary,
  actions: Pick<
    MapNavigationActions,
    "setActiveView" | "setSelectedPerson" | "setSelectedAccount" | "setSelectedItem"
  >
): void {
  if (!marker.friend) return;
  actions.setSelectedPerson(marker.friend.id);
  actions.setSelectedItem(null);
  actions.setActiveView("friends");
}

export function openAccountFromMap(
  marker: LocationMarkerSummary,
  accounts: Record<string, Account>,
  actions: Pick<
    MapNavigationActions,
    "setActiveView" | "setSelectedPerson" | "setSelectedAccount" | "setSelectedItem"
  >,
): void {
  const account = findMarkerAccount(marker, accounts);
  if (!account) return;
  actions.setSelectedPerson(null);
  actions.setSelectedAccount(account.id);
  actions.setSelectedItem(null);
  actions.setActiveView("friends");
}

export function openPostFromMap(
  marker: LocationMarkerSummary,
  actions: MapNavigationActions
): void {
  actions.setFilter({});
  actions.setSearchQuery("");
  actions.setSelectedPerson(marker.friend?.id ?? null);
  actions.setSelectedItem(marker.item.globalId);
  actions.setActiveView("feed");
}
