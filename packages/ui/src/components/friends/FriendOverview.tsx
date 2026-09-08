import { formatDistanceToNow } from "date-fns";
import { FriendAvatar } from "./FriendAvatar.js";
import { MapPinIcon } from "../icons.js";
import { CareRating, type CareLevel } from "./CareRating.js";
import { useAppStore } from "../../context/PlatformContext.js";
import { useLibraryMapCandidates } from "../../hooks/useLibrarySurfaceItems.js";

/** Shared non-interactive content for directory cards and author previews. */
export function FriendOverview({
  name,
  id,
  accountId,
  avatarUrl,
  bio,
  careLevel,
  latestActivityAt,
  onCareLevelChange,
}: {
  name: string;
  id?: string;
  accountId?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  careLevel?: number;
  latestActivityAt?: number | null;
  lastContactAt?: number | null;
  hasLocation?: boolean;
  needsOutreach?: boolean;
  onCareLevelChange?: (level: CareLevel) => void | Promise<void>;
}) {
  const sourceVersion = useAppStore(state => state.searchCorpusVersion);
  const candidates = useLibraryMapCandidates(sourceVersion);
  const locationName = candidates
    .filter(candidate => (id && candidate.friend?.id === id) || (accountId && candidate.accountId === accountId))
    .sort((a, b) => b.item.publishedAt - a.item.publishedAt)
    .find(candidate => candidate.item.location?.name)?.item.location?.name;
  return (
    <div className="flex items-start gap-3">
      <FriendAvatar name={name} avatarUrl={avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
            {name}
          </p>
          {careLevel !== undefined && (
            <div className="w-full">
              <CareRating level={careLevel as CareLevel} onChange={onCareLevelChange} />
            </div>
          )}
        </div>
        {bio && (
          <p className="mt-1 line-clamp-2 text-xs text-[color:var(--theme-text-muted)]">
            {bio}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.6875rem] text-[color:var(--theme-text-muted)]">
          {latestActivityAt !== undefined && (
            <span>
              {latestActivityAt
                ? formatDistanceToNow(latestActivityAt, { addSuffix: true })
                : "No posts yet"}
            </span>
          )}
          {locationName && (
            <span title={locationName} className="inline-flex w-full min-w-0 items-center gap-1 whitespace-nowrap text-[color:var(--theme-accent-secondary)]">
              <MapPinIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{locationName}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
