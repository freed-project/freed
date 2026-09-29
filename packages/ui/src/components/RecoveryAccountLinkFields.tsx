import { useState } from "react";
import type { LibraryCoreNormalizedQueryExecutor } from "@freed/shared/library-core";
import { useLibraryPersonPicker } from "../hooks/useLibraryPersonPicker.js";

export interface RecoveryAccountLinkDraft {
  readonly accountId: string;
  readonly label: string;
  readonly current: { readonly id: string | null; readonly label: string; readonly present: boolean };
  readonly archived: { readonly id: string | null; readonly label: string; readonly present: boolean };
}

/** Render one fixed account target and one bounded person-search window. */
export function RecoveryAccountLinkFields({ drafts, query, sourceVersion, saving, locked, onSubmit }: {
  drafts: readonly RecoveryAccountLinkDraft[];
  query: LibraryCoreNormalizedQueryExecutor;
  sourceVersion: number;
  saving: boolean;
  locked: boolean;
  onSubmit: (assignments: readonly { accountId: string; personId: string | null }[]) => void;
}) {
  const [page, setPage] = useState(0), [seen, setSeen] = useState(1);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState(() => drafts.map(draft => draft.archived));
  const picker = useLibraryPersonPicker({ enabled: !locked && !saving, query, search, sourceVersion });
  const draft = drafts[page], value = selected[page];
  if (!draft || !value) return null;
  const choose = (next: typeof value) => { setSelected(selected.map((entry, index) => index === page ? next : entry)); setConfirmed(false); };
  const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";
  return <div className="space-y-3" data-testid="recovery-account-link-fields">
    <p>This creates fresh account links. They may replace changes made before Primary acceptance. An unknown original outcome does not mean the edit failed.</p>
    <p>Account {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()}: {draft.label} (...{draft.accountId.slice(-8)})</p>
    <p>Current link: {draft.current.label}{draft.current.id && ` (...${draft.current.id.slice(-8)})`}. Archived link: {draft.archived.label}{draft.archived.id && ` (...${draft.archived.id.slice(-8)})`}.</p>
    <p>Selected link: {value.label}{value.id && ` (...${value.id.slice(-8)})`}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={saving || locked || !draft.archived.present} onClick={() => choose(draft.archived)}>Use archived link</button>
      <button type="button" className={button} disabled={saving || locked || !draft.current.present} onClick={() => choose(draft.current)}>Keep current link</button>
      <button type="button" className={button} disabled={saving || locked} onClick={() => choose({ id: null, label: "Unlinked", present: true })}>Unlink account</button>
    </div>
    <label className="block">Search people<input className="mt-1 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-transparent px-3 py-2" value={search} disabled={saving || locked} onChange={event => setSearch(event.target.value)} /></label>
    {picker.loading ? <p role="status">Searching people...</p> : <ul className="space-y-1">{picker.rows.map(person => <li key={person.id}><button type="button" className={button} disabled={saving || locked} onClick={() => choose({ id: person.id, label: person.name.slice(0, 240), present: true })}>Select {person.name} (...{person.id.slice(-8)})</button></li>)}</ul>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={saving || locked} onChange={event => setConfirmed(event.target.checked)} /><span>Apply all reviewed account links, including changes before Primary acceptance.</span></label>
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className={button} disabled={saving} onClick={() => { setPage(page - 1); setSearch(""); }}>Previous account</button>}
      {page + 1 < drafts.length && <button type="button" className={button} disabled={saving} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, page + 2)); setSearch(""); }}>Next account</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !confirmed || seen < drafts.length || selected.some(entry => !entry.present)} onClick={() => onSubmit(drafts.map((entry, index) => ({ accountId: entry.accountId, personId: selected[index]!.id })))}>{saving ? "Storing replacement..." : "Store account links"}</button>
    </div>
  </div>;
}
