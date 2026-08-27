import {
  generateSampleLibraryData,
} from "@freed/shared";
import type { BaseAppState, SampleDataClearSummary } from "@freed/shared";

interface SampleSeedActions {
  initialize: BaseAppState["initialize"];
  isInitialized: boolean;
  addSampleLibraryData: BaseAppState["addSampleLibraryData"];
  seedSocialConnections?: () => void;
}

export function formatSampleDataSummary(summary: SampleDataClearSummary): string {
  return `${summary.feeds.toLocaleString()} feeds, ${summary.items.toLocaleString()} items, ${summary.persons.toLocaleString()} people, and ${summary.accounts.toLocaleString()} accounts`;
}

export async function refreshSampleLibraryData({
  initialize,
  isInitialized,
  addSampleLibraryData,
  seedSocialConnections,
}: SampleSeedActions): Promise<void> {
  if (!isInitialized) {
    await initialize();
  }

  await addSampleLibraryData(generateSampleLibraryData());

  seedSocialConnections?.();
}
