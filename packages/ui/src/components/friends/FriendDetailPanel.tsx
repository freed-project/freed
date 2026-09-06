/**
 * Friend detail panel content rendered inside the Friends sidebar.
 *
 * Shows:
 *   - Identity card (avatar, name, care level, linked handles, contact info)
 *   - Cross-platform timeline of all FeedItems from their linked sources
 *   - "Reach out" button that logs a reach-out event and clears the Reconnect ring
 */

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Friend, FeedItem, ReachOutLog } from "@freed/shared";
import { lastReachOutAt } from "@freed/shared";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  MediumIcon,
  RssIcon,
  SubstackIcon,
  XIcon,
  UsersIcon,
  YoutubeIcon,
  RedditIcon,
  GithubIcon,
  MastodonIcon,
  BookmarkIcon,
} from "../icons.js";
import type { ReactNode } from "react";
import { MiniFriendMapCard } from "../map/MiniFriendMapCard.js";
import { FriendAvatar } from "./FriendAvatar.js";
import { CareRating, type CareLevel } from "./CareRating.js";
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";
import { providerLabel } from "../../lib/account-labels.js";

// ---------------------------------------------------------------------------
// Platform icon map
// ---------------------------------------------------------------------------

const cls = "w-3.5 h-3.5";
const platformIcons: Record<string, ReactNode> = {
  x: <XIcon className={cls} />,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  linkedin: <LinkedInIcon className={cls} />,
  substack: <SubstackIcon className={cls} />,
  medium: <MediumIcon className={cls} />,
  saved: <BookmarkIcon className={cls} />,
};

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// ---------------------------------------------------------------------------
// Care level indicator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Reach-out logger popover
// ---------------------------------------------------------------------------

const CHANNELS: Array<{ id: ReachOutLog["channel"]; label: string }> = [
  { id: "phone", label: "Phone call" },
  { id: "text", label: "Text message" },
  { id: "email", label: "Email" },
  { id: "in_person", label: "In person" },
  { id: "other", label: "Other" },
];

interface ReachOutPopoverProps {
  onLog: (entry: ReachOutLog) => void;
  onCancel: () => void;
}

function ReachOutPopover({ onLog, onCancel }: ReachOutPopoverProps) {
  const [channel, setChannel] = useState<ReachOutLog["channel"]>("other");
  const [notes, setNotes] = useState("");

  return (
    <div className="glass-card mx-4 mb-4 rounded-xl px-4 py-3">
      <p className="text-sm font-medium text-text-primary mb-3">
        Log a reach-out
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              channel === c.id ? "theme-chip-active" : "theme-chip"
            }`}
            onClick={() => setChannel(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        className="theme-input mb-3 w-full resize-none rounded-lg px-3 py-2 text-sm"
        placeholder="Optional note..."
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <button
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="btn-primary rounded-lg px-3 py-1.5 text-xs"
          onClick={() =>
            onLog({
              loggedAt: Date.now(),
              channel,
              notes: notes.trim() || undefined,
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface FriendDetailPanelProps {
  friend: Friend;
  feedItems: readonly FeedItem[];
  locationItems: readonly FeedItem[];
  activityAvatarUrls: readonly (string | null | undefined)[];
  latestPostAt: number | null;
  activityLoading: boolean;
  timelineLoading: boolean;
  timelineLoadingMore: boolean;
  timelineHasMore: boolean;
  timelineAwayFromNewest: boolean;
  timelineTotalCount: number;
  onLoadMoreTimeline: () => void;
  onShowNewestTimeline: () => void;
  onLogReachOut: (entry: ReachOutLog) => void;
  onOpenMap: () => void;
  onSelectSource: (source: Friend["sources"][number]) => void;
  readOnly?: boolean;
  onCareLevelChange?: (level: CareLevel) => void | Promise<void>;
}

export function FriendDetailPanel({
  friend,
  feedItems,
  locationItems,
  activityAvatarUrls,
  latestPostAt,
  activityLoading,
  timelineLoading,
  timelineLoadingMore,
  timelineHasMore,
  timelineAwayFromNewest,
  onLoadMoreTimeline,
  onShowNewestTimeline,
  onLogReachOut,
  onOpenMap,
  onSelectSource,
  readOnly = false,
  onCareLevelChange,
}: FriendDetailPanelProps) {
  const [showReachOut, setShowReachOut] = useState(false);
  const items = [...feedItems];
  const lastContact = lastReachOutAt(friend);
  const avatarUrl = resolveFriendAvatarUrl(friend, [
    ...activityAvatarUrls,
    ...items.map((item) => item.author.avatarUrl),
  ]);

  const handleLogReachOut = (entry: ReachOutLog) => {
    onLogReachOut(entry);
    setShowReachOut(false);
  };

  return (
    <div className="flex h-full flex-col bg-[color:var(--theme-bg-deep)]">
      {/* Identity card */}
      <div className="theme-dialog-divider shrink-0 border-b bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_92%,transparent)] px-4 py-4 backdrop-blur-md">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <FriendAvatar
            name={safeText(friend.name, "Unnamed friend")}
            avatarUrl={avatarUrl}
            size={56}
          />

          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-text-primary truncate">
              {safeText(friend.name, "Unnamed friend")}
            </p>
            <CareRating level={friend.careLevel} onChange={onCareLevelChange} />
            {friend.bio && (
              <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                {friend.bio}
              </p>
            )}
          </div>
        </div>

        {/* Linked profiles */}
        {friend.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {friend.sources.map((src) => (
              <button
                key={`${src.platform}-${src.authorId}`}
                type="button"
                onClick={() => onSelectSource(src)}
                className="theme-chip inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-xs text-[color:var(--theme-accent-primary)] transition-colors hover:bg-[color:var(--theme-accent-glow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
                title={`Select ${providerLabel(src.platform)} profile: ${src.handle ?? src.displayName ?? friend.name}`}
              >
                {platformIcons[src.platform]}
                <span>
                  {providerLabel(src.platform)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Contact info */}
        {friend.contact && (
          <div className="mt-3 text-xs text-text-secondary space-y-0.5">
            {friend.contact.phone && (
              <p>
                <span className="text-text-tertiary">Phone</span>{" "}
                <a
                  href={`tel:${friend.contact.phone}`}
                  className="theme-link hover:underline"
                >
                  {friend.contact.phone}
                </a>
              </p>
            )}
            {friend.contact.email && (
              <p>
                <span className="text-text-tertiary">Email</span>{" "}
                <a
                  href={`mailto:${friend.contact.email}`}
                  className="theme-link hover:underline"
                >
                  {friend.contact.email}
                </a>
              </p>
            )}
          </div>
        )}

        {/* Activity summary */}
        <div className="mt-3 flex items-center gap-4 text-xs text-text-secondary">
          <span>
            <span className="text-text-tertiary">Last post</span>{" "}
            {latestPostAt
              ? formatDistanceToNow(latestPostAt, { addSuffix: true })
              : activityLoading
                ? "loading..."
                : "never"}
          </span>
          <span>
            <span className="text-text-tertiary">Last contact</span>{" "}
            {lastContact
              ? formatDistanceToNow(lastContact, { addSuffix: true })
              : "never"}
          </span>
        </div>

      </div>

      {/* Reach out button / popover */}
      {!readOnly ? <div className="theme-dialog-divider shrink-0 border-b bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_90%,transparent)] px-4 py-3 backdrop-blur-md">
        {showReachOut ? (
          <ReachOutPopover
            onLog={handleLogReachOut}
            onCancel={() => setShowReachOut(false)}
          />
        ) : (
          <button
            className="btn-secondary flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm"
            onClick={() => setShowReachOut(true)}
          >
            <UsersIcon className="w-3.5 h-3.5" />
            Mark as reached out
          </button>
        )}
      </div> : null}

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">Recent activity</p>
        {timelineLoading ? (
          <div className="flex h-full items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-text-secondary">
              Loading recent activity...
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <p className="text-text-secondary text-sm">
              No captured posts yet.
            </p>
            <p className="text-text-tertiary text-xs mt-1">
              Link social profiles in "Edit" to see their timeline here.
            </p>
            {timelineAwayFromNewest ? (
              <button
                type="button"
                className="btn-secondary mt-4 w-full rounded-lg px-3 py-2 text-sm"
                disabled={timelineLoadingMore}
                onClick={onShowNewestTimeline}
              >
                Back to newest
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="space-y-2">{items.map((item) => (
              <RecentActivityCard key={item.globalId} item={item} />
            ))}</div>
            {timelineHasMore || timelineAwayFromNewest ? (
              <div className="flex gap-2 px-4 py-3">
                {timelineAwayFromNewest ? (
                  <button
                    type="button"
                    className="btn-secondary w-full rounded-lg px-3 py-2 text-sm"
                    disabled={timelineLoadingMore}
                    onClick={onShowNewestTimeline}
                  >
                    Back to newest
                  </button>
                ) : null}
                {timelineHasMore ? (
                  <button
                    type="button"
                    className="btn-secondary w-full rounded-lg px-3 py-2 text-sm"
                    disabled={timelineLoadingMore}
                    onClick={onLoadMoreTimeline}
                  >
                    {timelineLoadingMore ? "Loading..." : "Older posts"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <MiniFriendMapCard friend={friend} feedItems={locationItems.length ? locationItems : feedItems} onOpenMap={onOpenMap} />
    </div>
  );
}
import { RecentActivityCard } from "./RecentActivityCard.js";
