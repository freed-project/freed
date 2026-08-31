import {
  generateSampleLibraryData,
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
} from "@freed/shared";
import type {
  BaseAppState,
  SampleDataClearSummary,
  SampleDataImportProgress,
  SampleDataImportProgressListener,
} from "@freed/shared";
import { toast } from "../components/Toast.js";

interface SampleSeedActions {
  initialize: BaseAppState["initialize"];
  isInitialized: boolean;
  addSampleLibraryData: BaseAppState["addSampleLibraryData"];
  onProgress?: SampleDataImportProgressListener;
  seedSocialConnections?: () => void;
}

const SAMPLE_DATA_PHASE_LABELS: Record<SampleDataImportProgress["phase"], string> = {
  accounts: "Adding social identities",
  analysis: "Adding item analysis",
  annotations: "Adding item details",
  feeds: "Adding feeds",
  finalizing: "Finalizing Library",
  items: "Adding items",
  people: "Adding people",
  preparing: "Preparing Library",
};

export function formatSampleDataImportProgress(
  progress: SampleDataImportProgress,
): string {
  return `${SAMPLE_DATA_PHASE_LABELS[progress.phase]}: ${progress.percent.toLocaleString()}%`;
}

export function formatSampleDataSummary(summary: SampleDataClearSummary): string {
  return `${summary.feeds.toLocaleString()} feeds, ${summary.items.toLocaleString()} items, ${summary.persons.toLocaleString()} people, and ${summary.accounts.toLocaleString()} accounts`;
}

export async function refreshSampleLibraryData({
  initialize,
  isInitialized,
  addSampleLibraryData,
  onProgress,
  seedSocialConnections,
}: SampleSeedActions): Promise<void> {
  onProgress?.({ percent: 0, phase: "preparing" });
  if (!isInitialized) {
    await initialize();
  }

  await addSampleLibraryData(generateSampleLibraryData(), onProgress);

  seedSocialConnections?.();
}

export async function populateSampleLibraryDataWithProgressToast(
  actions: SampleSeedActions,
): Promise<void> {
  const progressToastId = toast.info("Preparing Library: 0%", {
    durationMs: null,
  });
  try {
    await refreshSampleLibraryData({
      ...actions,
      onProgress: (progress) => {
        actions.onProgress?.(progress);
        toast.update(
          progressToastId,
          formatSampleDataImportProgress(progress),
        );
      },
    });
    toast.update(
      progressToastId,
      `Sample data added: ${(100).toLocaleString()}%. ${SAMPLE_SHOWCASE_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SHOWCASE_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SHOWCASE_FRIEND_COUNT.toLocaleString()} friends, and ${SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT.toLocaleString()} social identities.`,
      "success",
      4000,
    );
  } catch (error) {
    toast.update(
      progressToastId,
      error instanceof Error ? error.message : "Failed to populate sample data",
      "error",
      4000,
    );
    throw error;
  }
}
