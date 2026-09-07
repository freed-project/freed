import type { Platform } from "@freed/shared";
import { providerLabel } from "../lib/account-labels.js";
import {
  XIcon, FacebookIcon, InstagramIcon, LinkedInIcon, RssIcon,
  YoutubeIcon, RedditIcon, MastodonIcon, GithubIcon, SubstackIcon,
  MediumIcon, BookmarkIcon,
} from "./icons.js";

const providerIcons = {
  x: XIcon, facebook: FacebookIcon, instagram: InstagramIcon,
  linkedin: LinkedInIcon, rss: RssIcon, youtube: YoutubeIcon,
  reddit: RedditIcon, mastodon: MastodonIcon, github: GithubIcon,
  substack: SubstackIcon, medium: MediumIcon, saved: BookmarkIcon,
};

/** Compact source identity using the same logo and chip tokens as friend profiles. */
export function ProviderChip({ provider }: { provider: Platform }) {
  const Icon = providerIcons[provider];
  return (
    <span className="theme-chip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-[color:var(--theme-accent-primary)]">
      <span aria-hidden="true"><Icon className="h-3 w-3" /></span>
      {providerLabel(provider)}
    </span>
  );
}
