import { useState } from "react";
import type { Person } from "@freed/shared";
import { PERSON_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";

export interface RecoveryPersonDraft {
  readonly archived: Person;
  readonly current: Person | null;
  readonly person: Person;
}
const fields = [["name", "Name"], ["avatarUrl", "Avatar URL"], ["bio", "Bio"], ["notes", "Notes"]] as const;
const fieldClass = "w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2";
const buttonClass = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";

/** One Person and eight tags at a time; platform adapters own signing and linkage. */
export function RecoveryPersonFields({ drafts, onChange, onSubmit, saving, locked, error, mode = "person" }: {
  mode?: "person" | "friend";
  drafts: readonly RecoveryPersonDraft[]; onChange: (drafts: readonly RecoveryPersonDraft[]) => void;
  onSubmit: (persons: readonly Person[]) => Promise<void>; saving: boolean; locked: boolean; error: string | null;
}) {
  const [page, setPage] = useState(0), [tagPage, setTagPage] = useState(0);
  const [visited, setVisited] = useState<Record<number, number>>({ 0: 8 });
  const [confirmed, setConfirmed] = useState(false), [invalid, setInvalid] = useState(false);
  const row = drafts[page];
  const disabled = saving || locked;
  const tagCount = (draft: RecoveryPersonDraft) => Math.max(draft.archived.tags?.length ?? 0, draft.current?.tags?.length ?? 0, draft.person.tags?.length ?? 0);
  const reviewed = drafts.every((draft, index) => (visited[index] ?? -1) >= tagCount(draft));
  const update = (key: keyof Person, value: unknown) => {
    setConfirmed(false); setInvalid(false);
    onChange(drafts.map((draft, index) => {
      if (index !== page) return draft;
      const person = { ...draft.person, [key]: value };
      if (value === undefined) delete person[key];
      return { ...draft, person };
    }));
  };
  const replaceTags = (tags: string[]) => {
    update("tags", tags);
    setTagPage(0);
    setVisited(current => ({ ...current, [page]: 8 }));
  };
  const navigate = (next: number) => { setPage(next); setTagPage(0); setVisited(current => ({ ...current, [next]: Math.max(current[next] ?? 0, 8) })); };
  const submit = async () => {
    if (!confirmed || !reviewed || !drafts.length) return;
    if (drafts.some(({ person }) => !PERSON_UPSERT_PAYLOAD_SCHEMA.validate({ person }).ok)) { setInvalid(true); return; }
    setInvalid(false); await onSubmit(drafts.map(draft => draft.person));
  };
  return <div className="mt-3 space-y-3" data-testid="recovery-person-editor">
    <p>Review every person and tag. Existing people start with last-synced values. Copy only the archived values you want to apply again. The original outcome may still be unknown.</p>
    <p>{mode === "friend" ? "Review the Person first, then choose the complete account set. Nothing is stored until you confirm both steps." : "This replaces the full Person record and may override newer or queued changes before Primary acceptance. Linked accounts and reach-out history are not changed."} Avatar URLs are not loaded here; other views may load them after acceptance.</p>
    {(error || invalid) && <p role="alert" className="theme-feedback-text-danger">{error || "Check the Person values. Care level must be 1 to 5, and reach-out days must be a whole, nonnegative number or empty."}</p>}
    {row && <>
      <p>Person {(page + 1).toLocaleString()} of {drafts.length.toLocaleString()} (...{row.person.id.slice(-8)})</p>
      {!row.current && <p>This person is currently absent from the Library. This does not prove whether the original edit was accepted. Their avatar URL starts empty.</p>}
      {fields.map(([key, label]) => <label key={key} className="block space-y-1">
        <span>{label}</span><span className="block whitespace-pre-wrap break-words">Archived: {row.archived[key] ?? "Not set"}</span>
        <span className="block whitespace-pre-wrap break-words">Last synced: {row.current?.[key] ?? "Not set"}</span>
        <textarea aria-label={label} className={fieldClass} value={row.person[key] ?? ""} disabled={disabled} maxLength={key === "name" ? 16384 : 65536} rows={key === "notes" || key === "bio" ? 3 : 1}
          onChange={event => update(key, key !== "name" && event.target.value === "" ? undefined : event.target.value)} />
      </label>)}
      <label className="block">Relationship status
        <span className="block">Archived: {row.archived.relationshipStatus}. Last synced: {row.current?.relationshipStatus ?? "Not set"}.</span>
        <select aria-label="Relationship status" className={fieldClass} disabled={disabled} value={row.person.relationshipStatus} onChange={event => update("relationshipStatus", event.target.value)}><option value="friend">Friend</option><option value="connection">Connection</option></select>
      </label>
      {(["careLevel", "reachOutIntervalDays"] as const).map(key => <label key={key} className="block">{key === "careLevel" ? "Care level" : "Reach-out interval in days"}
        <span className="block">Archived: {row.archived[key]?.toLocaleString() ?? "Not set"}. Last synced: {row.current?.[key]?.toLocaleString() ?? "Not set"}.</span>
        <input aria-label={key === "careLevel" ? "Care level" : "Reach-out interval in days"} className={fieldClass} type="number" min={key === "careLevel" ? 1 : 0} max={key === "careLevel" ? 5 : undefined} step={1} disabled={disabled} value={row.person[key] ?? ""} onChange={event => update(key, event.target.value === "" ? undefined : Number(event.target.value))} />
      </label>)}
      <p>Tags: {(row.person.tags?.length ?? 0).toLocaleString()}</p>
      {Array.from({ length: Math.min(8, Math.max(0, tagCount(row) - tagPage * 8)) }, (_, offset) => {
        const index = tagPage * 8 + offset;
        return <div key={index} className="space-y-1"><p className="whitespace-pre-wrap break-words">Archived tag {(index + 1).toLocaleString()}: {row.archived.tags?.[index] ?? "Not set"}</p><p className="whitespace-pre-wrap break-words">Last synced: {row.current?.tags?.[index] ?? "Not set"}</p>
          {index < (row.person.tags?.length ?? 0) && <label className="block">Tag {(index + 1).toLocaleString()}<textarea aria-label={`Tag ${(index + 1).toLocaleString()}`} className={fieldClass} rows={1} maxLength={4096} disabled={disabled} value={row.person.tags![index]} onChange={event => update("tags", row.person.tags!.map((tag, i) => i === index ? event.target.value : tag))} /></label>}
          {index < (row.person.tags?.length ?? 0) && <button type="button" className={buttonClass} disabled={disabled} aria-label={`Remove tag ${(index + 1).toLocaleString()}`} onClick={() => replaceTags(row.person.tags!.filter((_, i) => i !== index))}>Remove tag</button>}
        </div>;
      })}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => replaceTags([...(row.archived.tags ?? [])])}>Use archived tags</button>
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => replaceTags([])}>Clear tags</button>
        <button type="button" className={buttonClass} disabled={disabled || (row.person.tags?.length ?? 0) >= 4096} onClick={() => replaceTags([...(row.person.tags ?? []), ""])}>Add tag</button>
        {tagPage > 0 && <button type="button" className={buttonClass} onClick={() => setTagPage(tagPage - 1)}>Previous tags</button>}
        {(tagPage + 1) * 8 < tagCount(row) && <button type="button" className={buttonClass} onClick={() => { setTagPage(tagPage + 1); setVisited(current => ({ ...current, [page]: Math.max(current[page] ?? 0, (tagPage + 2) * 8) })); }}>Next tags</button>}
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} /><span>{mode === "friend" ? "Use these Person details for the Friend replacement, including any avatar URL changes." : "Apply these complete Person records, including any avatar URL changes."}</span></label>
      <div className="flex flex-wrap gap-2">
        {page > 0 && <button type="button" className={buttonClass} disabled={saving} onClick={() => navigate(page - 1)}>Previous person</button>}
        {page + 1 < drafts.length && <button type="button" className={buttonClass} disabled={saving} onClick={() => navigate(page + 1)}>Next person</button>}
        <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !confirmed || !reviewed} onClick={() => void submit()}>{mode === "friend" ? "Review account selection" : "Store revised people"}</button>
      </div>
    </>}
  </div>;
}
