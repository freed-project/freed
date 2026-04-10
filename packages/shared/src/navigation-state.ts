import type { BaseAppState, FilterOptions } from "./store-types.js";

export type NavigationView = BaseAppState["activeView"];

export interface NavigationState {
  activeView: NavigationView;
  activeFilter: FilterOptions;
  selectedItemId: string | null;
}

interface NavigationPathLike {
  pathname: string;
  search: string;
}

interface CanonicalizeOptions {
  knownItemIds?: ReadonlySet<string> | null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueSortedTags(tags: readonly string[] | undefined): string[] {
  if (!tags?.length) return [];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function canonicalizeFilterOptions(filter: FilterOptions): FilterOptions {
  if (filter.savedOnly) return { savedOnly: true };
  if (filter.archivedOnly) return { archivedOnly: true };

  const tags = uniqueSortedTags(filter.tags);
  const feedUrl = normalizeText(filter.feedUrl);
  const platform = feedUrl ? "rss" : normalizeText(filter.platform) ?? undefined;
  const next: FilterOptions = {};

  if (platform) next.platform = platform;
  if (feedUrl) next.feedUrl = feedUrl;
  if (tags.length > 0) next.tags = tags;

  return next;
}

export function canonicalizeNavigationState(
  state: NavigationState,
  options: CanonicalizeOptions = {},
): NavigationState {
  const knownItemIds = options.knownItemIds ?? null;
  const activeView: NavigationView =
    state.activeView === "friends" || state.activeView === "map" ? state.activeView : "feed";

  if (activeView !== "feed") {
    return {
      activeView,
      activeFilter: {},
      selectedItemId: null,
    };
  }

  const activeFilter = canonicalizeFilterOptions(state.activeFilter);
  const selectedItemId = normalizeText(state.selectedItemId);
  const hasKnownItems = options.knownItemIds !== undefined;
  const isKnownItem = !selectedItemId
    || !hasKnownItems
    || knownItemIds === null
    || knownItemIds.has(selectedItemId);

  return {
    activeView,
    activeFilter,
    selectedItemId: isKnownItem ? selectedItemId : null,
  };
}

export function parseNavigationState(input: string | NavigationPathLike): NavigationState {
  const parsed =
    typeof input === "string"
      ? new URL(input, "https://freed.invalid")
      : new URL(`${input.pathname}${input.search}`, "https://freed.invalid");

  let activeView: NavigationView = "feed";
  if (parsed.pathname === "/friends") activeView = "friends";
  else if (parsed.pathname === "/map") activeView = "map";

  if (activeView !== "feed") {
    return {
      activeView,
      activeFilter: {},
      selectedItemId: null,
    };
  }

  const params = parsed.searchParams;
  const scope = normalizeText(params.get("scope"));
  const feedUrl = normalizeText(params.get("feed"));
  const platform = normalizeText(params.get("platform"));
  const tags = uniqueSortedTags(params.getAll("tag"));

  let activeFilter: FilterOptions;
  if (scope === "saved") {
    activeFilter = { savedOnly: true };
  } else if (scope === "archived") {
    activeFilter = { archivedOnly: true };
  } else if (feedUrl) {
    activeFilter = { platform: "rss", feedUrl };
    if (tags.length > 0) activeFilter.tags = tags;
  } else {
    activeFilter = {};
    if (platform) activeFilter.platform = platform;
    if (tags.length > 0) activeFilter.tags = tags;
  }

  return canonicalizeNavigationState({
    activeView,
    activeFilter,
    selectedItemId: normalizeText(params.get("item")),
  });
}

export function serializeNavigationState(state: NavigationState): string {
  const canonical = canonicalizeNavigationState(state);
  const pathname =
    canonical.activeView === "friends"
      ? "/friends"
      : canonical.activeView === "map"
        ? "/map"
        : "/";

  if (canonical.activeView !== "feed") return pathname;

  const params = new URLSearchParams();
  const { activeFilter, selectedItemId } = canonical;

  if (activeFilter.savedOnly) {
    params.set("scope", "saved");
  } else if (activeFilter.archivedOnly) {
    params.set("scope", "archived");
  } else {
    if (activeFilter.feedUrl) {
      params.set("feed", activeFilter.feedUrl);
    } else if (activeFilter.platform) {
      params.set("platform", activeFilter.platform);
    }

    for (const tag of uniqueSortedTags(activeFilter.tags)) {
      params.append("tag", tag);
    }
  }

  if (selectedItemId) {
    params.set("item", selectedItemId);
  }

  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function navigationStatesEqual(a: NavigationState, b: NavigationState): boolean {
  const left = canonicalizeNavigationState(a);
  const right = canonicalizeNavigationState(b);
  const leftTags = uniqueSortedTags(left.activeFilter.tags);
  const rightTags = uniqueSortedTags(right.activeFilter.tags);

  return (
    left.activeView === right.activeView
    && left.selectedItemId === right.selectedItemId
    && left.activeFilter.platform === right.activeFilter.platform
    && left.activeFilter.feedUrl === right.activeFilter.feedUrl
    && !!left.activeFilter.savedOnly === !!right.activeFilter.savedOnly
    && !!left.activeFilter.archivedOnly === !!right.activeFilter.archivedOnly
    && leftTags.length === rightTags.length
    && leftTags.every((tag, index) => tag === rightTags[index])
  );
}
