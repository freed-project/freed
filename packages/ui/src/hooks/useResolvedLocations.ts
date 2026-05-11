import { useEffect, useMemo, useState } from "react";
import {
  extractLocationFromItem,
  getDefaultMapMode,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLastSeenLocationForFriend,
  type Account,
  type FeedItem,
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
  item: FeedItem;
  friend: Person | null;
  name: string;
}

const EMPTY_STATE: ResolvedLocationsCacheState = {
  resolvedItems: [],
  lastResolvedAt: null,
  resolvingCount: 0,
};

export function useResolvedLocations(
  feedItems: FeedItem[],
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  options: {
    timeMode?: MapTimeMode;
    now?: number;
  } = {},
): ResolvedLocationsState {
  const [state, setState] = useState<ResolvedLocationsCacheState>(EMPTY_STATE);
  const timeMode = options.timeMode ?? "current";
  const now = options.now;
  const personBySourceKey = useMemo(() => {
    const next = new Map<string, Person>();
    for (const account of Object.values(accounts)) {
      if (account.kind !== "social" || !account.personId) continue;
      const person = persons[account.personId];
      if (!person) continue;
      next.set(`${account.provider}:${account.externalId}`, person);
    }
    return next;
  }, [accounts, persons]);
  const locationPlan = useMemo(() => {
    const coordinateItems: ResolvedLocationItem[] = [];
    const namedRequests: NamedLocationRequest[] = [];

    for (const item of feedItems) {
      const friend = personBySourceKey.get(`${item.platform}:${item.author.id}`) ?? null;
      const signal = extractLocationFromItem(item);
      if (signal && "coordinates" in signal) {
        coordinateItems.push({
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
        item,
        friend,
        name: signal.name,
      });
    }

    return {
      coordinateItems,
      namedRequests,
    };
  }, [feedItems, personBySourceKey]);

  useEffect(() => {
    let cancelled = false;

    async function resolveLocations() {
      if (locationPlan.namedRequests.length === 0) {
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

      setState((current) => ({ ...current, resolvingCount: locationPlan.namedRequests.length }));

      const resolvedItems = (await Promise.all(
        locationPlan.namedRequests.map(({ item, friend, name }) =>
          geocode(name).then((geo): ResolvedLocationItem | null => {
            if (!geo) return null;
            return {
              item,
              friend,
              lat: geo.latitude,
              lng: geo.longitude,
              label: geo.name ?? name,
            };
          })
        )
      )).filter((resolved): resolved is ResolvedLocationItem => resolved !== null);
      if (cancelled) return;

      setState({
        resolvedItems,
        resolvingCount: 0,
        lastResolvedAt: Date.now(),
      });
    }

    void resolveLocations();

    return () => {
      cancelled = true;
    };
  }, [locationPlan.namedRequests]);

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
