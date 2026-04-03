function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulPreviewLine(text: string): boolean {
  if (!text) {
    return false;
  }

  if (
    text.startsWith("(AI Generated") ||
    /^Freed v/i.test(text) ||
    /^Features$/i.test(text) ||
    /^Fixes$/i.test(text) ||
    /^Follow-ups$/i.test(text) ||
    /^Downloads$/i.test(text) ||
    /^\*\*macOS:/i.test(text) ||
    /^\*\*Windows:/i.test(text) ||
    /^\*\*Linux:/i.test(text)
  ) {
    return false;
  }

  return true;
}

export function extractUpdatePreviewLine(body: string): string | null {
  const lines = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  let sawReleaseHeading = false;

  for (const line of lines) {
    if (!line || line.startsWith("(AI Generated")) {
      continue;
    }

    if (!sawReleaseHeading && /^##\s+Freed\s+v/i.test(line)) {
      sawReleaseHeading = true;
      continue;
    }

    if (!sawReleaseHeading) {
      continue;
    }

    if (/^###\s+/.test(line)) {
      return null;
    }

    const cleaned = stripInlineMarkdown(line);
    if (isMeaningfulPreviewLine(cleaned)) {
      return cleaned;
    }
  }

  if (sawReleaseHeading) {
    return null;
  }

  for (const line of lines) {
    const cleaned = stripInlineMarkdown(line);
    if (isMeaningfulPreviewLine(cleaned)) {
      return cleaned;
    }
  }

  return null;
}
