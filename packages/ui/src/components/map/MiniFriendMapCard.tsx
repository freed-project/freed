import { formatDistanceToNow } from "date-fns";
import { DEFAULT_FRIEND_AVATAR_TINT, type Friend, type FeedItem } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";
import { useFriendLastSeenLocation } from "../../hooks/useResolvedLocations.js";
import { MapSurface } from "./MapSurface.js";

interface MiniFriendMapCardProps {
  friend: Friend;
  feedItems: FeedItem[];
  onOpenMap: () => void;
}

export function MiniFriendMapCard({
  friend,
  feedItems,
  onOpenMap,
}: MiniFriendMapCardProps) {
  const { lastSeen, resolvingCount } = useFriendLastSeenLocation(friend, feedItems);
  const avatarTint = useAppStore((state) => state.preferences.display.friendAvatarTint) ?? DEFAULT_FRIEND_AVATAR_TINT;

  if (!lastSeen && resolvingCount === 0) return null;

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
      className="mt-4 w-full overflow-hidden rounded-2xl border border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-bg-card)] text-left shadow-[0_18px_40px_rgb(2_6_23_/_0.28)] transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
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
        <div className="h-36 border-t border-[color:var(--theme-border-subtle)]">
          <MapSurface
            markers={[lastSeen]}
            focusedMarkerKey={lastSeen.key}
            interactive={false}
            avatarTint={avatarTint}
            emptyTitle="Resolving location"
            emptyBody="The mini map will appear here."
          />
        </div>
      )}
    </div>
  );
}
