import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { MapSurface } from "./MapSurface.js";
import { LoadingState } from "../LoadingState.js";
import { useAppliedThemeId } from "../../lib/theme.js";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useLibraryMapCandidates } from "../../hooks/useLibrarySurfaceItems.js";
import type { FeedItem, Person } from "@freed/shared";
import { useResolvedLocationCandidates } from "../../hooks/useResolvedLocations.js";

interface MiniFriendMapCardProps {
  friend: Person;
  feedItems: readonly FeedItem[];
  onOpenMap: () => void;
  resolveNamedLocations?: boolean;
}

export function MiniFriendMapCard({
  friend,
  feedItems,
  onOpenMap,
  resolveNamedLocations,
}: MiniFriendMapCardProps) {
  const themeId = useAppliedThemeId();
  const { geographicMapMode } = usePlatform();
  const sourceVersion = useAppStore(state => state.searchCorpusVersion);
  const mapCandidates = useLibraryMapCandidates(sourceVersion);
  const candidates = useMemo(() => {
    // Use the same coordinate-bearing candidates as the main map. The recent
    // activity slice may contain only a location name, even for a mapped person.
    const matching = mapCandidates.filter(candidate => candidate.friend?.id === friend.id);
    const seen = new Set(matching.map(candidate => candidate.item.globalId));
    return [...matching, ...feedItems.filter(item => !seen.has(item.globalId)).map(item => ({ accountId: null, item, friend }))];
  }, [mapCandidates, feedItems, friend]);
  const { allContentMarkers, resolvingCount } = useResolvedLocationCandidates(candidates, {
    resolveNamedLocations: resolveNamedLocations ?? geographicMapMode !== "local-showcase",
  });
  // A selected connection has a location too; do not filter this preview to friends.
  const lastSeen = allContentMarkers[0] ?? null;

  const markers = useMemo(() => lastSeen ? [lastSeen] : [], [lastSeen]);
  const namedLocation = feedItems.find(item => item.location?.name)?.location?.name;
  if (!lastSeen && resolvingCount === 0 && !namedLocation) return null;

  return (
    <div className="mb-4 w-full">
    <div
      role="button"
      aria-label={`Open map for ${friend.name}`}
      tabIndex={0}
      onClick={onOpenMap}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMap();
        }
      }}
      className="theme-card-soft group w-full cursor-pointer overflow-hidden rounded-2xl text-left transition-colors hover:border-[color:var(--theme-accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)]"
    >
      {lastSeen ? <div className="pointer-events-none h-32" inert aria-hidden="true">
        <MapSurface markers={markers} focusedMarkerKey={lastSeen?.key} interactive={false} themeId={themeId}
          emptyTitle="Location not pinpointed" />
      </div> : resolvingCount > 0 ? (
        <LoadingState message="Locating profile" className="h-32" />
      ) : null}
      <div className="flex items-center justify-between gap-2 px-3 py-2 transition-colors group-hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)] group-focus-visible:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.12)]">
        <div className="min-w-0 w-full">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-[color:var(--theme-accent-secondary)]">
            Last seen
          </p>
          <p className="mt-1 text-right text-xs font-medium text-[color:var(--theme-text-primary)]">
            {lastSeen?.label ?? namedLocation ?? "Resolving location..."}
          </p>
          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
            {lastSeen
              ? `${formatDistanceToNow(lastSeen.seenAt, { addSuffix: true })}`
              : resolvingCount ? `Resolving ${resolvingCount.toLocaleString()} location${resolvingCount !== 1 ? "s" : ""}` : "Coordinates unavailable"}
          </p>
        </div>
      </div>

    </div>
    </div>
  );
}
