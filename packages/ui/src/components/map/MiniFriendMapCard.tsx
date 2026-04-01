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
    <button
      type="button"
      onClick={onOpenMap}
      className="mt-4 w-full overflow-hidden rounded-2xl border border-[#6f56a8]/18 bg-[linear-gradient(180deg,rgba(50,34,74,0.34),rgba(15,14,22,0.9))] text-left shadow-[0_18px_40px_rgba(2,6,23,0.38)] transition-colors hover:border-[#8b5cf6]/22 hover:bg-[linear-gradient(180deg,rgba(62,39,98,0.42),rgba(17,17,24,0.94))]"
    >
      <div className="flex items-center justify-between px-3.5 py-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#d8b4fe]/70">
            Last seen
          </p>
          <p className="mt-1.5 text-sm font-medium text-white">
            {lastSeen?.label ?? "Resolving location..."}
          </p>
          <p className="mt-1 text-xs text-white/55">
            {lastSeen
              ? `${formatDistanceToNow(lastSeen.seenAt, { addSuffix: true })}`
              : `Resolving ${resolvingCount.toLocaleString()} location${resolvingCount !== 1 ? "s" : ""}`}
          </p>
        </div>
        <span className="rounded-full border border-[#6f56a8]/20 bg-[linear-gradient(135deg,rgba(62,39,98,0.42),rgba(24,18,35,0.8))] px-2.5 py-1 text-[11px] text-[#dfd3f7]">
          Open map
        </span>
      </div>

      {lastSeen && (
        <div className="h-36 border-t border-[#6f56a8]/14">
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
    </button>
  );
}
