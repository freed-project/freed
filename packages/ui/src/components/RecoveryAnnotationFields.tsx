import { SAVED_ITEM_NOTE_MARKER } from "@freed/shared";
import type { FeedItemAnnotationsReplacePayloadV1, LibraryCoreItemAnnotationsResponseV1 } from "@freed/shared/library-core";

export interface RecoveryAnnotationValue {
  readonly highlights: FeedItemAnnotationsReplacePayloadV1["highlights"];
  readonly tags: readonly string[];
}
const field = "w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2";
const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";

/** The whole annotation set stays editable; stored quote references stay intact. */
export function RecoveryAnnotationFields({ value, current, disabled, onChange }: {
  value: RecoveryAnnotationValue; current: LibraryCoreItemAnnotationsResponseV1 | null;
  disabled: boolean; onChange: (value: RecoveryAnnotationValue) => void;
}) {
  return <>
      {current ? <details><summary>Last-synced annotations</summary>
        <p>Tags: {current.tags.join(", ") || "None"}</p>
        {current.highlights.map((row, index) => <p key={index} className="whitespace-pre-wrap break-words">{row.text === SAVED_ITEM_NOTE_MARKER ? "Item note" : row.text ?? `Stored quote ...${row.textBlobDigest!.slice(-8)} (text not loaded)`}{row.note !== null ? `: ${row.note}` : ""}</p>)}
        {current.highlights.length === 0 && <p>No notes or highlights.</p>}
      </details> : <p role="status">Reading last-synced annotations...</p>}
      {value.highlights.map((row, index) => <fieldset key={index} className="space-y-2 rounded-lg border border-[var(--theme-border-subtle)] p-3" disabled={disabled}>
        <legend>{row.text === SAVED_ITEM_NOTE_MARKER ? "Item note" : `Highlight ${(index + 1).toLocaleString()}`}</legend>
        {row.text === SAVED_ITEM_NOTE_MARKER ? null : row.text === null
          ? <p>Stored quote ...{row.textBlobDigest!.slice(-8)}. Its text is not loaded; the reference will be preserved.</p>
          : <label className="block">Quoted text<textarea className={field} maxLength={65536} value={row.text} onChange={(e) => onChange({ ...value, highlights: value.highlights.map((h, i) => i === index ? { ...h, text: e.target.value } : h) })} /></label>}
        <label className="block">{row.text === SAVED_ITEM_NOTE_MARKER ? "Note" : "Highlight note"}<textarea className={field} maxLength={8192} value={row.note ?? ""} onChange={(e) => onChange({ ...value, highlights: value.highlights.map((h, i) => i === index ? { ...h, note: e.target.value } : h) })} /></label>
        <button type="button" className={button} onClick={() => onChange({ ...value, highlights: value.highlights.filter((_, i) => i !== index) })}>Remove this annotation</button>
      </fieldset>)}
      <div className="flex flex-wrap gap-2">
        {!value.highlights.some((h) => h.text === SAVED_ITEM_NOTE_MARKER) && <button type="button" className={button} disabled={disabled || value.highlights.length >= 64} onClick={() => onChange({ ...value, highlights: [...value.highlights, { text: SAVED_ITEM_NOTE_MARKER, textBlobDigest: null, note: "", createdAt: Date.now() }] })}>Add item note</button>}
        <button type="button" className={button} disabled={disabled || value.highlights.length >= 64} onClick={() => onChange({ ...value, highlights: [...value.highlights, { text: "", textBlobDigest: null, note: null, createdAt: Date.now() }] })}>Add highlight</button>
      </div>
      {value.tags.map((tag, index) => <div key={index}><label className="block">Tag {(index + 1).toLocaleString()}<input className={field} maxLength={512} value={tag} disabled={disabled} onChange={(e) => onChange({ ...value, tags: value.tags.map((t, i) => i === index ? e.target.value : t) })} /></label><button type="button" className={button} disabled={disabled} onClick={() => onChange({ ...value, tags: value.tags.filter((_, i) => i !== index) })}>Remove tag {(index + 1).toLocaleString()}</button></div>)}
      <button type="button" className={button} disabled={disabled || value.tags.length >= 64} onClick={() => onChange({ ...value, tags: [...value.tags, ""] })}>Add tag</button>
  </>;
}
