import type { ReactNode } from "react";

import { getWebsiteHostForChannel } from "@freed/shared";
import { usePlatform, type SyncProviderSectionProps } from "@freed/ui/context";
import { useAppStore } from "../lib/store";

type SocialPlatform = "x" | "facebook" | "instagram" | "linkedin";

interface ProviderContent {
  label: string;
  syncedLabel: string;
  emptyLabel: string;
  emptyBody: string;
  icon: ReactNode;
  iconClassName: string;
}

const PROVIDER_CONTENT: Record<SocialPlatform, ProviderContent> = {
  x: {
    label: "X / Twitter",
    syncedLabel: "Synced from Freed Desktop",
    emptyLabel: "X / Twitter sync requires Freed Desktop",
    emptyBody: "Download Freed Desktop to connect your X / Twitter account and sync your home timeline.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-x)]",
  },
  facebook: {
    label: "Facebook",
    syncedLabel: "Synced from Freed Desktop",
    emptyLabel: "Facebook sync requires Freed Desktop",
    emptyBody: "Download Freed Desktop to connect Facebook and sync your home feed.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-facebook)]",
  },
  instagram: {
    label: "Instagram",
    syncedLabel: "Synced from Freed Desktop",
    emptyLabel: "Instagram sync requires Freed Desktop",
    emptyBody: "Download Freed Desktop to connect Instagram and sync your home feed.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-instagram)]",
  },
  linkedin: {
    label: "LinkedIn",
    syncedLabel: "Synced from Freed Desktop",
    emptyLabel: "LinkedIn sync requires Freed Desktop",
    emptyBody: "Download Freed Desktop to connect LinkedIn and sync your home feed.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-linkedin)]",
  },
};

function formatLastSync(lastSync: number | null): string | null {
  if (!lastSync) return null;
  return new Date(lastSync).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PwaSocialProviderSettings({
  platform,
}: {
  platform: SocialPlatform;
} & SyncProviderSectionProps) {
  const { releaseChannel } = usePlatform();
  const content = PROVIDER_CONTENT[platform];
  const websiteGetUrl = `https://${getWebsiteHostForChannel(releaseChannel ?? "production")}/get`;
  const itemCount = useAppStore((s) =>
    s.items.reduce((count, item) => count + (item.platform === platform ? 1 : 0), 0),
  );
  const lastSync = useAppStore((s) => {
    let max = 0;
    for (const item of s.items) {
      if (item.platform === platform && item.capturedAt > max) max = item.capturedAt;
    }
    return max > 0 ? max : null;
  });
  const formattedLastSync = formatLastSync(lastSync);

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className={content.iconClassName}>{content.icon}</div>

      {itemCount > 0 ? (
        <>
          <div>
            <p className="text-sm text-[var(--theme-text-secondary)]">{content.syncedLabel}</p>
            <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-[var(--theme-text-soft)]">
              {itemCount.toLocaleString()} items synced
              {formattedLastSync ? <> · last {formattedLastSync}</> : null}
          </p>
        </div>
        <a
          href={websiteGetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="theme-accent-button rounded-lg px-4 py-2 text-xs transition-colors"
          >
            Download Freed Desktop
          </a>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm text-[var(--theme-text-secondary)]">{content.emptyLabel}</p>
            <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-[var(--theme-text-soft)]">
              {content.emptyBody}
          </p>
        </div>
        <a
          href={websiteGetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="theme-accent-button rounded-lg px-4 py-2 text-xs transition-colors"
          >
            Download Freed Desktop
          </a>
        </>
      )}
    </div>
  );
}

export function PwaXSettings(props: SyncProviderSectionProps) {
  return <PwaSocialProviderSettings platform="x" {...props} />;
}

export function PwaFacebookSettings(props: SyncProviderSectionProps) {
  return <PwaSocialProviderSettings platform="facebook" {...props} />;
}

export function PwaInstagramSettings(props: SyncProviderSectionProps) {
  return <PwaSocialProviderSettings platform="instagram" {...props} />;
}

export function PwaLinkedInSettings(props: SyncProviderSectionProps) {
  return <PwaSocialProviderSettings platform="linkedin" {...props} />;
}
