import { useMemo, useState } from "react";
import type { ContactSyncState, GoogleContact, IdentitySuggestion } from "@freed/shared";
import { useAppStore } from "../../context/PlatformContext.js";

interface ContactSyncModalProps {
  onClose: () => void;
  syncState: ContactSyncState;
  onLinkSuggestion: (suggestion: IdentitySuggestion) => Promise<void>;
  onSkipSuggestion: (suggestionId: string) => void;
  onCreateFriend: (contact: GoogleContact) => Promise<void>;
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
  onLinkSuggestion,
  onSkipSuggestion,
  onCreateFriend,
}: ContactSyncModalProps) {
  const accounts = useAppStore((state) => state.accounts);

  const contactAccounts = useMemo(
    () => Object.values(accounts).filter((account) => account.kind === "contact" && account.provider === "google_contacts"),
    [accounts]
  );

  const linkedContactIds = new Set(contactAccounts.map((account) => account.externalId));
  const suggestedContactIds = new Set(
    syncState.pendingSuggestions.map((suggestion) =>
      suggestion.id.split(":").slice(1, 2)[0] ?? ""
    )
  );

  const contactByResourceName = new Map(
    syncState.cachedContacts.map((contact) => [contact.resourceName, contact])
  );

  const suggestions = syncState.pendingSuggestions.filter((suggestion) =>
    contactByResourceName.has(suggestion.id.split(":").slice(1, 2)[0] ?? "")
  );

  const unmatchedContacts = syncState.cachedContacts.filter((contact) =>
    !linkedContactIds.has(contact.resourceName) &&
    !suggestedContactIds.has(contact.resourceName)
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
      <div className="theme-dialog-shell w-full max-w-3xl overflow-hidden rounded-3xl border border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-bg-surface)] shadow-[var(--theme-glow-lg)]">
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

        <div className="grid gap-6 px-5 py-5 md:grid-cols-2">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--theme-text-muted)]">
              Suggestions ({suggestions.length.toLocaleString()})
            </p>
            <div className="space-y-2">
              {suggestions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[color:var(--theme-border-subtle)] px-3 py-4 text-sm text-[color:var(--theme-text-muted)]">
                  No pending identity suggestions.
                </p>
              ) : suggestions.map((suggestion) => {
                const resourceName = suggestion.id.split(":").slice(1, 2)[0] ?? "";
                const contact = contactByResourceName.get(resourceName);
                if (!contact) return null;
                return (
                  <SuggestionRow
                    key={suggestion.id}
                    contact={contact}
                    suggestion={suggestion}
                    onLink={() => onLinkSuggestion(suggestion)}
                    onSkip={() => onSkipSuggestion(suggestion.id)}
                  />
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--theme-text-muted)]">
              Unmatched contacts ({unmatchedContacts.length.toLocaleString()})
            </p>
            <div className="space-y-2">
              {unmatchedContacts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[color:var(--theme-border-subtle)] px-3 py-4 text-sm text-[color:var(--theme-text-muted)]">
                  Everything imported is either linked already or waiting for review.
                </p>
              ) : unmatchedContacts.map((contact) => (
                <UnmatchedRow
                  key={contact.resourceName}
                  contact={contact}
                  onCreateFriend={() => onCreateFriend(contact)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
