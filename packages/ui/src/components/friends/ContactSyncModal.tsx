/**
 * ContactSyncModal — shows Google Contacts match suggestions.
 *
 * Sections:
 *   1. Strong Matches (high confidence)
 *   2. Possible Matches (medium confidence)
 *   3. Unmatched Contacts (no social match — offer "Create Friend")
 *   4. Already Linked (collapsed) — contacts already imported from Google
 */

import { useMemo, useState } from "react";
import type { ContactSyncState, ContactMatch, GoogleContact } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";

const UNMATCHED_PAGE_SIZE = 10;

interface ContactSyncModalProps {
  onClose: () => void;
  syncState: ContactSyncState;
  /** Link a matched contact to the associated Friend / unlinked author(s). */
  onLink: (match: ContactMatch) => Promise<void>;
  /** Dismiss a match without linking (user says "not the same person"). */
  onSkip: (contactResourceName: string, friendIdOrAuthorId: string) => void;
  /** Create a new Friend from an unmatched Google contact. */
  onCreateFriend: (contact: GoogleContact) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function ContactAvatar({ contact }: { contact: GoogleContact }) {
  const photo = contact.photos.find(p => p.default) ?? contact.photos[0];
  const initials = (() => {
    const first = contact.name.givenName?.[0] ?? "";
    const last = contact.name.familyName?.[0] ?? "";
    return (first + last).toUpperCase() || (contact.name.displayName?.[0] ?? "?").toUpperCase();
  })();

  if (photo?.url) {
    return (
      <img
        src={photo.url}
        alt={contact.name.displayName ?? ""}
        className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10"
      />
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.18)] ring-1 ring-[color:var(--theme-border-strong)]">
      <span className="text-xs font-semibold text-[color:var(--theme-text-primary)]">{initials}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match row (high / medium confidence)
// ---------------------------------------------------------------------------

function MatchRow({
  match,
  matchedName,
  onLink,
  onSkip,
}: {
  match: ContactMatch;
  matchedName: string;
  onLink: (match: ContactMatch) => Promise<void>;
  onSkip: (contactResourceName: string, id: string) => void;
}) {
  const [linking, setLinking] = useState(false);
  const potentialIds = [
    ...(match.friend ? [match.friend.id] : []),
    ...match.authorIds,
  ];

  const handleLink = async () => {
    setLinking(true);
    try {
      await onLink(match);
    } finally {
      setLinking(false);
    }
  };

  const handleSkip = () => {
    for (const id of potentialIds) {
      onSkip(match.contact.resourceName, id);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
      <ContactAvatar contact={match.contact} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">
          {match.contact.name.displayName ?? "Unknown"}
        </p>
        {match.contact.emails[0] && (
          <p className="text-xs text-text-secondary truncate">
            {match.contact.emails[0].value}
          </p>
        )}
      </div>

      {/* Arrow + matched friend / author name */}
      <div className="flex items-center gap-1.5 shrink-0">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-[color:var(--theme-text-muted)]" aria-hidden>
          <path d="M4 10h12M12 6l4 4-4 4" />
        </svg>
        <span className="max-w-[100px] truncate text-xs font-medium text-[color:var(--theme-text-secondary)]">{matchedName}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className="theme-chip-active rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          onClick={handleLink}
          disabled={linking}
        >
          {linking ? "Linking…" : "Link"}
        </button>
        <button
          className="rounded-lg px-2.5 py-1 text-xs text-[color:var(--theme-text-muted)] transition-colors hover:bg-[color:var(--theme-bg-card)] hover:text-[color:var(--theme-text-secondary)]"
          onClick={handleSkip}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unmatched contact row
// ---------------------------------------------------------------------------

function UnmatchedRow({
  contact,
  onCreateFriend,
}: {
  contact: GoogleContact;
  onCreateFriend: (contact: GoogleContact) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreateFriend(contact);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
      <ContactAvatar contact={contact} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">
          {contact.name.displayName ?? "Unknown"}
        </p>
        {contact.emails[0] && (
          <p className="text-xs text-text-secondary truncate">
            {contact.emails[0].value}
          </p>
        )}
        {contact.organizations[0]?.name && (
          <p className="truncate text-xs text-[color:var(--theme-text-muted)]">
            {contact.organizations[0].name}
          </p>
        )}
      </div>

      <button
        className="btn-secondary shrink-0 rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
        onClick={handleCreate}
        disabled={creating}
      >
        {creating ? "Adding…" : "Add Friend"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, count, action }: { title: string; count: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1 px-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--theme-text-muted)]">{title}</span>
      <span className="text-xs tabular-nums text-[color:var(--theme-text-soft)]">({count})</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function ContactSyncModal({ onClose, syncState, onLink, onSkip, onCreateFriend }: ContactSyncModalProps) {
  const [alreadyLinkedOpen, setAlreadyLinkedOpen] = useState(false);
  const [showAllUnmatched, setShowAllUnmatched] = useState(false);
  const [linkingAll, setLinkingAll] = useState(false);
  const friends = useAppStore((s) => s.friends);
  const items = useAppStore((s) => s.items);

  const highMatches = syncState.pendingMatches.filter(m => m.confidence === "high");
  const mediumMatches = syncState.pendingMatches.filter(m => m.confidence === "medium");
  const authorDisplayNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of items) {
      if (!names.has(item.author.id)) {
        names.set(item.author.id, item.author.displayName || item.author.handle || item.author.id);
      }
    }
    return names;
  }, [items]);

  // Use nativeId for reliable linked/unmatched detection — name matching is
  // fragile (two contacts can share a display name).
  const linkedResourceNames = new Set(
    Object.values(friends)
      .filter(f => f.contact?.importedFrom === "google" && f.contact.nativeId)
      .map(f => f.contact!.nativeId!)
  );

  const pendingResourceNames = new Set(
    syncState.pendingMatches.map(m => m.contact.resourceName)
  );

  const unmatchedContacts = syncState.cachedContacts.filter(contact =>
    !pendingResourceNames.has(contact.resourceName) &&
    !linkedResourceNames.has(contact.resourceName)
  );

  const linkedContacts = syncState.cachedContacts.filter(contact =>
    linkedResourceNames.has(contact.resourceName)
  );

  const visibleUnmatched = showAllUnmatched
    ? unmatchedContacts
    : unmatchedContacts.slice(0, UNMATCHED_PAGE_SIZE);

  const totalPending = highMatches.length + mediumMatches.length;

  const handleLinkAll = async () => {
    setLinkingAll(true);
    try {
      for (const match of highMatches) {
        await onLink(match);
      }
    } finally {
      setLinkingAll(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-black/70 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[color:var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-elevated)_96%,transparent)] shadow-2xl sm:max-h-[85vh]">

        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[color:var(--theme-border-subtle)] px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-text-primary">Google Contacts</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {totalPending > 0
                ? `${totalPending} contact${totalPending !== 1 ? "s" : ""} to review`
                : "All contacts up to date"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors shrink-0"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5" aria-hidden>
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5 minimal-scroll">

          {/* Empty state */}
          {totalPending === 0 && unmatchedContacts.length === 0 && (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-emerald-400" aria-hidden>
                  <path d="M4 10l4 4 8-8" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">All caught up</p>
                <p className="text-xs text-text-secondary mt-1">No new contact matches to review.</p>
              </div>
            </div>
          )}

          {/* Strong Matches */}
          {highMatches.length > 0 && (
            <section>
              <SectionHeader
                title="Strong Matches"
                count={highMatches.length}
                action={
                  <button
                    onClick={handleLinkAll}
                    disabled={linkingAll}
                    className="theme-chip-active rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                  >
                    {linkingAll ? "Linking…" : "Link All"}
                  </button>
                }
              />
              <div className="space-y-0.5">
                {highMatches.map((match) => (
                  <MatchRow
                    key={match.contact.resourceName}
                    match={match}
                    matchedName={match.friend?.name ?? authorDisplayNames.get(match.authorIds[0] ?? "") ?? "Unknown"}
                    onLink={onLink}
                    onSkip={onSkip}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Possible Matches */}
          {mediumMatches.length > 0 && (
            <section>
              <SectionHeader title="Possible Matches" count={mediumMatches.length} />
              <div className="space-y-0.5">
                {mediumMatches.map((match) => (
                  <MatchRow
                    key={match.contact.resourceName}
                    match={match}
                    matchedName={match.friend?.name ?? authorDisplayNames.get(match.authorIds[0] ?? "") ?? "Unknown"}
                    onLink={onLink}
                    onSkip={onSkip}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Unmatched Contacts — capped to avoid rendering hundreds of rows */}
          {unmatchedContacts.length > 0 && (
            <section>
              <SectionHeader title="Unmatched Contacts" count={unmatchedContacts.length} />
              <p className="mb-2 px-1 text-xs text-[color:var(--theme-text-muted)]">
                These contacts don't match anyone in your feed. Add them as a Friend to track them.
              </p>
              <div className="space-y-0.5">
                {visibleUnmatched.map((contact) => (
                  <UnmatchedRow
                    key={contact.resourceName}
                    contact={contact}
                    onCreateFriend={onCreateFriend}
                  />
                ))}
              </div>
              {unmatchedContacts.length > UNMATCHED_PAGE_SIZE && (
                <button
                  onClick={() => setShowAllUnmatched(v => !v)}
                  className="mt-2 w-full py-1.5 text-xs text-[color:var(--theme-text-muted)] transition-colors hover:text-[color:var(--theme-text-secondary)]"
                >
                  {showAllUnmatched
                    ? "Show fewer"
                    : `Show ${unmatchedContacts.length - UNMATCHED_PAGE_SIZE} more`}
                </button>
              )}
            </section>
          )}

          {/* Already Linked (collapsed by default) */}
          {linkedContacts.length > 0 && (
            <section>
              <button
                onClick={() => setAlreadyLinkedOpen(v => !v)}
                className="w-full flex items-center gap-2 px-1 py-1 text-left group"
              >
                <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--theme-text-muted)]">
                  Already Linked
                </span>
                <span className="text-xs tabular-nums text-[color:var(--theme-text-soft)]">({linkedContacts.length})</span>
                <svg
                  className={`h-3 w-3 shrink-0 text-[color:var(--theme-text-soft)] transition-transform ${alreadyLinkedOpen ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {alreadyLinkedOpen && (
                <div className="mt-1 space-y-0.5">
                  {linkedContacts.map((contact) => (
                    <div
                      key={contact.resourceName}
                      className="flex items-center gap-3 py-2 px-3 rounded-xl opacity-50"
                    >
                      <ContactAvatar contact={contact} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-secondary truncate">
                          {contact.name.displayName ?? "Unknown"}
                        </p>
                      </div>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden>
                        <path d="M4 10l4 4 8-8" />
                      </svg>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--theme-border-subtle)] px-5 py-3">
          {syncState.lastSyncedAt && (
            <span className="text-xs text-[color:var(--theme-text-muted)]">
              Last synced {new Date(syncState.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={onClose}
            className="btn-secondary ml-auto rounded-lg px-4 py-1.5 text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
