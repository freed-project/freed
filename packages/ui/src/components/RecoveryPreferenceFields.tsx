import { useEffect, useMemo, useState } from "react";
import {
  decodeLibraryCoreFractionalNumbersV1, encodeLibraryCoreFractionalNumbersV1,
  PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA, sameLibraryCoreRecoveryPreferenceScopeV1,
  snapshotLibraryCoreRecoveryPreferencePatchesV1,
  type LibraryCoreCanonicalValue, type RecoveryPreferenceDraft, type RecoveryPreferenceCurrent,
} from "@freed/shared/library-core";

const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2";
const labels: Record<string, string> = { weights: "Ranking weights", xCapture: "X capture", fbCapture: "Facebook capture", ai: "AI", ulysses: "Browsing limits", storyWall: "Story Wall", showEngagementCounts: "Show engagement counts", autoSummarize: "Summarize articles automatically", extractTopics: "Extract topics", excludedGroupIds: "Excluded groups" };
const words = (key: string) => labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
function pathLabel(path: readonly string[]): string {
  return path.map((key, i) => i > 0 && ["authors", "whitelist", "blacklist", "excludedGroupIds"].includes(path[i - 1]!) ? `...${key.slice(-8)}` : i > 0 && ["topics", "allowedPaths", "platforms"].includes(path[i - 1]!) ? key : words(key)).join(" / ");
}
function ValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Not set</span>;
  if (typeof value === "boolean") return <span>{value ? "On" : "Off"}</span>;
  if (typeof value === "number") return <span>{value.toLocaleString(undefined, { maximumSignificantDigits: 21 })}</span>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap break-words">{value || "Empty text"}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="list-inside list-decimal space-y-1">{value.map((child, i) => <li key={i}><ValueView value={child} /></li>)}</ol> : <span>Empty list</span>;
  const entries = Object.entries(value);
  return entries.length ? <dl className="space-y-1">{entries.map(([key, child]) => <div key={key}><dt>{words(key)}</dt><dd className="pl-3"><ValueView value={child} /></dd></div>)}</dl> : <span>Empty settings group</span>;
}
function NumberField({ value, label, disabled, onChange }: { value: number; label: string; disabled: boolean; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number.isFinite(value)) setText(old => old.trim() && Number(old) === value ? old : String(value)); }, [value]);
  return <input aria-label={label} type="text" inputMode="decimal" className={input} disabled={disabled} value={text} onChange={e => { setText(e.target.value); onChange(e.target.value.trim() ? Number(e.target.value) : NaN); }} />;
}
/** Arrays are edited as whole values; no element becomes an independent signed assignment. */
function ValueInput({ value, label, disabled, canGrow, numericList, onChange }: {
  value: unknown; label: string; disabled: boolean; canGrow: boolean; numericList?: boolean; onChange: (value: unknown) => void;
}) {
  if (typeof value === "number") return <NumberField value={value} label={label} disabled={disabled} onChange={onChange} />;
  if (typeof value === "boolean") return <label className="flex items-center gap-2"><input aria-label={label} type="checkbox" disabled={disabled} checked={value} onChange={e => onChange(e.target.checked)} />Enabled</label>;
  if (typeof value === "string") return <textarea aria-label={label} className={input} rows={3} maxLength={8192} disabled={disabled} value={value} onChange={e => onChange(e.target.value)} />;
  if (value === null) return <p>No value assigned. Use a current value below if you want to restore it.</p>;
  if (Array.isArray(value)) return <div className="space-y-2">
    {value.map((child, index) => <div key={index} className="space-y-1 border-b border-[var(--theme-border-subtle)] pb-2">
      <p>Entry {(index + 1).toLocaleString()}</p>
      <ValueInput value={child} label={`${label}, entry ${(index + 1).toLocaleString()}`} disabled={disabled} canGrow={canGrow} onChange={next => onChange(value.map((old, i) => i === index ? next : old))} />
      <button type="button" className={button} disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove entry {(index + 1).toLocaleString()}</button>
    </div>)}
    <button type="button" className={button} disabled={disabled || !canGrow} onClick={() => onChange([...value, numericList || typeof value[0] === "number" ? 0 : typeof value[0] === "boolean" ? false : ""])}>Add entry</button>
  </div>;
  if (typeof value === "object" && value !== null) return <div className="space-y-2">{Object.entries(value).map(([key, child]) => <div className="block" key={key}><p>{words(key)}</p><ValueInput value={child} label={`${label}, ${words(key)}`} disabled={disabled} canGrow={canGrow} onChange={next => onChange(Object.fromEntries(Object.entries(value).map(([name, old]) => [name, name === key ? next : old])))} /></div>)}</div>;
  return <p>This value cannot be edited here. Its archive is preserved.</p>;
}
function replacePath(value: LibraryCoreCanonicalValue, path: readonly string[], replacement: LibraryCoreCanonicalValue): LibraryCoreCanonicalValue {
  if (!path.length) return replacement;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, path[0]!)) throw new Error("Preference path changed");
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === path[0] ? replacePath(child, path.slice(1), replacement) : child]));
}
function readPath(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return decodeLibraryCoreFractionalNumbersV1(value);
}

export function RecoveryPreferenceFields({ drafts, readCurrent, onSubmit, saving, locked, error }: {
  readCurrent: (path: readonly string[], signal: AbortSignal) => Promise<RecoveryPreferenceCurrent>;
  drafts: readonly RecoveryPreferenceDraft[]; onSubmit: (patches: readonly unknown[]) => Promise<void>;
  saving: boolean; locked: boolean; error: string | null;
}) {
  const fields = useMemo(() => drafts.flatMap((draft, member) => draft.fields.map(field => ({ member, field }))), [drafts]);
  const [patches, setPatches] = useState(() => drafts.map(draft => draft.updates));
  const [page, setPage] = useState(0), [seen, setSeen] = useState(0), [confirmed, setConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false), [reset, setReset] = useState(0);
  const selected = fields[page];
  const [candidate, setCandidate] = useState<unknown>(() => fields[0]?.field.archived);
  const [comparison, setComparison] = useState<{ field: RecoveryPreferenceDraft["fields"][number]; reader: typeof readCurrent; value: RecoveryPreferenceCurrent | null; failed: boolean } | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const matching = comparison?.field === selected?.field && comparison?.reader === readCurrent ? comparison : null;
  const current = matching?.value ?? null;
  const readReady = current !== null;
  useEffect(() => {
    if (!selected || locked) return;
    const controller = new AbortController();
    setConfirmed(false);
    setComparison({ field: selected.field, reader: readCurrent, value: null, failed: false });
    void Promise.resolve().then(() => readCurrent(selected.field.path, controller.signal)).then(value => {
      if (controller.signal.aborted) return;
      setComparison({ field: selected.field, reader: readCurrent, value, failed: false });
      setSeen(previous => Math.max(previous, page + 1));
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ field: selected.field, reader: readCurrent, value: null, failed: true });
    });
    return () => controller.abort();
  }, [selected, page, readCurrent, readAttempt, locked]);
  const disabled = saving || locked;
  const change = (value: unknown) => {
    setCandidate(value); setConfirmed(false);
    try {
      if (!selected) throw new Error("Missing setting");
      const updated = replacePath(patches[selected.member]!, selected.field.path, encodeLibraryCoreFractionalNumbersV1(value));
      const parsed = PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate({ updates: updated });
      if (!parsed.ok || !sameLibraryCoreRecoveryPreferenceScopeV1(drafts[selected.member]!.updates, parsed.value.updates)) throw new Error("Invalid preference edit");
      const next = patches.map((old, i) => i === selected.member ? parsed.value.updates : old);
      snapshotLibraryCoreRecoveryPreferencePatchesV1(next);
      setPatches(next); setInvalid(false);
    } catch { setInvalid(true); }
  };
  const navigate = (next: number) => {
    const entry = fields[next]!;
    setPage(next); setConfirmed(false); setReset(reset + 1);
    setCandidate(readPath(patches[entry.member], entry.field.path));
  };
  const restore = (value: unknown) => { change(value); setReset(reset + 1); };
  return <div data-testid="recovery-preference-editor" className="mt-3 space-y-3 text-xs">
    <p>Review every setting before applying it again. The original outcome may be unknown. These new assignments can override later changes, including edits still queued on another device.</p>
    <p>Restored capture settings can affect which posts are retained and which media loads later. AI settings can send articles to the configured provider and incur usage. Keeping current values avoids restoring older settings. Closing this editor leaves the archive untouched.</p>
    {selected && <>
      <p>Setting {(page + 1).toLocaleString()} of {fields.length.toLocaleString()} in edit {(selected.member + 1).toLocaleString()} of {drafts.length.toLocaleString()}</p>
      <h4 className="font-medium break-words">{pathLabel(selected.field.path)}</h4>
      <div className="grid gap-3 sm:grid-cols-2"><div><p className="font-medium">Archived value</p><ValueView value={selected.field.archived} /></div><div><p className="font-medium">{current && current.kind !== "absent" && current.origin === "default" ? "Current default" : "Last-synced value"}</p>
        {!current ? matching?.failed ? <p role="alert">This setting could not be read at the reviewed Library revision. Retry, or close and review the edit again if the Library changed.</p> : <p role="status">Loading this setting...</p>
          : current.kind === "value" ? <ValueView value={current.value} />
          : current.kind === "object_group" ? <p>A settings group exists here. Its contents are not loaded in this comparison.{selected.field.kind !== "empty_object" && " Applying a value replaces that group."}</p>
          : <p>No stored or default value.</p>}
        {matching?.failed && <button type="button" className={button} disabled={disabled} onClick={() => setReadAttempt(readAttempt + 1)}>Retry comparison</button>}
      </div></div>
      {selected.field.kind === "empty_object" ? <p>This edit preserves an empty settings group. It does not remove settings already inside that group.</p> : <>
        <p className="font-medium">Value to apply</p>
        <ValueInput key={`${page}:${reset}`} value={candidate} label="Value to apply" disabled={disabled || !readReady} canGrow={!invalid} numericList={selected.field.path.at(-1) === "selectedYears"} onChange={change} />
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || !readReady} onClick={() => restore(selected.field.archived)}>Use archived value</button>
          {current?.kind === "value" && <button type="button" className={button} disabled={disabled} onClick={() => restore(current.value)}>Use current value</button>}</div>
      </>}
    </>}
    {invalid && <p role="alert">This value changes the original setting structure, is invalid, or exceeds the edit size limit. Revise it or use the archived value.</p>}
    <label className="flex items-start gap-2"><input aria-label="Confirm preference recovery" type="checkbox" disabled={disabled || invalid || !readReady || seen < fields.length || !fields.length} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed every setting and want to apply these values as a new edit.</label>
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className={button} disabled={disabled || invalid || !readReady} onClick={() => navigate(page - 1)}>Previous setting</button>}
      {page + 1 < fields.length && <button type="button" className={button} disabled={disabled || invalid || !readReady} onClick={() => navigate(page + 1)}>Next setting</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !locked && (!confirmed || invalid || !readReady || seen < fields.length || !fields.length)} onClick={() => void onSubmit(patches)}>{saving ? "Storing replacement..." : locked ? "Retry same preference edit" : "Store revised preferences"}</button>
    </div>
  </div>;
}
