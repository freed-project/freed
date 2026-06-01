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

export function isValidDiscoveredSocialAccount(account: Account): boolean {
  if (account.kind !== "social") return true;
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
  if (item.platform !== "facebook") return true;
  return isValidFacebookAuthorIdentity({
    displayName: item.author.displayName,
    profileUrl: item.author.handle && item.author.handle !== "unknown"
      ? `https://www.facebook.com/${item.author.handle.replace(/^fb:/, "")}`
      : undefined,
  });
}
