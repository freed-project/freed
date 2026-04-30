import type { BaseAppState, FilterOptions } from "./store-types.js";
import { CONTENT_SIGNAL_KEYS } from "./content-signals";
import type { ContentSignal } from "./types.js";

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

function uniqueSortedSignals(signals: readonly string[] | undefined): ContentSignal[] {
  if (!signals?.length) return [];
  const allowed = new Set<string>(CONTENT_SIGNAL_KEYS);
  return Array.from(new Set(signals.map((signal) => signal.trim()).filter((signal) => allowed.has(signal))))
    .sort((a, b) => a.localeCompare(b)) as ContentSignal[];
}

function normalizeSocialContentFilter(
  value: FilterOptions["socialContentFilter"] | null | undefined,
): FilterOptions["socialContentFilter"] | undefined {
  return value === "posts" || value === "stories" ? value : undefined;
}

export function canonicalizeFilterOptions(filter: FilterOptions): FilterOptions {
  const tags = uniqueSortedTags(filter.tags);
  const signals = uniqueSortedSignals(filter.signals);
  if (filter.savedOnly) {
    const next: FilterOptions = { savedOnly: true };
    if (tags.length > 0) next.tags = tags;
    if (signals.length > 0) next.signals = signals;
    return next;
  }
  if (filter.archivedOnly) {
    const next: FilterOptions = { archivedOnly: true };
    if (tags.length > 0) next.tags = tags;
    if (signals.length > 0) next.signals = signals;
    return next;
  }

  const feedUrl = normalizeText(filter.feedUrl);
  const platform = feedUrl ? "rss" : normalizeText(filter.platform) ?? undefined;
  const authorId = feedUrl ? null : normalizeText(filter.authorId);
  const socialContentFilter =
    platform === "facebook" || platform === "instagram"
      ? normalizeSocialContentFilter(filter.socialContentFilter)
      : undefined;
  const next: FilterOptions = {};

  if (platform) next.platform = platform;
  if (platform && authorId) next.authorId = authorId;
  if (feedUrl) next.feedUrl = feedUrl;
  if (socialContentFilter) next.socialContentFilter = socialContentFilter;
  if (tags.length > 0) next.tags = tags;
  if (signals.length > 0) next.signals = signals;

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
  const authorId = normalizeText(params.get("author"));
  const socialContentFilter = normalizeSocialContentFilter(params.get("content") as FilterOptions["socialContentFilter"] | null);
  const tags = uniqueSortedTags(params.getAll("tag"));
  const signals = uniqueSortedSignals(params.getAll("signal"));

  let activeFilter: FilterOptions;
  if (scope === "saved") {
    activeFilter = { savedOnly: true };
    if (tags.length > 0) activeFilter.tags = tags;
    if (signals.length > 0) activeFilter.signals = signals;
  } else if (scope === "archived") {
    activeFilter = { archivedOnly: true };
    if (tags.length > 0) activeFilter.tags = tags;
    if (signals.length > 0) activeFilter.signals = signals;
  } else if (feedUrl) {
    activeFilter = { platform: "rss", feedUrl };
    if (tags.length > 0) activeFilter.tags = tags;
    if (signals.length > 0) activeFilter.signals = signals;
  } else {
    activeFilter = {};
    if (platform) activeFilter.platform = platform;
    if (platform && authorId) activeFilter.authorId = authorId;
    if (socialContentFilter) activeFilter.socialContentFilter = socialContentFilter;
    if (tags.length > 0) activeFilter.tags = tags;
    if (signals.length > 0) activeFilter.signals = signals;
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
  }

  if (activeFilter.savedOnly || activeFilter.archivedOnly) {
    for (const tag of uniqueSortedTags(activeFilter.tags)) {
      params.append("tag", tag);
    }
    for (const signal of uniqueSortedSignals(activeFilter.signals)) {
      params.append("signal", signal);
    }
  } else {
    if (activeFilter.feedUrl) {
      params.set("feed", activeFilter.feedUrl);
    } else if (activeFilter.platform) {
      params.set("platform", activeFilter.platform);
      if (activeFilter.authorId) {
        params.set("author", activeFilter.authorId);
      }
    }

    if (activeFilter.socialContentFilter && activeFilter.socialContentFilter !== "all") {
      params.set("content", activeFilter.socialContentFilter);
    }

    for (const tag of uniqueSortedTags(activeFilter.tags)) {
      params.append("tag", tag);
    }
    for (const signal of uniqueSortedSignals(activeFilter.signals)) {
      params.append("signal", signal);
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
  const leftSignals = uniqueSortedSignals(left.activeFilter.signals);
  const rightSignals = uniqueSortedSignals(right.activeFilter.signals);

  return (
    left.activeView === right.activeView
    && left.selectedItemId === right.selectedItemId
    && left.activeFilter.platform === right.activeFilter.platform
    && left.activeFilter.authorId === right.activeFilter.authorId
    && left.activeFilter.feedUrl === right.activeFilter.feedUrl
    && (left.activeFilter.socialContentFilter ?? "all") === (right.activeFilter.socialContentFilter ?? "all")
    && !!left.activeFilter.savedOnly === !!right.activeFilter.savedOnly
    && !!left.activeFilter.archivedOnly === !!right.activeFilter.archivedOnly
    && leftTags.length === rightTags.length
    && leftTags.every((tag, index) => tag === rightTags[index])
    && leftSignals.length === rightSignals.length
    && leftSignals.every((signal, index) => signal === rightSignals[index])
  );
}
