import { useState } from "react";
import type { Account } from "@freed/shared";
import { ACCOUNT_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";

export interface RecoveryAccountDraft {
  readonly archived: Account;
  readonly current: Account | null;
  readonly account: Account;
}
const fields = [["handle", "Handle"], ["displayName", "Name"], ["avatarUrl", "Avatar URL"],
  ["profileUrl", "Profile URL"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"]] as const;
const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";

/** Review complete Account roots one at a time; platforms own signing and commit. */
export function RecoveryAccountFields({ drafts, onChange, onSubmit, saving, locked, error }: {
  drafts: readonly RecoveryAccountDraft[]; onChange: (drafts: readonly RecoveryAccountDraft[]) => void;
  onSubmit: (accounts: readonly Account[]) => Promise<void>; saving: boolean; locked: boolean; error: string | null;
}) {
  const [page, setPage] = useState(0), [seen, setSeen] = useState(1);
  const [confirmed, setConfirmed] = useState(false), [invalid, setInvalid] = useState(false);
  const row = drafts[page], disabled = saving || locked;
  const change = (account: Account) => {
    setConfirmed(false);
    if (!ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate({ account }).ok) { setInvalid(true); return; }
    setInvalid(false);
    onChange(drafts.map((value, index) => index === page ? { ...value, account } : value));
  };
  const edit = (key: typeof fields[number][0], text: string) => {
    if (!row) return;
    const account = { ...row.account };
    if (text) account[key] = text; else delete account[key];
    change(account);
  };
  async function submit() {
    if (disabled || invalid || !confirmed || !drafts.length || seen < drafts.length) return;
    if (drafts.some(value => !ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate({ account: value.account }).ok)) { setInvalid(true); return; }
    await onSubmit(drafts.map(value => value.account));
  }
  return <div className="mt-3 space-y-3" data-testid="recovery-account-editor">
    <p>Review every original account. Existing accounts start with last-synced details. This replaces the complete record, including its person link, and may overwrite newer or queued changes before Primary acceptance.</p>
    <p>No profile images load here. Choosing an archived avatar URL can cause other views to load it after acceptance. The original edit's outcome may remain unknown.</p>
    {(error || invalid) && <p role="alert" className="theme-feedback-text-danger">{error || "The complete Account details are invalid or too large."}</p>}
    {row && <>
      <p>Account {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()} (...{row.account.id.slice(-8)})</p>
      {!row.current && <p>This account is currently absent and may have been deleted. Deleted accounts cannot be recreated by this action. Its avatar URL starts empty.</p>}
      <p>Provider: {row.account.provider}. Provider identity: ...{row.account.externalId.slice(-8)}. Kind: {row.account.kind}.</p>
      <p>Person link: {row.account.personId ? `...${row.account.personId.slice(-8)}` : "Unlinked"}. A selected person must still exist.</p>
      {fields.map(([key, label]) => <label key={key} className="block space-y-1">
        <span>{label}</span>
        <span className="block whitespace-pre-wrap break-words">Archived: {row.archived[key] ?? "Not set"}</span>
        <span className="block whitespace-pre-wrap break-words">Last synced: {row.current?.[key] ?? "Not set"}</span>
        <textarea aria-label={label} value={row.account[key] ?? ""} disabled={disabled} rows={2} maxLength={65536}
          className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2"
          onChange={event => edit(key, event.target.value)} />
      </label>)}
      <p>Discovery source: {row.account.discoveredFrom}. First seen: {row.account.firstSeenAt.toLocaleString()}. Last seen: {row.account.lastSeenAt.toLocaleString()}.</p>
      <p>Follow roster: {row.account.followRosterActive === undefined ? "Not set" : row.account.followRosterActive ? "Active" : "Inactive"}. Roles: {row.account.followRosterRoles?.join(", ") || "Not set"}.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={disabled} onClick={() => change({ ...row.archived })}>Use archived details, including link and avatar URL</button>
        {row.current && <button type="button" className={button} disabled={disabled} onClick={() => change({ ...row.current! })}>Use current details</button>}
        <button type="button" className={button} disabled={disabled} onClick={() => { const account = { ...row.account }; delete account.personId; change(account); }}>Unlink account</button>
        <button type="button" className={button} disabled={disabled} onClick={() => edit("avatarUrl", "")}>Clear avatar URL</button>
      </div>
    </>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} /><span>Apply these complete Account details and person links, including changes selected from the archive.</span></label>
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className={button} disabled={disabled} onClick={() => setPage(page - 1)}>Previous account</button>}
      {page + 1 < drafts.length && <button type="button" className={button} disabled={disabled} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, page + 2)); }}>Next account</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || invalid || !confirmed || seen < drafts.length || !drafts.length} onClick={() => void (locked ? onSubmit(drafts.map(value => value.account)) : submit())}>{saving ? "Storing replacement..." : locked ? "Retry same Account edit" : "Store revised accounts"}</button>
    </div>
  </div>;
}
