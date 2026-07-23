export type EssayProvider = "substack" | "medium";

const TRACKING_QUERY_KEYS = new Set([
  "ref",
  "referrer",
  "sk",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

export function canonicalEssayProviderUrl(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_QUERY_KEYS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return undefined;
  }
}

export function canonicalEssayProviderProfileUrl(
  provider: EssayProvider,
  value: string | null | undefined,
): string | undefined {
  const canonical = canonicalEssayProviderUrl(value);
  if (!canonical) return undefined;
  try {
    const url = new URL(canonical);
    const hostname = url.hostname.toLowerCase();
    const isProviderProfileHost = provider === "substack"
      ? hostname === "substack.com" || hostname === "www.substack.com"
      : hostname === "medium.com" || hostname === "www.medium.com";
    if (!isProviderProfileHost) return canonical;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 1 && segments[0]?.startsWith("@")) {
      url.pathname = `/@${segments[0].slice(1).toLowerCase()}`;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function essayProviderGlobalId(
  provider: EssayProvider,
  value: string | null | undefined,
): string | undefined {
  const url = canonicalEssayProviderUrl(value);
  if (!url) return undefined;
  const kind = provider === "substack" ? "essay" : "story";
  return `${provider}:${kind}:${encodeURIComponent(url)}`;
}

function stableIdentityHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  first ^= first >>> 16;
  second ^= second >>> 13;
  return `${(first >>> 0).toString(36).padStart(7, "0")}${(second >>> 0)
    .toString(36)
    .padStart(7, "0")}`;
}

export interface EssayActivityIdentityInput {
  targetUrl?: string;
  authorId?: string;
  publishedAt?: string | number;
  text?: string;
}

/**
 * Build a bounded identity for an action attached to an essay. The target URL
 * alone is not unique because many people can respond to the same essay.
 */
export function essayActivityGlobalId(
  provider: EssayProvider,
  kind: string,
  input: EssayActivityIdentityInput,
): string | undefined {
  const targetUrl = canonicalEssayProviderUrl(input.targetUrl) ?? input.targetUrl?.trim() ?? "";
  const authorId = input.authorId?.trim() ?? "";
  const publishedAt = input.publishedAt?.toString().trim() ?? "";
  const text = input.text?.replace(/\s+/g, " ").trim().slice(0, 4_000) ?? "";
  if (!targetUrl && !authorId && !publishedAt && !text) return undefined;
  const fingerprint = stableIdentityHash(
    [provider, kind, targetUrl, authorId, publishedAt, text].join("\u001f"),
  );
  return `${provider}:${kind}:${fingerprint}`;
}
