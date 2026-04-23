import type { FilterOptions } from "@freed/shared";

interface FeedNavigationActions {
  setActiveView: (view: "feed") => void;
  setSelectedItem: (id: string | null) => void;
  setSelectedPerson: (id: string | null) => void;
  setFilter: (filter: FilterOptions) => void;
}

interface FeedSearchActions {
  setActiveView: (view: "feed") => void;
  setSelectedItem: (id: string | null) => void;
  setSelectedPerson: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export function navigateToFeedView(
  actions: FeedNavigationActions,
  filter: FilterOptions,
) {
  actions.setActiveView("feed");
  actions.setSelectedPerson(null);
  actions.setSelectedItem(null);
  actions.setFilter(filter);
}

export function applyFeedSearch(actions: FeedSearchActions, query: string) {
  actions.setActiveView("feed");
  actions.setSelectedPerson(null);
  actions.setSelectedItem(null);
  actions.setSearchQuery(query);
}
