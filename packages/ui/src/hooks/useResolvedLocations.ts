import { useEffect, useMemo, useState } from "react";
import {
  extractLocationFromItem,
  getDefaultMapMode,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLastSeenLocationForFriend,
  type Account,
  type FeedItem,
  type LibraryMapLocationCandidate,
  type LocationPersonIdentity,
  type Person,
  type LocationMarkerSummary,
  type MapMode,
  type MapTimeMode,
  type ResolvedLocationItem,
} from "@freed/shared";
import { geocode } from "../lib/geocoding.js";

interface ResolvedLocationsState {
  friendMarkers: LocationMarkerSummary[];
  allContentMarkers: LocationMarkerSummary[];
  resolvedItems: ResolvedLocationItem[];
  lastResolvedAt: number | null;
  resolvingCount: number;
  defaultMode: MapMode;
}

interface ResolvedLocationsCacheState {
  resolvedItems: ResolvedLocationItem[];
  lastResolvedAt: number | null;
  resolvingCount: number;
}

interface NamedLocationRequest {
  accountId: string | null;
  item: FeedItem;
  friend: LocationPersonIdentity | null;
  name: string;
}

interface NamedLocationGroup {
  name: string;
  requests: NamedLocationRequest[];
}

const EMPTY_STATE: ResolvedLocationsCacheState = {
  resolvedItems: [],
  lastResolvedAt: null,
  resolvingCount: 0,
};

function namedLocationKey(name: string): string {
  return name.trim().toLowerCase();
}

function groupNamedLocationRequests(requests: NamedLocationRequest[]): NamedLocationGroup[] {
  const groups = new Map<string, NamedLocationGroup>();

  for (const request of requests) {
    const key = namedLocationKey(request.name);
    const existing = groups.get(key);
    if (existing) {
      existing.requests.push(request);
      continue;
    }

    groups.set(key, {
      name: request.name,
      requests: [request],
    });
  }

  return Array.from(groups.values());
}

export function useResolvedLocationCandidates(
  candidates: readonly LibraryMapLocationCandidate[],
  options: {
    timeMode?: MapTimeMode;
    now?: number;
  } = {},
): ResolvedLocationsState {
  const [state, setState] = useState<ResolvedLocationsCacheState>(EMPTY_STATE);
  const timeMode = options.timeMode ?? "current";
  const now = options.now;
  const locationPlan = useMemo(() => {
    const coordinateItems: ResolvedLocationItem[] = [];
    const namedRequests: NamedLocationRequest[] = [];

    for (const { accountId, item, friend } of candidates) {
      const signal = extractLocationFromItem(item);
      if (signal && "coordinates" in signal) {
        coordinateItems.push({
          accountId,
          item,
          friend,
          lat: signal.coordinates.lat,
          lng: signal.coordinates.lng,
          label: signal.name,
        });
        continue;
      }

      if (!signal || "coordinates" in signal) continue;
      namedRequests.push({
        accountId,
        item,
        friend,
        name: signal.name,
      });
    }

    return {
      coordinateItems,
      namedGroups: groupNamedLocationRequests(namedRequests),
      namedRequestCount: namedRequests.length,
    };
  }, [candidates]);

  useEffect(() => {
    let cancelled = false;

    async function resolveLocations() {
      if (locationPlan.namedRequestCount === 0) {
        setState((current) =>
          current.resolvedItems.length === 0 && current.resolvingCount === 0
            ? current
            : {
                resolvedItems: [],
                resolvingCount: 0,
                lastResolvedAt: Date.now(),
              }
        );
        return;
      }

      setState({
        resolvedItems: [],
        resolvingCount: locationPlan.namedRequestCount,
        lastResolvedAt: null,
      });

      let remainingCount = locationPlan.namedRequestCount;

      for (const group of locationPlan.namedGroups) {
        void geocode(group.name).then((geo) => {
          if (cancelled) return;

          remainingCount = Math.max(0, remainingCount - group.requests.length);
          const groupResolvedItems: ResolvedLocationItem[] = geo
            ? group.requests.map(({ accountId, item, friend, name }) => ({
                accountId,
                item,
                friend,
                lat: geo.latitude,
                lng: geo.longitude,
                label: geo.name ?? name,
              }))
            : [];
          const completedAt = remainingCount === 0 ? Date.now() : null;

          setState((current) => ({
            resolvedItems:
              groupResolvedItems.length === 0
                ? current.resolvedItems
                : [...current.resolvedItems, ...groupResolvedItems],
            resolvingCount: remainingCount,
            lastResolvedAt: completedAt ?? current.lastResolvedAt,
          }));
        });
      }
    }

    void resolveLocations();

    return () => {
      cancelled = true;
    };
  }, [locationPlan.namedGroups, locationPlan.namedRequestCount]);

  const resolvedItems = useMemo(
    () => [...locationPlan.coordinateItems, ...state.resolvedItems],
    [locationPlan.coordinateItems, state.resolvedItems],
  );

  const friendMarkers = useMemo(
    () => getLatestFriendLocationMarkers(resolvedItems, { timeMode, now }),
    [now, resolvedItems, timeMode],
  );
  const allContentMarkers = useMemo(
    () => getLatestAuthorLocationMarkers(resolvedItems, { timeMode, now }),
    [now, resolvedItems, timeMode],
  );
  const defaultMode = useMemo(
    () => getDefaultMapMode(friendMarkers.length, allContentMarkers.length),
    [allContentMarkers.length, friendMarkers.length],
  );

  return {
    ...state,
    resolvedItems,
    friendMarkers,
    allContentMarkers,
    defaultMode,
  };
}

/** Compatibility adapter for already bounded callers that still hold identity rows. */
export function useResolvedLocations(
  feedItems: FeedItem[],
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  options: {
    timeMode?: MapTimeMode;
    now?: number;
  } = {},
): ResolvedLocationsState {
  const identityBySourceKey = useMemo(() => {
    const next = new Map<string, { accountId: string; friend: Person }>();
    for (const account of Object.values(accounts)) {
      if (account.kind !== "social" || !account.personId) continue;
      const person = persons[account.personId];
      if (!person) continue;
      next.set(`${account.provider}:${account.externalId}`, {
        accountId: account.id,
        friend: person,
      });
    }
    return next;
  }, [accounts, persons]);
  const candidates = useMemo<LibraryMapLocationCandidate[]>(
    () => feedItems.map((item) => ({
      accountId: identityBySourceKey.get(`${item.platform}:${item.author.id}`)?.accountId ?? null,
      item,
      friend: identityBySourceKey.get(`${item.platform}:${item.author.id}`)?.friend ?? null,
    })),
    [feedItems, identityBySourceKey],
  );
  return useResolvedLocationCandidates(candidates, options);
}

export function useFriendLastSeenLocation(
  friend: Person,
  accounts: Record<string, Account>,
  feedItems: FeedItem[]
): {
  lastSeen: LocationMarkerSummary | null;
  resolvingCount: number;
} {
  const friendMap = useMemo(() => ({ [friend.id]: friend }), [friend]);
  const { resolvedItems, resolvingCount } = useResolvedLocations(feedItems, friendMap, accounts);
  return {
    lastSeen: getLastSeenLocationForFriend(resolvedItems, friend.id, { timeMode: "current" }),
    resolvingCount,
  };
}
