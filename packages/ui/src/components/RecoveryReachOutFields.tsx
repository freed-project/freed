import { useEffect, useState } from "react";
import { PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA, type PersonReachOutAppendPayloadV1, type LibraryCorePersonReachOutV1 } from "@freed/shared/library-core";

export interface RecoveryReachOutDraft {
  readonly personId: string;
  readonly originalOperationId: string;
  readonly archived: PersonReachOutAppendPayloadV1;
  readonly event: PersonReachOutAppendPayloadV1;
}
export interface RecoveryReachOutHistory { readonly name: string; readonly events: readonly LibraryCorePersonReachOutV1[] }
const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";
const dateLabel = (value: number) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : `Timestamp ${value.toLocaleString()}`;
const dateInput = (value: number) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(value - date.getTimezoneOffset() * 60000);
  return Number.isFinite(local.getTime()) ? local.toISOString().slice(0, -1) : "";
};

/** Keep only the visible Person's recent history; platforms own source verification. */
export function RecoveryReachOutFields({ drafts, onChange, readHistory, onSubmit, saving, locked, error }: {
  drafts: readonly RecoveryReachOutDraft[]; onChange: (drafts: readonly RecoveryReachOutDraft[]) => void;
  readHistory: (personId: string, signal: AbortSignal) => Promise<RecoveryReachOutHistory>;
  onSubmit: (drafts: readonly RecoveryReachOutDraft[]) => Promise<void>;
  saving: boolean; locked: boolean; error: string | null;
}) {
  const [page, setPage] = useState(0), [seen, setSeen] = useState(0), [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<RecoveryReachOutHistory | null>(null), [readError, setReadError] = useState(false), [invalid, setInvalid] = useState(false);
  const row = drafts[page], disabled = saving || locked;
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setReadError(false); setConfirmed(false);
    if (row) void readHistory(row.personId, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setHistory(value); setSeen(count => Math.max(count, page + 1));
    }).catch(() => { if (!controller.signal.aborted) setReadError(true); });
    return () => controller.abort();
  }, [page, row?.personId, readHistory]);
  const duplicate = history?.events.some(event => event.reachOutId === row?.originalOperationId) ?? false;
  const change = (event: PersonReachOutAppendPayloadV1) => {
    setConfirmed(false);
    if (!PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA.validate(event).ok) { setInvalid(true); return; }
    setInvalid(false);
    onChange(drafts.map((draft, i) => i === page ? { ...draft, event } : draft));
  };
  return <div data-testid="recovery-reach-out-editor" className="mt-3 space-y-3 text-xs">
    <p>Review every historical reach-out before adding it again. The original outcome may be unknown. A new entry can duplicate an event already accepted or queued elsewhere.</p>
    <p>History contains only the latest 20 events. An absent event does not prove the original failed. Older entries may fall outside retained history after acceptance. This records history; it does not contact anyone.</p>
    {row && <>
      <p>Event {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()} for {history?.name || `Person ...${row.personId.slice(-8)}`}</p>
      <p className="whitespace-pre-wrap break-words">Archived: {dateLabel(row.archived.logged_at_ms)}; {row.archived.channel || "No channel"}; {row.archived.notes ?? "No notes"}</p>
      <label className="block">Event time (local)
        <input aria-label="Event time (local)" type="datetime-local" step="0.001" className="mt-1 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2" disabled={disabled} value={dateInput(row.event.logged_at_ms)} onChange={e => change({ ...row.event, logged_at_ms: e.target.value ? new Date(e.target.value).getTime() : NaN })} />
      </label>
      <label className="block">Channel
        <select aria-label="Channel" className="mt-1 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2" disabled={disabled} value={row.event.channel ?? ""} onChange={e => change({ ...row.event, channel: (e.target.value || null) as PersonReachOutAppendPayloadV1["channel"] })}>
          <option value="">Not specified</option><option value="phone">Phone</option><option value="text">Text</option><option value="email">Email</option><option value="in_person">In person</option><option value="other">Other</option>
        </select>
      </label>
      <label className="block">Notes<textarea aria-label="Notes" className="mt-1 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2" rows={3} maxLength={65536} disabled={disabled} value={row.event.notes ?? ""} onChange={e => change({ ...row.event, notes: e.target.value || null })} /></label>
      <button type="button" className={button} disabled={disabled} onClick={() => change(row.archived)}>Use archived event</button>
    </>}
    {invalid && <p role="alert">The event is invalid or too large. Revise it or use the archived event.</p>}
    {readError ? <p role="alert">Recent history could not be verified. Start again to review the current Library.</p> : !history ? <p role="status">Loading recent history...</p> : <details open><summary>Last-synced recent history</summary>
      {history.events.length ? <ul className="space-y-2">{history.events.map(event => <li key={event.reachOutId} className="whitespace-pre-wrap break-words">{dateLabel(event.loggedAt)}; {event.channel || "No channel"}; {event.notes ?? "No notes"}</li>)}</ul> : <p>No retained events.</p>}
    </details>}
    {duplicate && <p role="alert">The original event is already in this history. This transaction cannot be added again.</p>}
    <label className="flex items-start gap-2"><input type="checkbox" disabled={disabled || !history || duplicate || invalid} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed every event and recent history, and want to add these entries despite the possible duplicate history.</label>
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className={button} disabled={disabled || invalid} onClick={() => setPage(page - 1)}>Previous event</button>}
      {page + 1 < drafts.length && <button type="button" className={button} disabled={disabled || invalid || !history || duplicate} onClick={() => setPage(page + 1)}>Next event</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !locked && (!confirmed || invalid || duplicate || !history || seen < drafts.length || !drafts.length)} onClick={() => void onSubmit(drafts)}>{saving ? "Storing replacement..." : locked ? "Retry same reach-out edit" : "Store revised history"}</button>
    </div>
  </div>;
}
