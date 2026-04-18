const MAX_SYNCED_PRESERVED_TEXT_CHARS = 1_500;
const MIN_SENTENCE_BREAK_INDEX = Math.floor(MAX_SYNCED_PRESERVED_TEXT_CHARS * 0.6);
const MIN_WORD_BREAK_INDEX = Math.floor(MAX_SYNCED_PRESERVED_TEXT_CHARS * 0.75);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function toSyncedPreservedText(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_SYNCED_PRESERVED_TEXT_CHARS) return normalized;

  const candidate = normalized.slice(0, MAX_SYNCED_PRESERVED_TEXT_CHARS + 1);
  const sentenceBreak = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );
  if (sentenceBreak >= MIN_SENTENCE_BREAK_INDEX) {
    return candidate.slice(0, sentenceBreak + 1).trim();
  }

  const wordBreak = candidate.lastIndexOf(" ");
  if (wordBreak >= MIN_WORD_BREAK_INDEX) {
    return candidate.slice(0, wordBreak).trim();
  }

  return candidate.slice(0, MAX_SYNCED_PRESERVED_TEXT_CHARS).trim();
}

export { MAX_SYNCED_PRESERVED_TEXT_CHARS };
