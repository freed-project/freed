import type { Account, FeedItem } from "./types.js";

const FACEBOOK_UI_LABELS = new Set([
  "account",
  "ads manager",
  "create new account",
  "events",
  "facebook",
  "feeds",
  "friends",
  "gaming",
  "groups",
  "home",
  "log in",
  "marketplace",
  "memories",
  "menu",
  "messenger",
  "meta",
  "notifications",
  "pages",
  "profile",
  "reels",
  "saved",
  "search facebook",
  "see less",
  "see more",
  "sign up",
  "video",
  "watch",
  "your shortcuts",
]);

const FACEBOOK_BLOCKED_PATHS = new Set([
  "ads",
  "bookmarks",
  "events",
  "friends",
  "gaming",
  "groups",
  "help",
  "home",
  "login",
  "marketplace",
  "me",
  "memories",
  "messages",
  "notifications",
  "pages",
  "privacy",
  "recover",
  "reg",
  "reel",
  "reels",
  "saved",
  "settings",
  "stories",
  "watch",
]);

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isFacebookUiChromeLabel(value: string | null | undefined): boolean {
  const normalized = normalizeLabel(value);
  if (!normalized) return true;
  if (FACEBOOK_UI_LABELS.has(normalized)) return true;
  if (/^(create|log in|sign up|search|switch|manage)\b/.test(normalized)) return true;
  if (/\b(shortcuts|notifications|messenger|marketplace)\b/.test(normalized)) return true;
  return false;
}

export function isUsableFacebookAuthorProfileUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, "https://www.facebook.com/");
    const host = url.hostname.toLowerCase();
    if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return false;

    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0]?.toLowerCase();
    if (!first || FACEBOOK_BLOCKED_PATHS.has(first)) return false;

    if (first === "profile.php") {
      return /^\d+$/.test(url.searchParams.get("id") ?? "");
    }

    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(parts[0])) return false;
    return true;
  } catch {
    return false;
  }
}

export function isValidFacebookAuthorIdentity(input: {
  displayName?: string | null;
  profileUrl?: string | null;
}): boolean {
  return (
    !isFacebookUiChromeLabel(input.displayName) &&
    isUsableFacebookAuthorProfileUrl(input.profileUrl)
  );
}

/**
 * Publication channels can be useful accounts without representing a person.
 * Roster direction does not turn a publication URL into a human identity.
 */
export function isPersonLikeSocialAccount(account: Account): boolean {
  if (
    account.kind !== "social" ||
    (account.provider !== "substack" && account.provider !== "medium")
  ) {
    return true;
  }
  const identityUrl = account.profileUrl ?? account.externalId;
  try {
    const url = new URL(identityUrl);
    const hostname = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (account.provider === "medium") {
      const isPublicationRoot =
        (hostname === "medium.com" || hostname === "www.medium.com") &&
        parts.length === 1 &&
        !parts[0].startsWith("@");
      return !isPublicationRoot;
    }
    const isPublicationRoot =
      hostname.endsWith(".substack.com") && parts.length === 0;
    return !isPublicationRoot;
  } catch {
    return true;
  }
}

export function isValidDiscoveredSocialAccount(account: Account): boolean {
  if (account.kind !== "social") return true;
  if (!isPersonLikeSocialAccount(account)) return false;
  if (account.provider !== "facebook") return true;
  if (isFacebookUiChromeLabel(account.displayName ?? account.handle ?? account.externalId)) {
    return false;
  }
  if (account.profileUrl && !isUsableFacebookAuthorProfileUrl(account.profileUrl)) {
    return false;
  }
  return true;
}

export function isPrunableInvalidDiscoveredSocialAccount(account: Account): boolean {
  if (account.kind !== "social") return false;
  if (account.provider !== "facebook") return false;
  if (account.personId) return false;
  if (account.discoveredFrom !== "captured_item" && account.discoveredFrom !== "story_author") {
    return false;
  }
  return !isValidDiscoveredSocialAccount(account);
}

export function isValidDiscoveredSocialFeedAuthor(item: FeedItem): boolean {
  if (item.platform === "facebook") {
    return isValidFacebookAuthorIdentity({
      displayName: item.author.displayName,
      profileUrl: item.author.handle && item.author.handle !== "unknown"
        ? `https://www.facebook.com/${item.author.handle.replace(/^fb:/, "")}`
        : undefined,
    });
  }
  if (item.platform === "substack" || item.platform === "medium") {
    try {
      const identity = new URL(item.author.id);
      const hostname = identity.hostname.toLowerCase();
      const parts = identity.pathname.split("/").filter(Boolean);
      if (item.platform === "substack") {
        return (
          (hostname.endsWith(".substack.com") && parts.length === 0) ||
          ((hostname === "substack.com" || hostname === "www.substack.com") &&
            parts.some((part) => part.startsWith("@")))
        );
      }
      return (
        (hostname === "medium.com" || hostname.endsWith(".medium.com")) &&
        parts.some((part) => part.startsWith("@"))
      );
    } catch {
      return false;
    }
  }
  return true;
}
