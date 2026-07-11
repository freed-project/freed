interface BrowserNavigation {
  assign: (url: string) => void;
  open: (url: string, target: string, features: string) => void;
}

const YOUTUBE_HANDOFF_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

/** Keep YouTube navigation in the user's tap so iOS can honor Universal Links. */
export function openPwaUrl(
  url: string,
  navigation: BrowserNavigation = {
    assign: (nextUrl) => window.location.assign(nextUrl),
    open: (nextUrl, target, features) => {
      window.open(nextUrl, target, features);
    },
  },
): void {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "https:" &&
      YOUTUBE_HANDOFF_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      navigation.assign(parsed.toString());
      return;
    }
  } catch {
    // Keep the existing browser fallback for invalid or relative input.
  }
  navigation.open(url, "_blank", "noopener,noreferrer");
}
