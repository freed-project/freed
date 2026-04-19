export const RELEASE_CHANNELS = ["production", "dev"] as const;

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const RELEASE_CHANNEL_LABELS: Record<ReleaseChannel, string> = {
  production: "Production",
  dev: "Dev",
};

export const WEBSITE_HOST_BY_CHANNEL: Record<ReleaseChannel, string> = {
  production: "freed.wtf",
  dev: "dev.freed.wtf",
};

export const PWA_HOST_BY_CHANNEL: Record<ReleaseChannel, string> = {
  production: "app.freed.wtf",
  dev: "dev-app.freed.wtf",
};

export function normalizeReleaseChannel(value: string | null | undefined): ReleaseChannel {
  return value === "dev" ? "dev" : "production";
}

export function stripReleaseChannelSuffix(version: string): string {
  return String(version ?? "").replace(/-dev$/, "");
}

export function getReleaseChannelFromVersion(version: string): ReleaseChannel {
  return String(version ?? "").endsWith("-dev") ? "dev" : "production";
}

export function formatReleaseVersion(
  version: string,
  channel: ReleaseChannel = getReleaseChannelFromVersion(version),
): string {
  const baseVersion = stripReleaseChannelSuffix(version);
  return channel === "dev" ? `${baseVersion}-dev` : baseVersion;
}

export function inferReleaseChannelFromHostname(
  hostname: string | null | undefined,
): ReleaseChannel | null {
  if (!hostname) {
    return null;
  }

  const normalized = hostname.toLowerCase();
  if (
    normalized === WEBSITE_HOST_BY_CHANNEL.dev ||
    normalized === PWA_HOST_BY_CHANNEL.dev
  ) {
    return "dev";
  }

  if (
    normalized === WEBSITE_HOST_BY_CHANNEL.production ||
    normalized === PWA_HOST_BY_CHANNEL.production
  ) {
    return "production";
  }

  return null;
}

export function getWebsiteHostForChannel(channel: ReleaseChannel): string {
  return WEBSITE_HOST_BY_CHANNEL[channel];
}

export function getPwaHostForChannel(channel: ReleaseChannel): string {
  return PWA_HOST_BY_CHANNEL[channel];
}
