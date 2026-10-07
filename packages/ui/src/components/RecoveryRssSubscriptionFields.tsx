import { useState } from "react";
import type { RssFeed } from "@freed/shared";
import { RSS_FEED_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";

export interface RecoveryRssSubscriptionDraft {
  readonly archived: RssFeed;
  readonly current: RssFeed | null;
  readonly feed: RssFeed;
}
const textFields = [["title", "Name"], ["folder", "Folder"], ["siteUrl", "Website"], ["imageUrl", "Image URL"]] as const;
const booleanFields = [["enabled", "Enable polling"], ["trackUnread", "Track unread articles"]] as const;
const inputClass = "w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2";

/** Shared review and confirmation; platform adapters own verification and persistence. */
export function RecoveryRssSubscriptionFields({ drafts, onChange, onSubmit, saving, locked, error }: {
  drafts: readonly RecoveryRssSubscriptionDraft[];
  onChange: (drafts: readonly RecoveryRssSubscriptionDraft[]) => void;
  onSubmit: (feeds: readonly RssFeed[]) => Promise<void>;
  saving: boolean;
  locked: boolean;
  error: string | null;
}) {
  const [page, setPage] = useState(0), [seen, setSeen] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const row = drafts?.[page];
  const disabled = saving || locked;
  const update = (key: string, value: string | number | boolean | undefined) => {
    setConfirmed(false);
    onChange(drafts.map((draft, index) => {
      if (index !== page) return draft;
      const feed = { ...draft.feed, [key]: value };
      if (value === undefined) delete feed[key as keyof typeof feed];
      return { ...draft, feed };
    }));
  };
  const submit = async () => {
    if (!drafts || !confirmed || seen < drafts.length) return;
    if (drafts.some(({ feed }) => !RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate({ feed }).ok)) {
      setValidationError("Check the subscription values. Polling intervals must be whole, nonnegative minutes, or empty for the default."); return;
    }
    setValidationError(null);
    await onSubmit(drafts.map(({ feed }) => feed));
  };
  return <div className="mt-3 space-y-3" data-testid="recovery-rss-upsert-editor">
    <p>Review every subscription. Existing subscriptions start with last-synced settings. Copy only the archived values you want to apply again. The original outcome may still be unknown.</p>
    <p>This replaces the full subscription record and may override newer or queued changes before Primary acceptance. Enabling polling or shortening its interval can increase requests to the publisher. Nothing is fetched during review.</p>
    {(validationError || error) && <p role="alert" className="theme-feedback-text-danger">{validationError || error}</p>}
    {row && <>
      <p className="break-all">{row.feed.url}</p>
      {!row.current && <p>This subscription has not been created in the current Library. Polling starts disabled. Enabling it may contact this publisher after Primary acceptance.</p>}
      <p>Subscription {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()}</p>
      {textFields.map(([key, label]) => <label key={key} className="block space-y-1">
        <span className="block">{label}</span>
        <span className="block break-all">Archived: {row.archived[key] ?? "Not set"}</span>
        <span className="block break-all">Last synced: {row.current ? row.current[key] ?? "Not set" : "No subscription"}</span>
        <input aria-label={label} className={inputClass} value={row.feed[key] ?? ""} maxLength={4096} disabled={disabled}
          onChange={(event) => update(key, key !== "title" && event.target.value === "" ? undefined : event.target.value)} />
      </label>)}
      {booleanFields.map(([key, label]) => <label key={key} className="block space-y-1">
        <span className="block">Archived: {row.archived[key] ? "Yes" : "No"}. Last synced: {row.current ? row.current[key] ? "Yes" : "No" : "No subscription"}.</span>
        <span className="flex items-center gap-2"><input type="checkbox" aria-label={label} checked={row.feed[key]} disabled={disabled} onChange={(event) => update(key, event.target.checked)} />{label}</span>
      </label>)}
      <label className="block space-y-1">
        <span className="block">Polling interval in minutes</span>
        <span className="block">Archived: {row.archived.pollInterval?.toLocaleString() ?? "Default"}. Last synced: {row.current ? row.current.pollInterval?.toLocaleString() ?? "Default" : "No subscription"}.</span>
        <input aria-label="Polling interval in minutes" type="number" min={0} step={1} className={inputClass} disabled={disabled} value={row.feed.pollInterval ?? ""}
          onChange={(event) => update("pollInterval", event.target.value === "" ? undefined : Number(event.target.value))} />
      </label>
      <p>Existing fetch history is retained; new subscriptions have none. This does not fetch articles or restore deleted subscriptions.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled || seen < drafts.length} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Apply the reviewed settings to every subscription, including any polling changes.</span></label>
      <div className="flex flex-wrap gap-2">
        {page > 0 && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => setPage(page - 1)}>Previous subscription</button>}
        {page + 1 < drafts.length && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, page + 2)); }}>Next subscription</button>}
        <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !confirmed || seen < drafts.length} onClick={() => void submit()}>{saving ? "Storing replacement..." : "Store revised subscriptions"}</button>
      </div>
    </>}
  </div>;
}
