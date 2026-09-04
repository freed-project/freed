import type { Highlight } from "./types";

/**
 * Reserved annotation text for a whole-item note.
 *
 * U+2063 is intentionally invisible and does not add a synthetic search term.
 * The note remains a normal synchronized annotation, so existing Library Core
 * search and replacement-sync behavior apply without a second storage path.
 */
export const SAVED_ITEM_NOTE_MARKER = "\u2063";

export function getSavedItemNote(
  highlights: readonly Highlight[] | undefined,
): string {
  return highlights?.find((highlight) => highlight.text === SAVED_ITEM_NOTE_MARKER)?.note ?? "";
}

export function withSavedItemNote(
  highlights: readonly Highlight[] | undefined,
  note: string,
  createdAt = Date.now(),
): Highlight[] {
  const remaining = (highlights ?? []).filter(
    (highlight) => highlight.text !== SAVED_ITEM_NOTE_MARKER,
  );
  if (note.length === 0) return remaining;
  return [
    ...remaining,
    {
      text: SAVED_ITEM_NOTE_MARKER,
      note,
      createdAt,
    },
  ];
}
