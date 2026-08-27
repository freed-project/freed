import { useState } from "react";
import type { GoogleContact, IdentitySuggestion } from "@freed/shared";
import type {
  LibraryCoreDeviceContactStatusResponseV1,
  LibraryCoreDeviceContactSuggestionPageResponseV1,
  LibraryCoreDeviceContactSuggestionReviewRowV1,
  LibraryCoreDeviceContactUnmatchedPageResponseV1,
} from "@freed/shared/library-core";

interface ContactSyncModalProps {
  onClose: () => void;
  syncState: LibraryCoreDeviceContactStatusResponseV1;
  suggestionPage: LibraryCoreDeviceContactSuggestionPageResponseV1;
  unmatchedPage: LibraryCoreDeviceContactUnmatchedPageResponseV1;
  onLinkSuggestion: (
    row: LibraryCoreDeviceContactSuggestionReviewRowV1,
  ) => Promise<void>;
  onSkipSuggestion: (suggestionId: string) => Promise<void>;
  onCreateFriend: (contact: GoogleContact) => Promise<void>;
  onNextSuggestionPage: () => Promise<LibraryCoreDeviceContactSuggestionPageResponseV1>;
  onNextUnmatchedPage: () => Promise<LibraryCoreDeviceContactUnmatchedPageResponseV1>;
  onResetSuggestionPage: () => Promise<LibraryCoreDeviceContactSuggestionPageResponseV1>;
  onResetUnmatchedPage: () => Promise<LibraryCoreDeviceContactUnmatchedPageResponseV1>;
}

function ContactAvatar({ contact }: { contact: GoogleContact }) {
  const photo = contact.photos.find((entry) => entry.default) ?? contact.photos[0];
  const initials = (
    (contact.name.givenName?.[0] ?? "") +
    (contact.name.familyName?.[0] ?? "")
  ).toUpperCase() || (contact.name.displayName?.[0] ?? "?").toUpperCase();

  if (photo?.url) {
    return (
      <img
        src={photo.url}
        alt={contact.name.displayName ?? ""}
        className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.18)] ring-1 ring-[color:var(--theme-border-strong)]">
      <span className="text-xs font-semibold text-[color:var(--theme-text-primary)]">{initials}</span>
    </div>
  );
}

function SuggestionRow({
  contact,
  suggestion,
  onLink,
  onSkip,
}: {
  contact: GoogleContact;
  suggestion: IdentitySuggestion;
  onLink: () => Promise<void>;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]">
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
          {contact.name.displayName ?? "Unknown"}
        </p>
        <p className="truncate text-xs text-[color:var(--theme-text-muted)]">
          {suggestion.reason ?? "Possible identity match"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="theme-chip-active rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onLink().finally(() => setBusy(false));
          }}
        >
          {busy ? "Linking..." : "Confirm"}
        </button>
        <button
          className="rounded-lg px-2.5 py-1 text-xs text-[color:var(--theme-text-muted)] hover:bg-[color:var(--theme-bg-card)]"
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function UnmatchedRow({
  contact,
  onCreateFriend,
}: {
  contact: GoogleContact;
  onCreateFriend: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]">
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[color:var(--theme-text-primary)]">
          {contact.name.displayName ?? "Unknown"}
        </p>
        {contact.emails[0] ? (
          <p className="truncate text-xs text-[color:var(--theme-text-muted)]">
            {contact.emails[0].value}
          </p>
        ) : null}
      </div>
      <button
        className="btn-secondary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onCreateFriend().finally(() => setBusy(false));
        }}
      >
        {busy ? "Adding..." : "Add friend"}
      </button>
    </div>
  );
}

export function ContactSyncModal({
  onClose,
  syncState,
  suggestionPage,
  unmatchedPage,
  onLinkSuggestion,
  onSkipSuggestion,
  onCreateFriend,
  onNextSuggestionPage,
  onNextUnmatchedPage,
  onResetSuggestionPage,
  onResetUnmatchedPage,
}: ContactSyncModalProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
      <div className="theme-dialog-shell flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-bg-surface)] shadow-[var(--theme-glow-lg)]">
        <div className="theme-dialog-divider flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--theme-text-primary)]">Google Contacts</h2>
            <p className="mt-1 text-sm text-[color:var(--theme-text-muted)]">
              Review identity suggestions and add unmatched contacts as friends.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-5 py-5 md:grid-cols-2">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--theme-text-muted)]">
              Suggestions ({syncState.pendingSuggestionCount.toLocaleString()})
            </p>
            <div className="space-y-2">
              {suggestionPage.rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[color:var(--theme-border-subtle)] px-3 py-4 text-sm text-[color:var(--theme-text-muted)]">
                  No pending identity suggestions.
                </p>
              ) : suggestionPage.rows.map((row) => (
                  <SuggestionRow
                    key={row.suggestion.id}
                    contact={row.contact}
                    suggestion={row.suggestion}
                    onLink={() => onLinkSuggestion(row)}
                    onSkip={() => void onSkipSuggestion(row.suggestion.id)}
                  />
                ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                disabled={suggestionPage.rows.length === 0}
                onClick={() => void onResetSuggestionPage()}
              >
                First page
              </button>
              <button
                type="button"
                className="btn-secondary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                disabled={suggestionPage.nextCursor === null}
                onClick={() => void onNextSuggestionPage()}
              >
                Next
              </button>
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--theme-text-muted)]">
              Imported contacts ({syncState.activeContactCount.toLocaleString()})
            </p>
            <div className="space-y-2">
              {unmatchedPage.rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[color:var(--theme-border-subtle)] px-3 py-4 text-sm text-[color:var(--theme-text-muted)]">
                  Everything imported is either linked already or waiting for review.
                </p>
              ) : unmatchedPage.rows.map((contact) => (
                <UnmatchedRow
                  key={contact.resourceName}
                  contact={contact}
                  onCreateFriend={() => onCreateFriend(contact)}
                />
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                disabled={unmatchedPage.rows.length === 0}
                onClick={() => void onResetUnmatchedPage()}
              >
                First page
              </button>
              <button
                type="button"
                className="btn-secondary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                disabled={unmatchedPage.nextCursor === null}
                onClick={() => void onNextUnmatchedPage()}
              >
                Next
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
