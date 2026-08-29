import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformConfig } from "@freed/ui/context";
import { PlatformProvider } from "@freed/ui/context";
import type { LibraryFacetSummary } from "@freed/ui/hooks/useLibraryFacetSummary";
import {
  PwaFacebookSettings,
  PwaFeedsSettings,
  PwaGoogleContactsSettings,
  PwaYouTubeSettings,
} from "./PwaSocialProviderSettings";
import { useAppStore } from "../lib/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function facetSummary(
  overrides: Partial<LibraryFacetSummary> = {},
): LibraryFacetSummary {
  return {
    archivedCount: 0,
    archivableCount: 0,
    contactAccountCount: 0,
    contactLinkedPersonCount: 0,
    enabledRssFeedCount: 0,
    friendPersonCount: 0,
    latestContactImportedAt: null,
    latestRssFeedFetchedAt: null,
    platformCounts: [],
    rssFeedCount: 0,
    sampleAccountCount: 0,
    sampleFeedCount: 0,
    sampleItemCount: 0,
    samplePersonCount: 0,
    savedArchivedCount: 0,
    savedCount: 0,
    savedPlatformCount: 0,
    socialAccountCount: 0,
    tags: [],
    totalCount: 0,
    unreadCount: 0,
    ...overrides,
  };
}

function createPlatform(summary: LibraryFacetSummary): PlatformConfig {
  return {
    store: useAppStore,
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: PwaFacebookSettings,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
    YouTubeSettingsContent: PwaYouTubeSettings,
    GoogleContactsSettingsContent: PwaGoogleContactsSettings,
    readLibraryFacetSummary: async () => summary,
    releaseChannel: "production",
  };
}

async function renderWithPlatform(
  node: ReactNode,
  summary = facetSummary(),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PlatformProvider, { value: createPlatform(summary), children: node }));
    await Promise.resolve();
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("PWA source provider settings", () => {
  afterEach(() => {
    useAppStore.setState({
      pendingMatchCount: 0,
    });
    document.body.innerHTML = "";
  });

  it("shows social sync statistics from SQLite facets without provider management controls", async () => {
    const { container, cleanup } = await renderWithPlatform(
      createElement(PwaFacebookSettings, { surface: "settings" }),
      facetSummary({
        platformCounts: [{
          archivableCount: 0,
          latestCapturedAt: 1_774_389_200_000,
          latestPublishedAt: 1_774_389_140_000,
          platform: "facebook",
          totalCount: 2,
          unreadCount: 1,
        }],
        totalCount: 2,
        unreadCount: 1,
      }),
    );

    expect(container.textContent).toContain("Facebook connections are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Unread");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect Facebook");
    const downloadLink = container.querySelector<HTMLAnchorElement>("a");
    expect(downloadLink?.className).toContain("inline-flex");
    expect(downloadLink?.querySelector("svg")).not.toBeNull();
    expect(downloadLink?.parentElement?.className).toContain("justify-center");
    expect(downloadLink?.parentElement?.className).toContain("pt-3");
    cleanup();
  });

  it("shows YouTube sync status without provider management controls", async () => {
    const { container, cleanup } = await renderWithPlatform(
      createElement(PwaYouTubeSettings, { surface: "settings" }),
      facetSummary({
        platformCounts: [{
          archivableCount: 0,
          latestCapturedAt: 1_774_389_200_000,
          latestPublishedAt: 1_774_389_140_000,
          platform: "youtube",
          totalCount: 1,
          unreadCount: 1,
        }],
        totalCount: 1,
        unreadCount: 1,
      }),
    );

    expect(container.textContent).toContain("YouTube connections are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect YouTube");
    expect(container.textContent).not.toContain("Freed Offline");
    cleanup();
  });

  it("shows Google Contacts sync status without connect or sync controls", async () => {
    useAppStore.setState({
      pendingMatchCount: 2,
    });

    const { container, cleanup } = await renderWithPlatform(
      createElement(PwaGoogleContactsSettings),
      facetSummary({
        contactAccountCount: 1,
        contactLinkedPersonCount: 1,
        latestContactImportedAt: 1_774_389_200_000,
      }),
    );

    expect(container.textContent).toContain("Google Contacts is managed in Freed Desktop");
    expect(container.textContent).toContain("Imported contacts");
    expect(container.textContent).toContain("Linked people");
    expect(container.textContent).toContain("Pending review");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Connect Google Contacts");
    expect(container.textContent).not.toContain("Sync Now");
    cleanup();
  });

  it("shows feed sync status without subscription management controls", async () => {
    const { container, cleanup } = await renderWithPlatform(
      createElement(PwaFeedsSettings),
      facetSummary({
        enabledRssFeedCount: 1,
        latestRssFeedFetchedAt: 1_774_389_150_000,
        platformCounts: [{
          archivableCount: 0,
          latestCapturedAt: 1_774_389_200_000,
          latestPublishedAt: 1_774_389_140_000,
          platform: "rss",
          totalCount: 2,
          unreadCount: 1,
        }],
        rssFeedCount: 1,
        totalCount: 2,
        unreadCount: 1,
      }),
    );

    expect(container.textContent).toContain("Feed subscriptions are managed in Freed Desktop");
    expect(container.textContent).toContain("Synced feeds");
    expect(container.textContent).toContain("Synced items");
    expect(container.textContent).toContain("Unread");
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).not.toContain("Add Feed");
    expect(container.textContent).not.toContain("Subscribe");
    expect(container.textContent).not.toContain("Download OPML");
    expect(container.textContent).not.toContain("Remove");
    cleanup();
  });
});
