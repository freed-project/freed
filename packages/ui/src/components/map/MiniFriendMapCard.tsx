import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { MapSurface } from "./MapSurface.js";
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
    <div className="theme-dialog-divider flex shrink-0 justify-end border-t p-3">
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
      className="theme-card-soft w-56 max-w-full cursor-pointer overflow-hidden rounded-2xl text-left transition-colors hover:border-[color:var(--theme-accent-primary)] hover:bg-[color:var(--theme-bg-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-accent-primary)]"
    >
      <div className="pointer-events-none h-32" inert aria-hidden="true">
        <MapSurface markers={markers} focusedMarkerKey={lastSeen?.key} interactive={false} themeId={themeId}
          emptyTitle={resolvingCount ? "Locating..." : "Location not pinpointed"}
          emptyBody="Open Map to explore" />
      </div>
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
        <span className="theme-chip rounded-full px-2.5 py-1 text-[11px]">
          Open map
        </span>
      </div>

    </div>
    </div>
  );
}
