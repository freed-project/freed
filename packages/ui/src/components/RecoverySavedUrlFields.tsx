import { useState } from "react";
import type { RecoverySavedUrlDraft, RecoverySavedUrlEdit } from "@freed/shared/library-core";

/** One saved URL at a time; all targets require review before explicit submission. */
export function RecoverySavedUrlFields({ drafts, onChange, onSubmit, saving, locked, error }: {
  drafts: readonly RecoverySavedUrlDraft[];
  onChange: (drafts: readonly RecoverySavedUrlDraft[]) => void;
  onSubmit: (edits: readonly RecoverySavedUrlEdit[]) => Promise<void>;
  saving: boolean; locked: boolean; error: string | null;
}) {
  const [page, setPage] = useState(0), [seen, setSeen] = useState(1), [confirmed, setConfirmed] = useState(false);
  const row = drafts[page];
  if (!row) return <p role="alert">The complete saved URL transaction is unavailable.</p>;
  const change = (key: "title" | "description", value: string) => {
    setConfirmed(false);
    onChange(drafts.map((draft, index) => index === page ? { ...draft, [key]: value } : draft));
  };
  return <div className="mt-3 space-y-3">
    {error && <p role="alert">{error}</p>}
    <p>Saved URL {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()}</p>
    <p className="break-all">{row.url}</p>
    <p>Last synced: {row.currentState === "absent" ? "Item is absent." : row.currentText || "No text available locally."}</p>
    {(["title", "description"] as const).map(key => <label key={key} className="block space-y-1">
      <span>{key === "title" ? "Title" : "Description"}</span>
      <textarea aria-label={key === "title" ? "Title" : "Description"} className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2"
        maxLength={8192} disabled={saving || locked} value={row[key]} onChange={event => change(key, event.target.value)} />
    </label>)}
    <p>The archived content is retained. Applying it again may replace newer source content. Existing read, saved, archived and liked state is retained. Notes and tags are separate archived edits.</p>
    <p>Opening this editor makes no requests. After acceptance, the Primary may fetch this URL under its existing content policy. Leave the edit archived to avoid that contact.</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={saving || locked || seen < drafts.length} onChange={event => setConfirmed(event.target.checked)} />
      <span>Apply every reviewed saved URL again, including the possible publisher requests.</span></label>
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => setPage(page - 1)}>Previous URL</button>}
      {page + 1 < drafts.length && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, page + 2)); }}>Next URL</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !confirmed || seen < drafts.length}
        onClick={() => void onSubmit(drafts.map(({ entityId, title, description }) => ({ entityId, title, description })))}>{saving ? "Storing replacement..." : locked ? "Retry same replacement" : "Store revised saved URLs"}</button>
    </div>
  </div>;
}
