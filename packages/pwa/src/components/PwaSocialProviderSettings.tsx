import { useMemo, type ReactNode } from "react";

import { getWebsiteHostForChannel } from "@freed/shared";
import { usePlatform, type SyncProviderSectionProps } from "@freed/ui/context";
import { useAppStore } from "../lib/store";

type SocialPlatform = "x" | "facebook" | "instagram" | "linkedin";

interface ProviderContent {
  label: string;
  body: string;
  icon: ReactNode;
  iconClassName: string;
}

const PROVIDER_CONTENT: Record<SocialPlatform, ProviderContent> = {
  x: {
    label: "X / Twitter",
    body: "X / Twitter connections are managed in Freed Desktop. This view shows what has synced here.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-x)]",
  },
  facebook: {
    label: "Facebook",
    body: "Facebook connections are managed in Freed Desktop. This view shows what has synced here.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-facebook)]",
  },
  instagram: {
    label: "Instagram",
    body: "Instagram connections are managed in Freed Desktop. This view shows what has synced here.",
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
    body: "LinkedIn connections are managed in Freed Desktop. This view shows what has synced here.",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    iconClassName: "text-[var(--theme-media-linkedin)]",
  },
};

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "Not synced";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-3 text-left">
      <p className="text-[11px] uppercase tracking-wide text-[var(--theme-text-soft)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--theme-text-primary)]">{value}</p>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function DesktopManagementLink() {
  const { releaseChannel } = usePlatform();
  const websiteGetUrl = `https://${getWebsiteHostForChannel(releaseChannel ?? "production")}/get`;

  return (
    <a
      href={websiteGetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="theme-accent-button inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs transition-colors"
    >
      <DownloadIcon />
      Download Freed Desktop
    </a>
  );
}

function PwaSocialProviderSettings({
  platform,
}: {
  platform: SocialPlatform;
} & SyncProviderSectionProps) {
  const content = PROVIDER_CONTENT[platform];
  const items = useAppStore((s) => s.items);
  const stats = useMemo(() => {
    let total = 0;
    let unread = 0;
    let latestCaptured = 0;
    let latestPublished = 0;
    for (const item of items) {
      if (item.platform !== platform) continue;
      total += 1;
      if (!item.userState.readAt) unread += 1;
      if (item.capturedAt > latestCaptured) latestCaptured = item.capturedAt;
      if (item.publishedAt > latestPublished) latestPublished = item.publishedAt;
    }
    return {
      total,
      unread,
      latestCaptured: latestCaptured > 0 ? latestCaptured : null,
      latestPublished: latestPublished > 0 ? latestPublished : null,
    };
  }, [items, platform]);

  return (
    <div className="space-y-4 py-2" data-testid={`pwa-source-status-${platform}`}>
      <div className="flex items-start gap-3">
        <div className={content.iconClassName}>{content.icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--theme-text-primary)]">{content.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">{content.body}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Synced items" value={stats.total.toLocaleString()} />
        <StatCard label="Unread" value={stats.unread.toLocaleString()} />
        <StatCard label="Latest sync" value={formatTimestamp(stats.latestCaptured)} />
        <StatCard label="Latest post" value={formatTimestamp(stats.latestPublished)} />
      </div>

      <div className="flex justify-center pt-3">
        <DesktopManagementLink />
      </div>
    </div>
  );
}

function GoogleContactsIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0z" />
      <path d="M5.5 21a6.5 6.5 0 0113 0" />
      <path d="M19 8h2" />
      <path d="M19 12h2" />
      <path d="M3 8h2" />
      <path d="M3 12h2" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 5c7.18 0 13 5.82 13 13" />
      <path d="M6 11a7 7 0 017 7" />
      <path d="M7 18.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}

export function PwaFeedsSettings() {
  const feeds = useAppStore((s) => s.feeds);
  const items = useAppStore((s) => s.items);
  const stats = useMemo(() => {
    const feedList = Object.values(feeds).filter((feed) => feed.enabled !== false);
    let syncedItems = 0;
    let unread = 0;
    let latestSync = 0;
    let latestPublished = 0;

    for (const feed of feedList) {
      if (feed.lastFetched && feed.lastFetched > latestSync) latestSync = feed.lastFetched;
    }

    for (const item of items) {
      if (item.platform !== "rss") continue;
      syncedItems += 1;
      if (!item.userState.readAt) unread += 1;
      if (item.capturedAt > latestSync) latestSync = item.capturedAt;
      if (item.publishedAt > latestPublished) latestPublished = item.publishedAt;
    }

    return {
      syncedFeeds: feedList.length,
      syncedItems,
      unread,
      latestSync: latestSync > 0 ? latestSync : null,
      latestPublished: latestPublished > 0 ? latestPublished : null,
    };
  }, [feeds, items]);

  return (
    <div className="space-y-4 py-2" data-testid="pwa-source-status-feeds">
      <div className="flex items-start gap-3">
        <div className="text-[var(--theme-accent-secondary)]">
          <RssIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--theme-text-primary)]">Feeds</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
            Feed subscriptions are managed in Freed Desktop. This view shows RSS content that has synced here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Synced feeds" value={stats.syncedFeeds.toLocaleString()} />
        <StatCard label="Synced items" value={stats.syncedItems.toLocaleString()} />
        <StatCard label="Unread" value={stats.unread.toLocaleString()} />
        <StatCard label="Latest sync" value={formatTimestamp(stats.latestSync)} />
        <StatCard label="Latest post" value={formatTimestamp(stats.latestPublished)} />
      </div>

      <div className="flex justify-center pt-3">
        <DesktopManagementLink />
      </div>
    </div>
  );
}

export function PwaGoogleContactsSettings() {
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const accounts = useAppStore((s) => s.accounts);
  const persons = useAppStore((s) => s.persons);
  const stats = useMemo(() => {
    const contactAccounts = Object.values(accounts).filter(
      (account) => account.kind === "contact" && account.provider === "google_contacts",
    );
    const linkedPersonIds = new Set<string>();
    let latestImported = 0;
    for (const account of contactAccounts) {
      if (account.personId && persons[account.personId]) {
        linkedPersonIds.add(account.personId);
      }
      const importedAt = account.importedAt ?? account.lastSeenAt ?? account.createdAt ?? 0;
      if (importedAt > latestImported) latestImported = importedAt;
    }

    return {
      imported: contactAccounts.length,
      linkedPeople: linkedPersonIds.size,
      latestImported: latestImported > 0 ? latestImported : null,
    };
  }, [accounts, persons]);

  return (
    <div className="space-y-4 py-2" data-testid="pwa-source-status-google-contacts">
      <div className="flex items-start gap-3">
        <div className="text-[var(--theme-accent-secondary)]">
          <GoogleContactsIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--theme-text-primary)]">Google Contacts</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
            Google Contacts is managed in Freed Desktop. This view shows contacts that have synced here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Imported contacts" value={stats.imported.toLocaleString()} />
        <StatCard label="Linked people" value={stats.linkedPeople.toLocaleString()} />
        <StatCard label="Latest import" value={formatTimestamp(stats.latestImported)} />
        {pendingMatchCount > 0 ? (
          <StatCard label="Pending review" value={pendingMatchCount.toLocaleString()} />
        ) : null}
      </div>

      <div className="flex justify-center pt-3">
        <DesktopManagementLink />
      </div>
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
