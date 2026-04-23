import type { FilterOptions, FeedItem, Platform } from "@freed/shared";
import { PLATFORM_LABELS } from "@freed/shared";
import { toast } from "../components/Toast.js";
import type { AvailableUpdateInfo } from "../context/PlatformContext.js";
import type { CommandPaletteAction } from "./command-palette.js";
import type { SectionMeta } from "./settings-sections.js";

interface TagFilter {
  label: string;
  tags: string[];
}

interface FeedDestination {
  url: string;
  title: string;
}

interface SourceDestination {
  id: Platform | undefined;
  label: string;
}

interface BuildCommandPaletteActionsOptions {
  query: string;
  activeView: "feed" | "friends" | "map";
  activeFilter: FilterOptions;
  settingsSections: readonly SectionMeta[];
  topSources: readonly SourceDestination[];
  feeds: readonly FeedDestination[];
  tagFilters: readonly TagFilter[];
  currentSourceId: Platform | null;
  selectedItem: FeedItem | null;
  unreadScopeCount: number;
  archivableScopeCount: number;
  savedArchivedCount: number;
  archivedCount: number;
  openSettingsTo: (id: string) => void;
  navigateToFeed: (filter: FilterOptions) => void;
  navigateToFriends: () => void;
  navigateToMap: () => void;
  applyFeedSearch: (query: string) => void;
  openAddFeedDialog?: (() => void) | null;
  openSavedContentDialog?: (() => void) | null;
  openImportLibraryDialog?: (() => void) | null;
  openExportLibraryDialog?: (() => void) | null;
  openCurrentItemUrl?: (() => void) | null;
  closeReader?: (() => void) | null;
  toggleCurrentItemSaved?: (() => void | Promise<void>) | null;
  toggleCurrentItemArchived?: (() => void | Promise<void>) | null;
  toggleCurrentItemLiked?: (() => void | Promise<void>) | null;
  markScopeRead?: (() => void | Promise<void>) | null;
  archiveScopeRead?: (() => void | Promise<void>) | null;
  unarchiveSavedItems?: (() => void | Promise<void>) | null;
  syncRssNow?: (() => Promise<void>) | null;
  syncCurrentSource?: ((sourceId: string) => Promise<void>) | null;
  checkForUpdates?: (() => Promise<AvailableUpdateInfo | null>) | null;
  deleteAllArchived?: (() => void | Promise<void>) | null;
  factoryReset?: ((deleteFromCloud: boolean) => Promise<void>) | null;
  activeCloudProviderLabel?: (() => string | null) | null;
}

async function runWithToast(
  runner: () => void | Promise<void>,
  successMessage?: string,
  errorMessage = "Action failed",
) {
  try {
    await runner();
    if (successMessage) toast.success(successMessage);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : errorMessage);
    throw error;
  }
}

function currentSourceLabel(sourceId: Platform | null): string | null {
  return sourceId ? PLATFORM_LABELS[sourceId] ?? sourceId.toLocaleUpperCase() : null;
}

export function buildCommandPaletteActions({
  query,
  activeView,
  activeFilter: _activeFilter,
  settingsSections,
  topSources,
  feeds,
  tagFilters,
  currentSourceId,
  selectedItem,
  unreadScopeCount,
  archivableScopeCount,
  savedArchivedCount,
  archivedCount,
  openSettingsTo,
  navigateToFeed,
  navigateToFriends,
  navigateToMap,
  applyFeedSearch,
  openAddFeedDialog,
  openSavedContentDialog,
  openImportLibraryDialog,
  openExportLibraryDialog,
  openCurrentItemUrl,
  closeReader,
  toggleCurrentItemSaved,
  toggleCurrentItemArchived,
  toggleCurrentItemLiked,
  markScopeRead,
  archiveScopeRead,
  unarchiveSavedItems,
  syncRssNow,
  syncCurrentSource,
  checkForUpdates,
  deleteAllArchived,
  factoryReset,
  activeCloudProviderLabel,
}: BuildCommandPaletteActionsOptions): CommandPaletteAction[] {
  const actions: CommandPaletteAction[] = [
    {
      id: "go-unified-feed",
      title: "Unified Feed",
      section: "Go to",
      keywords: ["all", "feed", "timeline", "home"],
      run: () => navigateToFeed({}),
    },
    {
      id: "go-saved",
      title: "Saved",
      section: "Go to",
      keywords: ["bookmarks", "reading list", "saved items"],
      run: () => navigateToFeed({ savedOnly: true }),
    },
    {
      id: "go-archived",
      title: "Archived",
      section: "Go to",
      keywords: ["archive", "archived items", "history"],
      run: () => navigateToFeed({ archivedOnly: true }),
    },
    {
      id: "go-friends",
      title: "Friends",
      section: "Go to",
      keywords: ["people", "social graph", "contacts"],
      run: navigateToFriends,
    },
    {
      id: "go-map",
      title: "Map",
      section: "Go to",
      keywords: ["locations", "places", "travel"],
      run: navigateToMap,
    },
    ...(openAddFeedDialog
      ? [{
      id: "create-add-rss",
      title: "Add RSS Feed",
      section: "Create",
      keywords: ["rss", "feed", "subscribe", "source"],
      run: openAddFeedDialog,
    }]
      : []),
    ...(openSavedContentDialog
      ? [{
      id: "create-save-url",
      title: "Save URL",
      section: "Create",
      keywords: ["save", "bookmark", "article", "url"],
      run: openSavedContentDialog,
    }]
      : []),
    ...(openImportLibraryDialog
      ? [{
      id: "create-import-markdown",
      title: "Import Freed Markdown",
      section: "Create",
      keywords: ["import", "markdown", "archive", "library"],
      run: openImportLibraryDialog,
    }]
      : []),
    ...(openExportLibraryDialog
      ? [{
      id: "create-export-markdown",
      title: "Export Freed Markdown",
      section: "Create",
      keywords: ["export", "markdown", "backup", "library"],
      run: openExportLibraryDialog,
    }]
      : []),
  ];

  for (const source of topSources) {
    actions.push({
      id: `go-source-${source.id ?? "all"}`,
      title: source.label,
      section: "Go to",
      keywords: [source.label.toLocaleLowerCase(), "source", "platform"],
      entity: true,
      run: () => navigateToFeed(source.id ? { platform: source.id } : {}),
    });
  }

  for (const feed of feeds) {
    actions.push({
      id: `go-feed-${feed.url}`,
      title: feed.title,
      section: "Go to",
      keywords: [feed.url.toLocaleLowerCase(), "feed", "rss", feed.title.toLocaleLowerCase()],
      entity: true,
      run: () => navigateToFeed({ platform: "rss", feedUrl: feed.url }),
    });
  }

  for (const tagFilter of tagFilters) {
    actions.push({
      id: `go-tag-${tagFilter.label}`,
      title: tagFilter.label,
      section: "Go to",
      keywords: ["tag", tagFilter.label.toLocaleLowerCase()],
      entity: true,
      run: () => navigateToFeed({ tags: tagFilter.tags }),
    });
  }

  for (const section of settingsSections) {
    actions.push({
      id: `go-settings-${section.id}`,
      title: section.label,
      section: "Go to",
      keywords: section.keywords,
      entity: true,
      run: () => openSettingsTo(section.id),
    });
  }

  if (selectedItem) {
    if (openCurrentItemUrl && selectedItem.sourceUrl) {
      actions.push({
        id: "item-open-original",
        title: "Open original URL",
        section: "Current item",
        keywords: ["open", "source", "browser", "original"],
        run: openCurrentItemUrl,
      });
    }
    if (closeReader) {
      actions.push({
        id: "item-close-reader",
        title: "Close reader",
        section: "Current item",
        keywords: ["close", "reader", "back"],
        run: closeReader,
      });
    }
    if (toggleCurrentItemSaved) {
      actions.push({
        id: "item-toggle-saved",
        title: selectedItem.userState.saved ? "Unsave current item" : "Save current item",
        section: "Current item",
        keywords: ["save", "unsave", "bookmark"],
        run: () => toggleCurrentItemSaved(),
      });
    }
    if (toggleCurrentItemArchived) {
      actions.push({
        id: "item-toggle-archived",
        title: selectedItem.userState.archived ? "Unarchive current item" : "Archive current item",
        section: "Current item",
        keywords: ["archive", "unarchive", "hide"],
        run: () => toggleCurrentItemArchived(),
      });
    }
    if (toggleCurrentItemLiked) {
      actions.push({
        id: "item-toggle-liked",
        title: selectedItem.userState.liked ? "Unlike current item" : "Like current item",
        section: "Current item",
        keywords: ["like", "unlike", "favorite", "heart"],
        run: () => toggleCurrentItemLiked(),
      });
    }
  }

  if (markScopeRead && unreadScopeCount > 0) {
    actions.push({
      id: "scope-mark-read",
      title: "Mark current scope read",
      section: "Current scope",
      keywords: ["mark read", "unread", "scope"],
      run: () =>
        runWithToast(
          () => markScopeRead(),
          `${unreadScopeCount.toLocaleString()} item${unreadScopeCount === 1 ? "" : "s"} marked read`,
        ),
    });
  }

  if (archiveScopeRead && archivableScopeCount > 0) {
    actions.push({
      id: "scope-archive-read",
      title: "Archive current scope read items",
      section: "Current scope",
      keywords: ["archive", "read", "scope"],
      run: () =>
        runWithToast(
          () => archiveScopeRead(),
          `${archivableScopeCount.toLocaleString()} item${archivableScopeCount === 1 ? "" : "s"} archived`,
        ),
    });
  }

  if (unarchiveSavedItems && savedArchivedCount > 0) {
    actions.push({
      id: "scope-unarchive-saved",
      title: "Unarchive saved items",
      section: "Current scope",
      keywords: ["unarchive", "saved", "repair"],
      run: () =>
        runWithToast(
          () => unarchiveSavedItems(),
          "Saved items restored to the library",
        ),
    });
  }

  if (syncRssNow) {
    actions.push({
      id: "scope-sync-rss",
      title: "Sync RSS now",
      section: "Current scope",
      keywords: ["sync", "rss", "refresh"],
      run: () => runWithToast(() => syncRssNow(), "RSS sync started"),
    });
  }

  const sourceLabel = currentSourceLabel(currentSourceId);
  if (syncCurrentSource && currentSourceId && sourceLabel) {
    actions.push({
      id: `scope-sync-source-${currentSourceId}`,
      title: `Sync ${sourceLabel}`,
      section: "Current scope",
      keywords: ["sync", "refresh", currentSourceId, sourceLabel.toLocaleLowerCase()],
      run: () =>
        runWithToast(
          () => syncCurrentSource(currentSourceId),
          `${sourceLabel} sync started`,
        ),
    });
  }

  if (checkForUpdates) {
    actions.push({
      id: "scope-check-updates",
      title: "Check for updates",
      section: "Current scope",
      keywords: ["update", "version", "release"],
      run: async () => {
        try {
          const update = await checkForUpdates();
          if (update) {
            openSettingsTo("updates");
            toast.info(`Update ${update.version} is available`);
            return;
          }
          toast.success("Freed is up to date");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to check for updates");
          throw error;
        }
      },
    });
  }

  if (deleteAllArchived) {
    actions.push({
      id: "danger-delete-archived",
      title: "Delete all archived items",
      section: "Danger",
      keywords: ["delete", "archived", "danger"],
      availability: () => archivedCount > 0,
      confirm: {
        title: "Delete all archived items?",
        description: "Type DELETE to permanently remove archived, unsaved items from this library.",
        token: "DELETE",
        confirmLabel: "Delete archived items",
      },
      run: () =>
        runWithToast(
          () => deleteAllArchived(),
          "Archived items deleted",
        ),
    });
  }

  if (factoryReset) {
    actions.push({
      id: "danger-reset-device",
      title: "Factory reset this device",
      section: "Danger",
      keywords: ["reset", "wipe", "device", "danger"],
      confirm: {
        title: "Reset this device?",
        description: "Type RESET to wipe local data on this device and reload Freed.",
        token: "RESET",
        confirmLabel: "Reset device",
      },
      run: () => factoryReset(false),
    });

    const cloudProviderLabel = activeCloudProviderLabel?.();
    if (cloudProviderLabel) {
      actions.push({
        id: "danger-reset-cloud",
        title: `Factory reset this device and ${cloudProviderLabel}`,
        section: "Danger",
        keywords: ["reset", "wipe", "cloud", cloudProviderLabel.toLocaleLowerCase(), "danger"],
        confirm: {
          title: `Reset this device and ${cloudProviderLabel}?`,
          description: `Type RESET to wipe this device and permanently remove the ${cloudProviderLabel} backup.`,
          token: "RESET",
          confirmLabel: "Reset device and cloud backup",
        },
        run: () => factoryReset(true),
      });
    }
  }

  if (query.trim()) {
    actions.push({
      id: "search-feed",
      title:
        activeView === "feed"
          ? `Search current feed for "${query.trim()}"`
          : `Search feed for "${query.trim()}"`,
      section: "Search",
      keywords: [query.trim().toLocaleLowerCase(), "search", "feed"],
      fallback: true,
      run: () => applyFeedSearch(query.trim()),
    });
  }

  return actions;
}
