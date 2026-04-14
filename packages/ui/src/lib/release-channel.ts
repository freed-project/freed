import {
  getPwaHostForChannel,
  inferReleaseChannelFromHostname,
  normalizeReleaseChannel,
  type ReleaseChannel,
} from "@freed/shared";

export const RELEASE_CHANNEL_STORAGE_KEY = "freed-release-channel";
export const RELEASE_CHANNEL_QUERY_PARAM = "releaseChannel";

function getReleaseChannelFromQuery(): ReleaseChannel | null {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeReleaseChannel(
    new URLSearchParams(window.location.search).get(RELEASE_CHANNEL_QUERY_PARAM),
  );
}

function clearReleaseChannelQueryParam(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(RELEASE_CHANNEL_QUERY_PARAM)) {
    return;
  }

  url.searchParams.delete(RELEASE_CHANNEL_QUERY_PARAM);
  window.history.replaceState({}, "", url.toString());
}

export function getStoredReleaseChannel(): ReleaseChannel | null {
  if (typeof window === "undefined") {
    return null;
  }

  const queryChannel = getReleaseChannelFromQuery();
  if (queryChannel) {
    return queryChannel;
  }

  const inferredChannel = inferReleaseChannelFromHostname(window.location.hostname);
  if (inferredChannel) {
    return inferredChannel;
  }

  return normalizeReleaseChannel(window.localStorage.getItem(RELEASE_CHANNEL_STORAGE_KEY));
}

export function bootstrapReleaseChannel(): ReleaseChannel {
  const channel = getStoredReleaseChannel() ?? "production";
  persistReleaseChannel(channel);
  clearReleaseChannelQueryParam();
  return channel;
}

export function persistReleaseChannel(channel: ReleaseChannel): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RELEASE_CHANNEL_STORAGE_KEY, channel);
}

export function buildPwaReleaseChannelUrl(
  currentUrl: string,
  channel: ReleaseChannel,
): string {
  const url = new URL(currentUrl);
  url.hostname = getPwaHostForChannel(channel);
  url.searchParams.set(RELEASE_CHANNEL_QUERY_PARAM, channel);
  return url.toString();
}
