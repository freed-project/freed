import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Account, FeedItem, Person } from "@freed/shared";
import { FriendAvatar } from "./FriendAvatar.js";
import { SearchField } from "../SearchField.js";
import type { AccountLinkSuggestion } from "../../lib/account-link-suggestions.js";

interface AccountDetailPanelProps {
  account: Account;
  linkedPerson?: Person | null;
  suggestions: AccountLinkSuggestion[];
  persons: Person[];
  feedItems: FeedItem[];
  onBack: () => void;
  onPromoteToFriend: () => void;
  onLinkToPerson: (personId: string) => void;
  onOpenPerson: (personId: string) => void;
}

function providerLabel(provider: Account["provider"]): string {
  if (provider === "x") return "X";
  if (provider === "google_contacts") return "Google Contacts";
  if (provider === "macos_contacts") return "Contacts";
  if (provider === "ios_contacts") return "Contacts";
  if (provider === "android_contacts") return "Contacts";
  if (provider === "web_contact") return "Manual contact";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function accountTitle(account: Account): string {
  return account.displayName ?? account.handle ?? account.externalId;
}

function accountSubtitle(account: Account): string {
  if (account.handle?.trim()) return account.handle;
  if (account.displayName?.trim()) return account.externalId;
  return providerLabel(account.provider);
}

function itemSnippet(item: FeedItem): string {
  const text = item.content.text?.trim();
  if (text) return text.length > 120 ? `${text.slice(0, 120)}...` : text;
  if (item.content.linkPreview?.title) return item.content.linkPreview.title;
  return "No text preview";
}

export function AccountDetailPanel({
  account,
  linkedPerson = null,
  suggestions,
  persons,
  feedItems,
  onBack,
  onPromoteToFriend,
  onLinkToPerson,
  onOpenPerson,
}: AccountDetailPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const suggestionIds = useMemo(
    () => new Set(suggestions.map((suggestion) => suggestion.personId)),
    [suggestions],
  );
  const filteredPersons = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    const next = persons.filter((person) => person.relationshipStatus === "friend");
    if (!normalized) return next;
    return next.filter((person) => {
      return (
        person.name.toLowerCase().includes(normalized) ||
        person.bio?.toLowerCase().includes(normalized) ||
        person.tags?.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }, [persons, searchQuery]);

  return (
    <div className="flex h-full flex-col bg-[color:var(--theme-bg-deep)]">
      <div className="theme-dialog-divider flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary rounded-lg p-1.5"
            aria-label="Back to all friends"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4" aria-hidden>
              <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">
              {accountTitle(account)}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
              {providerLabel(account.provider)}
            </p>
          </div>
        </div>
        {!linkedPerson ? (
          <button
            type="button"
            onClick={onPromoteToFriend}
            className="btn-primary rounded-lg px-3 py-1.5 text-xs"
          >
            Promote to friend
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onOpenPerson(linkedPerson.id)}
            className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
          >
            Open friend
          </button>
        )}
      </div>

      <div className="theme-dialog-divider border-b px-4 py-4">
        <div className="flex items-start gap-3">
          <FriendAvatar
            name={accountTitle(account)}
            avatarUrl={account.avatarUrl}
            size={56}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-[color:var(--theme-text-primary)]">
                {accountTitle(account)}
              </p>
              <span className="theme-chip rounded-full px-2 py-0.5 text-[11px]">
                {providerLabel(account.provider)}
              </span>
            </div>
            <p className="mt-1 text-sm text-[color:var(--theme-text-muted)]">
              {accountSubtitle(account)}
            </p>
            {linkedPerson ? (
              <p className="mt-2 text-xs text-[color:var(--theme-accent-secondary)]">
                Linked to {linkedPerson.name}
              </p>
            ) : (
              <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
                This account is still unlinked.
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--theme-text-muted)]">
          <span>
            First seen {formatDistanceToNow(account.firstSeenAt, { addSuffix: true })}
          </span>
          <span>
            Last seen {formatDistanceToNow(account.lastSeenAt, { addSuffix: true })}
          </span>
          <span>{feedItems.length.toLocaleString()} captured post{feedItems.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      {!linkedPerson ? (
        <>
          {suggestions.length > 0 ? (
            <div className="theme-dialog-divider border-b px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
                    Suggested links
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--theme-text-primary)]">
                    Review likely matches before you attach this account.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {suggestions.map((suggestion) => {
                  const person = persons.find((candidate) => candidate.id === suggestion.personId);
                  if (!person) return null;
                  return (
                    <button
                      key={`${suggestion.accountId}:${suggestion.personId}`}
                      type="button"
                      onClick={() => onLinkToPerson(person.id)}
                      className="theme-card-soft w-full rounded-2xl px-3 py-3 text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
                            {person.name}
                          </p>
                          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                            {suggestion.reason}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                          suggestion.confidence === "high"
                            ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
                            : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
                        }`}>
                          {suggestion.confidence}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="theme-dialog-divider border-b px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
              Link to existing friend
            </p>
            <div className="mt-3">
              <SearchField
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onClear={() => setSearchQuery("")}
                placeholder="Search friends"
                aria-label="Search friends"
                inputClassName="rounded-xl"
              />
            </div>

            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {filteredPersons.length === 0 ? (
                <div className="theme-panel-muted rounded-xl px-4 py-4 text-center">
                  <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
                    No friends match this search
                  </p>
                </div>
              ) : (
                filteredPersons.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => onLinkToPerson(person.id)}
                    className="theme-card-soft flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
                        {person.name}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                        Care level {person.careLevel.toLocaleString()}
                      </p>
                    </div>
                    {suggestionIds.has(person.id) ? (
                      <span className="rounded-full bg-[color:rgb(var(--theme-feedback-success-rgb)/0.16)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:rgb(var(--theme-feedback-success-rgb))]">
                        Suggested
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
          Recent activity
        </p>
        {feedItems.length === 0 ? (
          <div className="theme-panel-muted mt-3 rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
              No captured posts for this account yet
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {feedItems.slice(0, 8).map((item) => (
              <div
                key={item.globalId}
                className="theme-card-soft rounded-2xl px-3 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--theme-text-muted)]">
                    {providerLabel(item.platform)}
                  </span>
                  <span className="text-[11px] text-[color:var(--theme-text-muted)]">
                    {formatDistanceToNow(item.publishedAt, { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--theme-text-primary)]">
                  {itemSnippet(item)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
