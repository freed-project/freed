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
  SampleDataClearProgress,
  SampleDataClearProgressListener,
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

interface SampleClearActions {
  clearSampleData: BaseAppState["clearSampleData"];
  onProgress?: SampleDataClearProgressListener;
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

const SAMPLE_DATA_CLEAR_PHASE_LABELS: Record<
  SampleDataClearProgress["phase"],
  string
> = {
  accounts: "Removing social identities",
  complete: "Sample cleanup complete",
  feeds: "Removing feeds",
  items: "Removing items",
  people: "Removing people",
  preparing: "Preparing sample cleanup",
  settling: "Finalizing Library",
};

function samplePresentationSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0]!;
}

export function formatSampleDataImportProgress(
  progress: SampleDataImportProgress,
): string {
  return `${SAMPLE_DATA_PHASE_LABELS[progress.phase]}: ${progress.percent.toLocaleString()}%`;
}

export function formatSampleDataSummary(summary: SampleDataClearSummary): string {
  const count = (value: number, singular: string, plural = `${singular}s`) =>
    `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
  return `${count(summary.feeds, "feed")}, ${count(summary.items, "item")}, ${count(summary.persons, "person", "people")}, and ${count(summary.accounts, "account")}`;
}

export function formatSampleDataClearProgress(
  progress: SampleDataClearProgress,
): string {
  return `${SAMPLE_DATA_CLEAR_PHASE_LABELS[progress.phase]}: ${progress.percent.toLocaleString()}%`;
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

  await addSampleLibraryData(generateSampleLibraryData({
    presentationSeed: samplePresentationSeed(),
  }), onProgress);

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

export async function clearSampleLibraryDataWithProgressToast({
  clearSampleData,
  onProgress,
}: SampleClearActions): Promise<SampleDataClearSummary> {
  const progressToastId = toast.info("Preparing sample cleanup: 0%", {
    durationMs: null,
  });
  try {
    const summary = await clearSampleData((progress) => {
      onProgress?.(progress);
      toast.update(progressToastId, formatSampleDataClearProgress(progress));
    });
    toast.update(
      progressToastId,
      `Sample data cleared: ${(100).toLocaleString()}%. ${formatSampleDataSummary(summary)}.`,
      "success",
      4000,
    );
    return summary;
  } catch (error) {
    toast.update(
      progressToastId,
      error instanceof Error ? error.message : "Failed to clear sample data",
      "error",
      4000,
    );
    throw error;
  }
}
