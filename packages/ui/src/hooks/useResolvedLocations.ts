import { useEffect, useMemo, useState } from "react";
import {
  extractLocationFromItem,
  friendForAuthor,
  getLatestFriendLocationMarkers,
  getLastSeenLocationForFriend,
  type FeedItem,
  type Friend,
  type LocationMarkerSummary,
  type ResolvedLocationItem,
} from "@freed/shared";
import { geocode } from "../lib/geocoding.js";

interface ResolvedLocationsState {
  markers: LocationMarkerSummary[];
  resolvedItems: ResolvedLocationItem[];
  lastResolvedAt: number | null;
  resolvingCount: number;
}

const EMPTY_STATE: ResolvedLocationsState = {
  markers: [],
  resolvedItems: [],
  lastResolvedAt: null,
  resolvingCount: 0,
};

export function useResolvedLocations(
  feedItems: FeedItem[],
  friends: Record<string, Friend>
): ResolvedLocationsState {
  const [state, setState] = useState<ResolvedLocationsState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    async function resolveLocations() {
      const pending: Array<Promise<ResolvedLocationItem | null>> = [];
      let resolvingCount = 0;

      for (const item of feedItems) {
        const signal = extractLocationFromItem(item);
        if (!signal) continue;

        const friend = friendForAuthor(friends, item.platform, item.author.id);

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
        markers: getLatestFriendLocationMarkers(resolvedItems),
        resolvedItems,
        resolvingCount: 0,
        lastResolvedAt: Date.now(),
      });
    }

    void resolveLocations();

    return () => {
      cancelled = true;
    };
  }, [feedItems, friends]);

  return state;
}

export function useFriendLastSeenLocation(
  friend: Friend,
  feedItems: FeedItem[]
): {
  lastSeen: LocationMarkerSummary | null;
  resolvingCount: number;
} {
  const friendMap = useMemo(() => ({ [friend.id]: friend }), [friend]);
  const { resolvedItems, resolvingCount } = useResolvedLocations(feedItems, friendMap);
  return {
    lastSeen: getLastSeenLocationForFriend(resolvedItems, friend.id),
    resolvingCount,
  };
}
