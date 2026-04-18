import { useEffect, useMemo, useState } from "react";
import {
  extractLocationFromItem,
  getDefaultMapMode,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLastSeenLocationForFriend,
  personForAuthor,
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

  useEffect(() => {
    let cancelled = false;

    async function resolveLocations() {
      const pending: Array<Promise<ResolvedLocationItem | null>> = [];
      let resolvingCount = 0;

      for (const item of feedItems) {
        const signal = extractLocationFromItem(item);
        if (!signal) continue;

        const friend = personForAuthor(persons, accounts, item.platform, item.author.id);

        if ("coordinates" in signal) {
          pending.push(
            Promise.resolve({
              item,
              friend,
              lat: signal.coordinates.lat,
              lng: signal.coordinates.lng,
              label: signal.name ?? item.location?.name,
            })
          );
          continue;
        }

        resolvingCount += 1;
        pending.push(
          geocode(signal.name).then((geo) => {
            if (!geo) return null;
            return {
              item,
              friend,
              lat: geo.latitude,
              lng: geo.longitude,
              label: geo.name ?? signal.name,
            };
          })
        );
      }

      setState((current) => ({ ...current, resolvingCount }));

      const resolvedItems = (await Promise.all(pending)).filter(
        (resolved): resolved is ResolvedLocationItem => resolved !== null
      );
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
  }, [accounts, feedItems, persons]);

  const friendMarkers = useMemo(
    () => getLatestFriendLocationMarkers(state.resolvedItems, { timeMode, now }),
    [now, state.resolvedItems, timeMode],
  );
  const allContentMarkers = useMemo(
    () => getLatestAuthorLocationMarkers(state.resolvedItems, { timeMode, now }),
    [now, state.resolvedItems, timeMode],
  );
  const defaultMode = useMemo(
    () => getDefaultMapMode(friendMarkers.length, allContentMarkers.length),
    [allContentMarkers.length, friendMarkers.length],
  );

  return {
    ...state,
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
