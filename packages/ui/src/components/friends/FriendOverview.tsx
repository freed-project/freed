import { formatDistanceToNow } from "date-fns";
import { FriendAvatar } from "./FriendAvatar.js";
import { MapPinIcon } from "../icons.js";
import { CareRating, careLevelLabel, type CareLevel } from "./CareRating.js";

/** Shared non-interactive content for directory cards and author previews. */
export function FriendOverview({
  name,
  avatarUrl,
  bio,
  careLevel,
  latestActivityAt,
  lastContactAt,
  hasLocation,
  needsOutreach,
  onCareLevelChange,
}: {
  name: string;
  avatarUrl?: string | null;
  bio?: string | null;
  careLevel?: number;
  latestActivityAt?: number | null;
  lastContactAt?: number | null;
  hasLocation?: boolean;
  needsOutreach?: boolean;
  onCareLevelChange?: (level: CareLevel) => void | Promise<void>;
}) {
  return (
    <div className="flex items-start gap-3">
      <FriendAvatar name={name} avatarUrl={avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
            {name}
          </p>
          {careLevel !== undefined && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="theme-chip rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                {careLevelLabel(careLevel)}
              </span>
              {onCareLevelChange ? (
                <CareRating
                  level={careLevel as CareLevel}
                  onChange={onCareLevelChange}
                />
              ) : (
                <span
                  className="flex items-center gap-1"
                  aria-label={`Care level ${careLevel.toLocaleString()} of 5`}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <span
                      key={value}
                      className={`h-1.5 w-1.5 rounded-full ${value <= careLevel ? "bg-[color:var(--theme-accent-secondary)]" : "bg-[color:var(--theme-border-subtle)]"}`}
                    />
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
        {bio && (
          <p className="mt-1 line-clamp-2 text-xs text-[color:var(--theme-text-muted)]">
            {bio}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--theme-text-muted)]">
          {latestActivityAt !== undefined && (
            <span>
              {latestActivityAt
                ? formatDistanceToNow(latestActivityAt, { addSuffix: true })
                : "No posts yet"}
            </span>
          )}
          {lastContactAt !== undefined && (
            <span>
              {lastContactAt
                ? formatDistanceToNow(lastContactAt, { addSuffix: true })
                : "Never contacted"}
            </span>
          )}
          {hasLocation && (
            <span className="inline-flex items-center gap-1 text-[color:var(--theme-accent-secondary)]">
              <MapPinIcon className="h-3 w-3" />
              Has location
            </span>
          )}
          {needsOutreach && (
            <span className="theme-feedback-text-warning">Needs outreach</span>
          )}
        </div>
      </div>
    </div>
  );
}
