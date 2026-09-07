import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { MapSurface } from "./MapSurface.js";
import { LoadingState } from "../LoadingState.js";
import { useAppliedThemeId } from "../../lib/theme.js";
import { usePlatform } from "../../context/PlatformContext.js";
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
  const candidates = useMemo(() => feedItems.map(item => ({ accountId: null, item, friend })), [feedItems, friend]);
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
      className="theme-card-soft w-full cursor-pointer overflow-hidden rounded-2xl text-left transition-colors hover:border-[color:var(--theme-accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)]"
    >
      {lastSeen ? <div className="pointer-events-none h-32" inert aria-hidden="true">
        <MapSurface markers={markers} focusedMarkerKey={lastSeen?.key} interactive={false} themeId={themeId}
          emptyTitle="Location not pinpointed" />
      </div> : resolvingCount > 0 ? (
        <LoadingState message="Locating profile" className="h-32" />
      ) : null}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--theme-accent-secondary)]">
            Last seen
          </p>
          <p className="mt-1 text-xs font-medium text-[color:var(--theme-text-primary)]">
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
