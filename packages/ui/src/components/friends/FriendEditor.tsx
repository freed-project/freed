/**
 * FriendEditor — modal for creating or editing a Friend record.
 *
 * Sections:
 *   1. Basic info: name, avatar URL, bio, care level, reach-out interval
 *   2. Contact import: "Import from Contacts" button (injected via PlatformContext)
 *      or a manual phone/email/address form fallback
 *   3. Social sources: link/unlink platform profiles seen in the feed
 *   4. Tags and notes
 */

import { useState, useMemo } from "react";
import type { Friend, FriendSource, DeviceContact, FeedItem, Platform } from "@freed/shared";
import { usePlatform, useAppStore } from "../../context/PlatformContext.js";
import {
  FacebookIcon,
  InstagramIcon,
  RssIcon,
  YoutubeIcon,
  RedditIcon,
  GithubIcon,
  MastodonIcon,
  BookmarkIcon,
} from "../icons.js";
import type { ReactNode } from "react";

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
  saved: <BookmarkIcon className={cls} />,
};

// ---------------------------------------------------------------------------
// Care level labels
// ---------------------------------------------------------------------------

const CARE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: "Closest — nudge weekly",
  4: "Close — nudge every 2 weeks",
  3: "Good friend — nudge monthly",
  2: "Acquaintance — nudge quarterly",
  1: "Peripheral — no nudges",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditorFriend = Omit<Friend, "id" | "createdAt" | "updatedAt">;

interface FriendEditorProps {
  /** When editing, pass the existing friend. When creating, pass null. */
  existing?: Friend | null;
  onSave: (data: EditorFriend, id?: string) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Collect all unique authors from the feed as linkable profile candidates
// ---------------------------------------------------------------------------

interface AuthorCandidate {
  platform: Platform;
  authorId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
}

function useAuthorCandidates(
  existingSources: FriendSource[],
  allFriends: Record<string, Friend>
): AuthorCandidate[] {
  const items = useAppStore((s) => s.items);

  return useMemo(() => {
    const seen = new Map<string, AuthorCandidate>();

    // Build a set of already-linked (platform, authorId) keys across all friends
    const linked = new Set<string>();
    for (const f of Object.values(allFriends)) {
      for (const src of f.sources) {
        linked.add(`${src.platform}:${src.authorId}`);
      }
    }
    // Current friend's own sources shouldn't count as "taken"
    for (const src of existingSources) {
      linked.delete(`${src.platform}:${src.authorId}`);
    }

    for (const item of items) {
      const key = `${item.platform}:${item.author.id}`;
      if (!seen.has(key) && !linked.has(key)) {
        seen.set(key, {
          platform: item.platform,
          authorId: item.author.id,
          handle: item.author.handle,
          displayName: item.author.displayName,
          avatarUrl: item.author.avatarUrl,
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [items, existingSources, allFriends]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendEditor({
  existing,
  onSave,
  onDelete,
  onCancel,
}: FriendEditorProps) {
  const platform = usePlatform();
  const allFriends = useAppStore((s) => s.friends);

  // Form state
  const [name, setName] = useState(existing?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(existing?.avatarUrl ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [careLevel, setCareLevel] = useState<1 | 2 | 3 | 4 | 5>(
    existing?.careLevel ?? 3
  );
  const [reachOutDays, setReachOutDays] = useState(
    existing?.reachOutIntervalDays?.toString() ?? ""
  );
  const [sources, setSources] = useState<FriendSource[]>(
    existing?.sources ?? []
  );
  const [contact, setContact] = useState<DeviceContact | undefined>(
    existing?.contact
  );
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactPhone, setContactPhone] = useState(contact?.phone ?? "");
  const [contactEmail, setContactEmail] = useState(contact?.email ?? "");
  const [contactAddress, setContactAddress] = useState(contact?.address ?? "");
  const [tags, setTags] = useState(existing?.tags?.join(", ") ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [sourceSearch, setSourceSearch] = useState("");
  const [contactImporting, setContactImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const candidates = useAuthorCandidates(sources, allFriends);
  const filteredCandidates = candidates.filter((c) => {
    const q = sourceSearch.toLowerCase();
    return (
      !q ||
      c.displayName.toLowerCase().includes(q) ||
      c.handle.toLowerCase().includes(q) ||
      c.platform.includes(q)
    );
  });

  const isSourceLinked = (c: AuthorCandidate) =>
    sources.some((s) => s.platform === c.platform && s.authorId === c.authorId);

  const toggleSource = (c: AuthorCandidate) => {
    if (isSourceLinked(c)) {
      setSources((prev) =>
        prev.filter(
          (s) => !(s.platform === c.platform && s.authorId === c.authorId)
        )
      );
    } else {
      setSources((prev) => [
        ...prev,
        {
          platform: c.platform,
          authorId: c.authorId,
          handle: c.handle,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
        },
      ]);
    }
  };

  const handleImportContact = async () => {
    if (!platform.pickContact) {
      setShowContactForm(true);
      return;
    }
    setContactImporting(true);
    try {
      const result = await platform.pickContact();
      if (result) {
        if (!name) setName(result.name);
        setContact({
          importedFrom: "web",
          name: result.name,
          phone: result.phone,
          email: result.email,
          address: result.address,
          nativeId: result.nativeId,
          importedAt: Date.now(),
        });
        setContactPhone(result.phone ?? "");
        setContactEmail(result.email ?? "");
        setContactAddress(result.address ?? "");
      }
    } finally {
      setContactImporting(false);
    }
  };

  const handleSaveContactForm = () => {
    if (!contactPhone && !contactEmail && !contactAddress) {
      setContact(undefined);
    } else {
      setContact({
        importedFrom: "web",
        name: name || "Unknown",
        phone: contactPhone || undefined,
        email: contactEmail || undefined,
        address: contactAddress || undefined,
        importedAt: Date.now(),
      });
    }
    setShowContactForm(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const parsedDays = parseInt(reachOutDays, 10);
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const data: EditorFriend = {
      name: name.trim(),
      avatarUrl: avatarUrl.trim() || undefined,
      bio: bio.trim() || undefined,
      sources,
      contact,
      careLevel,
      reachOutIntervalDays: isNaN(parsedDays) ? undefined : parsedDays,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      notes: notes.trim() || undefined,
    };

    onSave(data, existing?.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-lg bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-base font-semibold text-text-primary flex-1">
            {existing ? "Edit friend" : "Add friend"}
          </h2>
          <button
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5" aria-hidden>
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Section 1: Basic info */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Basic info
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Avatar URL
                </label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Bio</label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Optional short bio"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
              </div>
            </div>
          </section>

          {/* Section 2: Care level */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Relationship
            </h3>
            <div className="space-y-2">
              {([5, 4, 3, 2, 1] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setCareLevel(level)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                    careLevel === level
                      ? "border-[#8b5cf6]/50 bg-[#8b5cf6]/10"
                      : "border-white/10 hover:border-white/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <svg
                        key={i}
                        viewBox="0 0 12 12"
                        className={`w-3 h-3 ${i <= level ? "text-amber-400" : "text-white/15"}`}
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M6 1l1.5 3H11L8.5 6l1 3L6 7.5 2.5 9l1-3L1 4h3.5z" />
                      </svg>
                    ))}
                  </div>
                  <span className="text-xs text-text-secondary">
                    {CARE_LABELS[level]}
                  </span>
                </button>
              ))}
              <div className="mt-2">
                <label className="text-xs text-text-secondary mb-1 block">
                  Custom interval (days) — overrides the default above
                </label>
                <input
                  type="number"
                  min={1}
                  value={reachOutDays}
                  onChange={(e) => setReachOutDays(e.target.value)}
                  placeholder="e.g. 21"
                  className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Contact info */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Contact info
            </h3>
            {contact ? (
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-text-secondary space-y-0.5">
                {contact.phone && <p>Phone: {contact.phone}</p>}
                {contact.email && <p>Email: {contact.email}</p>}
                {contact.address && <p>Address: {contact.address}</p>}
                <button
                  className="text-[#c4b5fd] hover:text-[#a78bfa] transition-colors mt-1"
                  onClick={() => {
                    setContact(undefined);
                    setContactPhone("");
                    setContactEmail("");
                    setContactAddress("");
                  }}
                >
                  Remove contact info
                </button>
              </div>
            ) : showContactForm ? (
              <div className="space-y-2">
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
                <input
                  type="text"
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  placeholder="Address"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setShowContactForm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs font-medium bg-[#8b5cf6]/20 text-[#c4b5fd] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
                    onClick={handleSaveContactForm}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleImportContact}
                disabled={contactImporting}
                className="w-full px-3 py-2 text-sm text-text-secondary hover:text-text-primary border border-white/10 hover:border-white/20 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {contactImporting ? (
                  <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-6-3a3 3 0 11-6 0 3 3 0 016 0zM2 17a6 6 0 0112 0" />
                  </svg>
                )}
                {platform.pickContact
                  ? "Import from Contacts"
                  : "Enter contact info manually"}
              </button>
            )}
          </section>

          {/* Section 4: Social sources */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Social profiles
            </h3>

            {/* Currently linked */}
            {sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {sources.map((src) => (
                  <span
                    key={`${src.platform}-${src.authorId}`}
                    className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/30 text-xs text-[#c4b5fd]"
                  >
                    {platformIcons[src.platform]}
                    <span className="truncate max-w-[80px]">
                      {src.handle ?? src.displayName}
                    </span>
                    <button
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-[#c4b5fd]/70 hover:text-[#c4b5fd]"
                      onClick={() => toggleSource({ ...src } as AuthorCandidate)}
                      aria-label={`Unlink ${src.handle}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search + candidates */}
            <input
              type="text"
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              placeholder="Search profiles in your feed..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60 mb-2"
            />

            {filteredCandidates.length === 0 && (
              <p className="text-xs text-text-tertiary py-2">
                {candidates.length === 0
                  ? "No unlinked profiles in your feed yet."
                  : "No matches."}
              </p>
            )}

            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {filteredCandidates.slice(0, 50).map((c) => (
                <button
                  key={`${c.platform}-${c.authorId}`}
                  onClick={() => toggleSource(c)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left"
                >
                  {c.avatarUrl ? (
                    <img
                      src={c.avatarUrl}
                      alt=""
                      className="w-6 h-6 rounded-full bg-white/5 shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="text-xs text-text-primary truncate block">
                      {c.displayName}
                    </span>
                    <span className="text-xs text-text-tertiary truncate block">
                      {platformIcons[c.platform]}{" "}
                      {c.handle}
                    </span>
                  </span>
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSourceLinked(c)
                        ? "bg-[#8b5cf6] border-[#8b5cf6] text-white"
                        : "border-white/20"
                    }`}
                    aria-hidden
                  >
                    {isSourceLinked(c) && (
                      <svg viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5" aria-hidden>
                        <path d="M1 4l3 3 5-6" />
                      </svg>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Section 5: Tags & notes */}
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Tags &amp; notes
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="work, college, hiking..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you want to remember..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#8b5cf6]/60 resize-none"
                />
              </div>
            </div>
          </section>

          {/* Danger: delete */}
          {existing && onDelete && (
            <section className="border-t border-white/10 pt-4">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-red-400 flex-1">
                    Remove {existing.name} from your friends?
                  </p>
                  <button
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    onClick={() => onDelete(existing.id)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove friend
                </button>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-white/10 hover:border-white/20 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {existing ? "Save changes" : "Add friend"}
          </button>
        </div>
      </div>
    </div>
  );
}
