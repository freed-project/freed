import type { FeedItem } from "@freed/shared";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function renderFeedItemReaderHtml(item: FeedItem): string {
  const title =
    item.content.linkPreview?.title ??
    item.content.text?.slice(0, 100) ??
    item.author.displayName;
  const body = item.content.text ? textToParagraphs(item.content.text) : "";
  const media = item.content.mediaUrls
    .map((url, index) => {
      const type = item.content.mediaTypes[index];
      const webUrl = safeWebUrl(url);
      if (!webUrl) return "";
      const safeUrl = escapeHtml(webUrl);
      if (type === "video") {
        return `<figure><video src="${safeUrl}" controls playsinline></video></figure>`;
      }
      if (type === "link") {
        return `<p><a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${safeUrl}</a></p>`;
      }
      return `<figure><img src="${safeUrl}" alt="" /></figure>`;
    })
    .join("");

  return `<article><h1>${escapeHtml(title)}</h1>${media}${body}</article>`;
}
