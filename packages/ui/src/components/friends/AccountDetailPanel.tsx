import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type {
  Account,
  FeedItem,
  FriendCandidateSuggestion,
  Person,
} from "@freed/shared";
import { ChannelAvatar } from "../ChannelAvatar.js";
import { MiniFriendMapCard } from "../map/MiniFriendMapCard.js";
import { SearchField } from "../SearchField.js";
import type { AccountLinkSuggestion } from "../../lib/account-link-suggestion.js";
import { useLibraryPersonPicker } from "../../hooks/useLibraryPersonPicker.js";
import { usePlatform } from "../../context/PlatformContext.js";
import {
  accountSubtitle,
  accountTitle,
  providerLabel,
} from "../../lib/account-labels.js";

interface AccountDetailPanelProps {
  account: Account;
  linkedPerson?: Person | null;
  suggestions: readonly AccountLinkSuggestion[];
  friendSuggestion?: FriendCandidateSuggestion | null;
  sourceVersion: number;
  feedItems: readonly FeedItem[];
  timelineLoading: boolean;
  timelineTotalCount: number;
  onBack: () => void;
  onPromoteToFriend: () => void;
  onPromoteToFam: () => void;
  onDismissFriendSuggestion?: (suggestionId: string) => void;
  onLinkToPerson: (personId: string) => void;
  onOpenPerson: (personId: string) => void;
  onOpenMap: (personId: string) => void;
  locationItems: readonly FeedItem[];
  readOnly?: boolean;
}


function evidenceIdLabel(itemId: string): string {
  return `...${itemId.slice(-8)}`;
}

function signalCountLabel(suggestion: FriendCandidateSuggestion): string {
  const entries = Object.entries(suggestion.signalCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 4);
  if (entries.length === 0) return "No classified signals yet";
  return entries
    .map(
      ([signal, count]) =>
        `${signal.replace(/_/g, " ")} ${Number(count).toLocaleString()}`,
    )
    .join(", ");
}

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function personName(person: Pick<Person, "name"> | null | undefined): string {
  return safeText(person?.name, "Unnamed friend");
}

export function AccountDetailPanel({
  account,
  linkedPerson = null,
  suggestions,
  friendSuggestion = null,
  sourceVersion,
  feedItems,
  timelineLoading,
  onBack,
  onPromoteToFriend,
  onPromoteToFam,
  onDismissFriendSuggestion,
  onLinkToPerson,
  onOpenPerson,
  onOpenMap,
  locationItems,
  readOnly = false,
}: AccountDetailPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { queryLibraryCore } = usePlatform();
  const personPicker = useLibraryPersonPicker({
    enabled: linkedPerson?.relationshipStatus !== "friend",
    query: queryLibraryCore,
    search: searchQuery,
    sourceVersion,
  });
  const confirmedLinkedPerson =
    linkedPerson?.relationshipStatus === "friend" ? linkedPerson : null;

  const suggestionIds = useMemo(
    () => new Set(suggestions.map((suggestion) => suggestion.personId)),
    [suggestions],
  );
  const filteredPersons = personPicker.rows.filter(
    (person) => person.relationshipStatus === "friend",
  );

  return (
    <div className="flex h-full flex-col bg-[color:var(--theme-bg-deep)]">
          <button
            type="button"
            onClick={() => linkedPerson ? onOpenPerson(linkedPerson.id) : onBack()}
            className="theme-dialog-divider group flex w-full shrink-0 items-center gap-3 border-b px-4 py-4 text-left transition-colors duration-200 hover:bg-[color:var(--theme-bg-card-hover)] active:bg-[color:var(--theme-accent-glow)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--theme-accent-primary)] motion-reduce:transition-none"
            aria-label={linkedPerson ? `Back to ${personName(linkedPerson)}` : "Back to all identities"}
            title={linkedPerson ? `Back to ${personName(linkedPerson)}` : "Back to all identities"}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-5 w-5 shrink-0 text-[color:var(--theme-accent-primary)] transition-transform duration-200 group-hover:-translate-x-0.5 group-active:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
              aria-hidden
            >
              <path
                d="M12.5 4.5L7 10l5.5 5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[color:var(--theme-text-primary)]">
              {linkedPerson ? `Back to ${personName(linkedPerson)}` : "All identities"}
            </span>
            <span className="mt-1 block text-xs text-[color:var(--theme-text-muted)]">
              {linkedPerson ? "View identity and linked profiles" : "Return to Friends overview"}
            </span>
          </span>
          </button>
        {!confirmedLinkedPerson && !readOnly ? (
          <div className="theme-dialog-divider flex flex-wrap gap-2 border-b px-4 py-3">
            <button
              type="button"
              onClick={onPromoteToFriend}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Promote to friend
            </button>
            <button
              type="button"
              onClick={onPromoteToFam}
              className="btn-primary rounded-lg px-3 py-1.5 text-xs"
            >
              Promote to Fam
            </button>
          </div>
        ) : null}

      <div className="theme-dialog-divider border-b px-4 py-4">
        <div className="flex items-start gap-3">
          <ChannelAvatar
            name={accountTitle(account)}
            avatarUrl={account.avatarUrl}
            size={56}
            className="text-xl"
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
              <button type="button" onClick={() => onOpenPerson(linkedPerson.id)}
                className="mt-2 rounded text-xs text-[color:var(--theme-accent-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
                Identity: {personName(linkedPerson)}
              </button>
            ) : (
              <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
                This account is still unlinked.
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--theme-text-muted)]">
          <span>
            First seen{" "}
            {formatDistanceToNow(account.firstSeenAt, { addSuffix: true })}
          </span>
          <span>
            Last seen{" "}
            {formatDistanceToNow(account.lastSeenAt, { addSuffix: true })}
          </span>
        </div>
      </div>

      {!confirmedLinkedPerson && !readOnly ? (
        <>
          {friendSuggestion ? (
            <div
              className="theme-dialog-divider border-b px-4 py-4"
              data-testid="friend-candidate-detail"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">
                    Suggested friend
                  </p>
                  <p className="mt-1 text-sm font-medium text-[color:var(--theme-text-primary)]">
                    Score {friendSuggestion.score.toLocaleString()},{" "}
                    {friendSuggestion.confidence} confidence
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {onDismissFriendSuggestion ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDismissFriendSuggestion(friendSuggestion.id)
                      }
                      className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
                    >
                      Dismiss
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onPromoteToFriend}
                    className="btn-primary rounded-lg px-3 py-1.5 text-xs"
                  >
                    Promote to friend
                  </button>
                  <button
                    type="button"
                    onClick={onPromoteToFam}
                    className="btn-primary rounded-lg px-3 py-1.5 text-xs"
                  >
                    Promote to Fam
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {friendSuggestion.reasons.map((reason) => (
                  <span
                    key={reason.code}
                    className="theme-chip rounded-full px-2 py-0.5 text-[11px]"
                  >
                    {reason.label}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[color:var(--theme-text-muted)]">
                {signalCountLabel(friendSuggestion)}
              </p>
              {friendSuggestion.sampleItemIds.length > 0 ? (
                <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
                  Evidence{" "}
                  {friendSuggestion.sampleItemIds
                    .map(evidenceIdLabel)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

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
                  return (
                    <button
                      key={`${suggestion.accountId}:${suggestion.personId}`}
                      type="button"
                      onClick={() => onLinkToPerson(suggestion.personId)}
                      className="theme-card-soft w-full rounded-2xl px-3 py-3 text-left transition-colors hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-bg-card-hover)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
                            {suggestion.personName}
                          </p>
                          <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                            {suggestion.reason}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            suggestion.confidence === "high"
                              ? "bg-[color:rgb(var(--theme-feedback-success-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-success-rgb))]"
                              : "bg-[color:rgb(var(--theme-feedback-warning-rgb)/0.18)] text-[color:rgb(var(--theme-feedback-warning-rgb))]"
                          }`}
                        >
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
              {personPicker.loading ? (
                <div className="theme-panel-muted rounded-xl px-4 py-4 text-center">
                  <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
                    Loading friends...
                  </p>
                </div>
              ) : filteredPersons.length === 0 ? (
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
                        {personName(person)}
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
        {timelineLoading ? (
          <div className="theme-panel-muted mt-3 rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
              Loading recent activity...
            </p>
          </div>
        ) : feedItems.length === 0 ? (
          <div className="theme-panel-muted mt-3 rounded-xl px-4 py-6 text-center">
            <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
              No captured posts for this account yet
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {feedItems.slice(0, 8).map((item) => (
              <RecentActivityCard key={item.globalId} item={item} />
            ))}
          </div>
        )}
      </div>
      {linkedPerson ? <MiniFriendMapCard friend={linkedPerson} feedItems={locationItems.length ? locationItems : feedItems} onOpenMap={() => onOpenMap(linkedPerson.id)} /> : null}
    </div>
  );
}
import { RecentActivityCard } from "./RecentActivityCard.js";
