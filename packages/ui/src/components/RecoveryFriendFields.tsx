import { useEffect, useRef, useState } from "react";
import type { Account, Person } from "@freed/shared";
import { FRIEND_REPLACE_PAYLOAD_SCHEMA, compareLibraryCoreUtf8V1 } from "@freed/shared/library-core";
import { RecoveryPersonFields } from "./RecoveryPersonFields";

import type { RecoveryFriendDraft } from "@freed/shared/library-core";
export type { RecoveryFriendDraft } from "@freed/shared/library-core";

const buttonClass = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";
const detailFields = [["provider", "Provider"], ["externalId", "Provider identity"], ["handle", "Handle"],
  ["displayName", "Name"], ["avatarUrl", "Avatar URL"], ["profileUrl", "Profile URL"], ["email", "Email"],
  ["phone", "Phone"], ["address", "Address"], ["discoveredFrom", "Discovery source"],
  ["followRosterActive", "Active in follow roster"], ["followRosterRoles", "Follow roles"]] as const;
const display = (value: unknown): string => value === undefined || value === null ? "Not set" :
  typeof value === "boolean" ? value ? "Yes" : "No" : Array.isArray(value) ? value.join(", ") : String(value);

/** Review one account at a time and sign only the complete explicit selection. */
export function RecoveryFriendFields({ draft, onChange, onSubmit, saving, locked, error }: {
  draft: RecoveryFriendDraft; onChange: (draft: RecoveryFriendDraft) => void;
  onSubmit: (person: Person, accounts: readonly Account[]) => Promise<void>;
  saving: boolean; locked: boolean; error: string | null;
}) {
  const [step, setStep] = useState<"person" | "accounts">("person");
  const [page, setPage] = useState(0), [visited, setVisited] = useState(draft.paged ? 0 : 1);
  const [confirmed, setConfirmed] = useState(false), [invalid, setInvalid] = useState(false);
  const [section, setSection] = useState<"linked" | "archived" | "selected">("linked");
  const [linkedPage, setLinkedPage] = useState(draft.paged?.first);
  const [linkedComplete, setLinkedComplete] = useState(!draft.paged);
  const [selection, setSelection] = useState(new Map<string, RecoveryFriendDraft["accounts"][number]>());
  const [loading, setLoading] = useState(false), [pageError, setPageError] = useState<string | null>(null);
  const loadGeneration = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadGeneration.current += 1; }; }, []);
  const disabled = saving || locked || loading;
  const visible = !draft.paged ? draft.accounts : section === "linked" ? linkedPage?.accounts ?? [] : section === "archived" ? draft.accounts : [...selection.values()];
  const baseRow = visible[page];
  const row = baseRow && draft.paged ? { ...(selection.get(baseRow.id) ?? baseRow), selected: selection.has(baseRow.id) } : baseRow;
  const accounts = draft.paged ? [...selection.values()].map(value => value.account) : draft.accounts.filter(value => value.selected).map(value => value.account);
  const selected = accounts.sort((a, b) => compareLibraryCoreUtf8V1(a.id, b.id));
  const reviewed = draft.paged ? linkedComplete && visited >= draft.accounts.length : visited >= draft.accounts.length;
  const loadPage = async (cursor: string | null) => {
    if (!draft.paged || loading || saving || locked) return;
    const generation = ++loadGeneration.current;
    setLoading(true); setPageError(null); setConfirmed(false);
    try {
      const next = await draft.paged.load(cursor);
      if (!alive.current || generation !== loadGeneration.current) return;
      setLinkedPage(next); setSection("linked"); setPage(0);
      if (next.accounts.length <= 1 && next.nextCursor === null) setLinkedComplete(true);
    } catch {
      if (alive.current && generation === loadGeneration.current) setPageError("The Library changed or this page could not be read. Start again to review the complete account set.");
    } finally { if (alive.current && generation === loadGeneration.current) setLoading(false); }
  };
  const change = (patch: Partial<RecoveryFriendDraft["accounts"][number]>) => {
    if (!row) return;
    setConfirmed(false); setInvalid(false);
    if (draft.paged) {
      const updated = { ...row, ...patch };
      if (updated.selected && !selection.has(updated.id) && selection.size >= 64) { setInvalid(true); return; }
      const next = new Map(selection);
      if (updated.selected) next.set(updated.id, updated); else next.delete(updated.id);
      setSelection(next);
      if (section === "selected") setPage(0);
      else if (section === "linked" && linkedPage) setLinkedPage({ ...linkedPage, accounts: linkedPage.accounts.map(value => value.id === updated.id ? updated : value) });
      else onChange({ ...draft, accounts: draft.accounts.map(value => value.id === updated.id ? updated : value) });
    } else onChange({ ...draft, accounts: draft.accounts.map((value, index) => index === page ? { ...value, ...patch } : value) });
  };
  const nextAccount = () => {
    const next = page + 1;
    setPage(next);
    if (!draft.paged || section === "archived") setVisited(Math.max(visited, next + 1));
    if (draft.paged && section === "linked" && next === visible.length - 1 && linkedPage?.nextCursor === null) setLinkedComplete(true);
  };
  if (step === "person") return <RecoveryPersonFields mode="friend"
    drafts={[{ archived: draft.archivedPerson, current: draft.currentPerson, person: draft.person }]}
    onChange={rows => { onChange({ ...draft, person: rows[0]!.person }); setConfirmed(false); }}
    onSubmit={async () => setStep("accounts")} saving={saving || loading} locked={locked} error={error} />;
  const submit = async () => {
    if (!confirmed || !reviewed || saving || loading || pageError) return;
    if (!FRIEND_REPLACE_PAYLOAD_SCHEMA.validate({ accounts: selected, person: draft.person }).ok) { setInvalid(true); return; }
    await onSubmit(draft.person, selected);
  };
  return <div className="mt-3 space-y-3" data-testid="recovery-friend-editor">
    <p>{draft.paged ? "This Friend has more than 64 current links. Nothing starts selected because a replacement can contain at most 64 accounts. Review every current-link page and archived account, then choose the complete set to keep. Only selected account changes are retained between pages." : "Choose the complete account set for this Friend. Current links start selected. Archived accounts remain available for explicit selection."}</p>
    {draft.paged && <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => void loadPage(null)}>Review current links from start</button>
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setSection("archived"); setPage(0); setVisited(Math.max(visited, Math.min(1, draft.accounts.length))); }}>Review archived accounts</button>
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setSection("selected"); setPage(0); }}>Review selected accounts</button>
      <p>{linkedComplete ? "All current links reviewed." : "Current-link review is incomplete."} {visited >= draft.accounts.length ? "All archived accounts reviewed." : "Archived-account review is incomplete."}</p>
    </div>}
    {loading && <p role="status">Loading account page</p>}
    <p>At Primary acceptance, omitted social accounts are detached and an omitted contact account is deleted. This also affects links added after this review. Selected accounts replace their full details and may move from another person. Newer or queued changes may be overwritten. The original edit's outcome may remain unknown.</p>
    <p>Up to 64 accounts and one contact account can be selected. No profile images load here. Choosing an archived avatar URL can cause other views to load it after acceptance.</p>
    {(error || pageError || invalid) && <p role="alert" className="theme-feedback-text-danger">{error || pageError || "The complete selection is invalid or too large. Select no more than 64 accounts and one contact account."}</p>}
    <p>Selected accounts: {selected.length.toLocaleString()}</p>
    {row ? <>
      <p>Account {(page + 1).toLocaleString()} of {visible.length.toLocaleString()}{draft.paged ? ` on this ${section} page` : ""} (...{row.id.slice(-8)})</p>
      {!row.current && <p>This account is currently absent. It may have been deleted. This action cannot restore deleted accounts; selecting one will refuse the entire replacement.</p>}
      {row.current?.personId && !row.currentlyLinked && <p>This account is linked to another person (...{row.current.personId.slice(-8)}). Selecting it moves that link.</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={row.selected} disabled={disabled} onChange={event => change({ selected: event.target.checked })} /><span>Include this account</span></label>
      {detailFields.map(([key, label]) => <div key={key} className="whitespace-pre-wrap break-words"><p>{label}</p>
        <p>Archived: {key === "externalId" && row.archived ? `...${row.archived.externalId.slice(-8)}` : display(row.archived?.[key])}</p><p>Last synced: {key === "externalId" && row.current ? `...${row.current.externalId.slice(-8)}` : display(row.current?.[key])}</p><p>Selected details: {key === "externalId" ? `...${row.account.externalId.slice(-8)}` : display(row.account[key])}</p>
      </div>)}
      <div className="flex flex-wrap gap-2">
        {row.archived && <button type="button" className={buttonClass} disabled={disabled} onClick={() => change({ account: { ...row.archived!, personId: draft.person.id } })}>Use archived details, including avatar URL</button>}
        {row.current && <button type="button" className={buttonClass} disabled={disabled} onClick={() => change({ account: { ...row.current!, personId: draft.person.id } })}>Use current details</button>}
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => { const account = { ...row.account }; delete account.avatarUrl; change({ account }); }}>Clear avatar URL</button>
      </div>
    </> : <p>{draft.paged ? "This review section has no accounts." : "No current or archived accounts are linked. The replacement will have an empty account set."}</p>}
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className={buttonClass} disabled={disabled} onClick={() => setPage(page - 1)}>Previous account</button>}
      {page + 1 < visible.length && <button type="button" className={buttonClass} disabled={disabled} onClick={nextAccount}>Next account</button>}
      {draft.paged && section === "linked" && page === visible.length - 1 && linkedPage?.nextCursor && <button type="button" className={buttonClass} disabled={disabled} onClick={() => void loadPage(linkedPage.nextCursor)}>Next linked-account page</button>}
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setStep("person"); setConfirmed(false); }}>Review Person again</button>
    </div>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} /><span>Apply this complete Friend replacement, including account moves, omissions and avatar URL changes.</span></label>
    <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || loading || !confirmed || !reviewed || Boolean(pageError)} onClick={() => void submit()}>Store revised Friend</button>
  </div>;
}
