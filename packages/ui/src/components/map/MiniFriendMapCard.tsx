import { formatDistanceToNow } from "date-fns";
import type { FeedItem, Person } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useFriendLastSeenLocation } from "../../hooks/useResolvedLocations.js";

interface MiniFriendMapCardProps {
  friend: Person;
  feedItems: FeedItem[];
  onOpenMap: () => void;
}

function miniMapPosition(lat: number, lng: number): { left: string; top: string } {
  const left = ((lng + 180) / 360) * 100;
  const top = ((90 - lat) / 180) * 100;
  return {
    left: `${Math.min(92, Math.max(8, left)).toFixed(2)}%`,
    top: `${Math.min(88, Math.max(12, top)).toFixed(2)}%`,
  };
}

export function MiniFriendMapCard({
  friend,
  feedItems,
  onOpenMap,
}: MiniFriendMapCardProps) {
  const accounts = useAppStore((state) => state.accounts);
  const { lastSeen, resolvingCount } = useFriendLastSeenLocation(friend, accounts, feedItems);

  if (!lastSeen && resolvingCount === 0) return null;

  const markerPosition = lastSeen ? miniMapPosition(lastSeen.lat, lastSeen.lng) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenMap}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMap();
        }
      }}
      className="theme-card-soft mt-4 w-full overflow-hidden rounded-2xl text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
    >
      <div className="flex items-center justify-between px-3.5 py-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--theme-accent-secondary)]">
            Last seen
          </p>
          <p className="mt-1.5 text-sm font-medium text-[color:var(--theme-text-primary)]">
            {lastSeen?.label ?? "Resolving location..."}
          </p>
          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
            {lastSeen
              ? `${formatDistanceToNow(lastSeen.seenAt, { addSuffix: true })}`
              : `Resolving ${resolvingCount.toLocaleString()} location${resolvingCount !== 1 ? "s" : ""}`}
          </p>
        </div>
        <span className="theme-chip rounded-full px-2.5 py-1 text-[11px]">
          Open map
        </span>
      </div>

      {lastSeen && (
        <div className="theme-dialog-divider relative h-36 overflow-hidden border-t bg-[color:var(--theme-map-fallback-card-background)]">
          <div className="absolute inset-0 opacity-55 [background-size:48px_48px] [background-image:linear-gradient(var(--theme-border-subtle)_1px,transparent_1px),linear-gradient(90deg,var(--theme-border-subtle)_1px,transparent_1px)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,color-mix(in_oklab,var(--theme-accent-secondary)_22%,transparent)_0%,transparent_42%),radial-gradient(circle_at_76%_78%,color-mix(in_oklab,var(--theme-accent-primary)_16%,transparent)_0%,transparent_36%)]" />
          {markerPosition ? (
            <div
              className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--theme-border-strong)] bg-[color:var(--theme-button-primary-background)] shadow-[var(--theme-marker-shadow-soft)]"
              style={markerPosition}
              aria-hidden="true"
            >
              <div className="absolute inset-1 rounded-full bg-[color:var(--theme-bg-surface)]" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
