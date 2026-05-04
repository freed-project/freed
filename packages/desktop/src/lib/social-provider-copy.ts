export type SocialProviderId = "x" | "facebook" | "instagram" | "linkedin";

export interface SocialProviderCopy {
  label: string;
  settingsTitle: string;
  connectedEmptyState: string;
  disconnectedSettings: string;
  disconnectedEmptyState: string;
  feedReturnedEmpty: string;
  timeout: string;
  connectedInfo: string;
  memoryPressure: string;
}

export const SOCIAL_PROVIDER_COPY = {
  x: {
    label: "X",
    settingsTitle: "X",
    connectedEmptyState: "Your X timeline is up to date.",
    disconnectedSettings:
      "Pull your home timeline into Freed. Sign in with your X account to start syncing.",
    disconnectedEmptyState:
      "Pull your home timeline into Freed. Set it up in Sources settings.",
    feedReturnedEmpty: "Timeline returned no posts.",
    timeout:
      "Scrape timed out. X may be slow to load. Try again.",
    connectedInfo:
      "Freed syncs your home timeline every 30 minutes while the app is open. Cookies expire periodically, reconnect when sync stops working.",
    memoryPressure:
      "X sync did not start because Freed Desktop memory is critically high.",
  },
  facebook: {
    label: "Facebook",
    settingsTitle: "Facebook",
    connectedEmptyState: "Your Facebook feed is up to date.",
    disconnectedSettings:
      "Pull your Facebook feed into Freed. Log in through a native browser window. Freed reads your feed the same way you would.",
    disconnectedEmptyState:
      "Pull your Facebook feed into Freed. Set it up in Sources settings.",
    feedReturnedEmpty:
      "Feed returned no posts. Facebook may need a moment to load.",
    timeout:
      "Scrape timed out. Facebook may be slow to load. Try again.",
    connectedInfo:
      "Freed reads your Facebook feed through a native browser session. Your traffic looks identical to normal browsing.",
    memoryPressure:
      "Facebook sync did not start because Freed Desktop memory is critically high.",
  },
  instagram: {
    label: "Instagram",
    settingsTitle: "Instagram",
    connectedEmptyState: "Your Instagram feed is up to date.",
    disconnectedSettings:
      "Pull your Instagram feed into Freed. Log in through a native browser window. Freed reads your feed the same way you would.",
    disconnectedEmptyState:
      "Pull your Instagram feed into Freed. Set it up in Sources settings.",
    feedReturnedEmpty:
      "Feed returned no posts. Instagram may need a moment to load.",
    timeout:
      "Scrape timed out. Instagram may be slow to load. Try again.",
    connectedInfo:
      "Freed reads your Instagram feed through a native browser session. Your traffic looks identical to normal browsing.",
    memoryPressure:
      "Instagram sync did not start because Freed Desktop memory is critically high.",
  },
  linkedin: {
    label: "LinkedIn",
    settingsTitle: "LinkedIn",
    connectedEmptyState: "Your LinkedIn feed is up to date.",
    disconnectedSettings:
      "Pull your LinkedIn feed into Freed. Log in through a native browser window. Freed reads your feed the same way you would.",
    disconnectedEmptyState:
      "Pull your LinkedIn feed into Freed. Set it up in Sources settings.",
    feedReturnedEmpty:
      "Feed returned no posts. LinkedIn may need a moment to load.",
    timeout:
      "Scrape timed out. LinkedIn may be slow to load. Try again.",
    connectedInfo:
      "Freed reads your LinkedIn feed through a native browser session. Your traffic looks identical to normal browsing.",
    memoryPressure:
      "LinkedIn sync did not start because Freed Desktop memory is critically high.",
  },
} satisfies Record<SocialProviderId, SocialProviderCopy>;

export function socialProviderCopy(provider: SocialProviderId): SocialProviderCopy {
  return SOCIAL_PROVIDER_COPY[provider];
}
