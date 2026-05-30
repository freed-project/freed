import {
  generateSampleLibraryData,
  hasSampleDataFingerprint,
} from "@freed/shared";
import type { BaseAppState, SampleDataClearSummary } from "@freed/shared";

interface SampleSeedActions {
  initialize: BaseAppState["initialize"];
  isInitialized: boolean;
  addFeed: BaseAppState["addFeed"];
  addItems: BaseAppState["addItems"];
  addFriends: BaseAppState["addFriends"];
  seedSocialConnections?: () => void;
}

interface SampleClearState {
  items: BaseAppState["items"];
  feeds: BaseAppState["feeds"];
  persons: BaseAppState["persons"];
  accounts: BaseAppState["accounts"];
}

export function summarizeSampleData(state: SampleClearState): SampleDataClearSummary {
  const feeds = Object.values(state.feeds).filter(hasSampleDataFingerprint).length;
  const items = state.items.filter(hasSampleDataFingerprint).length;
  const persons = Object.values(state.persons).filter(hasSampleDataFingerprint).length;
  const accounts = Object.values(state.accounts).filter(hasSampleDataFingerprint).length;
  return {
    feeds,
    items,
    persons,
    accounts,
    total: feeds + items + persons + accounts,
  };
}

export function formatSampleDataSummary(summary: SampleDataClearSummary): string {
  return `${summary.feeds.toLocaleString()} feeds, ${summary.items.toLocaleString()} items, ${summary.persons.toLocaleString()} people, and ${summary.accounts.toLocaleString()} accounts`;
}

export async function refreshSampleLibraryData({
  initialize,
  isInitialized,
  addFeed,
  addItems,
  addFriends,
  seedSocialConnections,
}: SampleSeedActions): Promise<void> {
  if (!isInitialized) {
    await initialize();
  }

  const { feeds: sampleFeeds, items: sampleItems, friends: sampleFriends } =
    generateSampleLibraryData();

  for (const feed of sampleFeeds) {
    await addFeed(feed);
  }
  await addItems(sampleItems);
  await addFriends(sampleFriends);

  seedSocialConnections?.();
}
