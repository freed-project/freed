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
import { feedItemsForFriend, lastPostAt, lastReachOutAt } from "@freed/shared";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  RssIcon,
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
import { resolveFriendAvatarUrl } from "../../lib/friend-avatar.js";

// ---------------------------------------------------------------------------
// Platform icon map
// ---------------------------------------------------------------------------

const cls = "w-3.5 h-3.5";
const platformIcons: Record<string, ReactNode> = {
  x: <span className="text-xs font-bold leading-none">𝕏</span>,
  rss: <RssIcon className={cls} />,
  youtube: <YoutubeIcon className={cls} />,
  reddit: <RedditIcon className={cls} />,
  mastodon: <MastodonIcon className={cls} />,
  github: <GithubIcon className={cls} />,
  facebook: <FacebookIcon className={cls} />,
  instagram: <InstagramIcon className={cls} />,
  linkedin: <LinkedInIcon className={cls} />,
  saved: <BookmarkIcon className={cls} />,
};

// ---------------------------------------------------------------------------
// Care level indicator
// ---------------------------------------------------------------------------

function CareStars({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div
      className="flex gap-0.5"
      title={`Care level ${level} of 5`}
      aria-label={`Care level ${level} of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          viewBox="0 0 12 12"
          className={`w-3 h-3 ${i <= level ? "text-amber-400" : "text-[color:var(--theme-border-subtle)]"}`}
          fill="currentColor"
          aria-hidden
        >
          <path d="M6 1l1.5 3H11L8.5 6l1 3L6 7.5 2.5 9l1-3L1 4h3.5z" />
        </svg>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini FeedItem row (compact, no full card chrome)
// ---------------------------------------------------------------------------

function TimelineItem({
  item,
  onClick,
}: {
  item: FeedItem;
  onClick?: () => void;
}) {
  const timeAgo = formatDistanceToNow(item.publishedAt, { addSuffix: true });
  const icon = platformIcons[item.platform] ?? <span className="text-xs">📄</span>;

  return (
    <button
      className="group w-full border-b border-[color:color-mix(in_oklab,var(--theme-border-subtle)_72%,transparent)] px-4 py-3 text-left transition-colors hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.08)] last:border-0"
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-text-secondary shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          {item.content.text && (
            <p className="text-sm text-text-primary line-clamp-3 leading-snug">
              {item.content.text}
            </p>
          )}
          {item.content.linkPreview?.title && !item.content.text && (
            <p className="text-sm text-text-primary line-clamp-2 font-medium">
              {item.content.linkPreview.title}
            </p>
          )}
          <p className="text-xs text-text-secondary mt-1">{timeAgo}</p>
        </div>
      </div>
    </button>
  );
}

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
      <p className="text-sm font-medium text-text-primary mb-3">Log a reach-out</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              channel === c.id
                ? "theme-chip-active"
                : "theme-chip"
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
  feedItems: Record<string, FeedItem>;
  onLogReachOut: (entry: ReachOutLog) => void;
  onOpenMap: () => void;
}

export function FriendDetailPanel({
  friend,
  feedItems,
  onLogReachOut,
  onOpenMap,
}: FriendDetailPanelProps) {
  const [showReachOut, setShowReachOut] = useState(false);

  const items = feedItemsForFriend(feedItems, friend).sort(
    (a, b) => b.publishedAt - a.publishedAt
  );

  const lastPost = lastPostAt(feedItems, friend);
  const lastContact = lastReachOutAt(friend);
  const avatarUrl = resolveFriendAvatarUrl(
    friend,
    items.map((item) => item.author.avatarUrl)
  );

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
            name={friend.name}
            avatarUrl={avatarUrl}
            size={56}
          />

          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-text-primary truncate">
              {friend.name}
            </p>
            <CareStars level={friend.careLevel} />
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
              <a
                key={`${src.platform}-${src.authorId}`}
                href={src.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="theme-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                title={src.displayName ?? src.handle}
              >
                {platformIcons[src.platform]}
                <span className="truncate max-w-[80px]">
                  {src.handle ?? src.displayName ?? src.authorId}
                </span>
              </a>
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
            {lastPost
              ? formatDistanceToNow(lastPost, { addSuffix: true })
              : "never"}
          </span>
          <span>
            <span className="text-text-tertiary">Last contact</span>{" "}
            {lastContact
              ? formatDistanceToNow(lastContact, { addSuffix: true })
              : "never"}
          </span>
        </div>

        <MiniFriendMapCard
          friend={friend}
          feedItems={items}
          onOpenMap={onOpenMap}
        />
      </div>

      {/* Reach out button / popover */}
      <div className="theme-dialog-divider shrink-0 border-b bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_90%,transparent)] px-4 py-3 backdrop-blur-md">
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
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <p className="text-text-secondary text-sm">No captured posts yet.</p>
            <p className="text-text-tertiary text-xs mt-1">
              Link social profiles in "Edit" to see their timeline here.
            </p>
          </div>
        ) : (
          items.map((item) => <TimelineItem key={item.globalId} item={item} />)
        )}
      </div>
    </div>
  );
}
