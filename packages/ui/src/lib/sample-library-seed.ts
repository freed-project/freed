import { generateSampleLibraryData } from "@freed/shared";
import type { BaseAppState } from "@freed/shared";

interface SampleSeedActions {
  initialize: BaseAppState["initialize"];
  isInitialized: boolean;
  addFeed: BaseAppState["addFeed"];
  addItems: BaseAppState["addItems"];
  addFriends: BaseAppState["addFriends"];
  seedSocialConnections?: () => void;
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
