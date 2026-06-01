import { useCallback, useMemo, useState } from "react";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
} from "@freed/shared";
import {
  formatSampleDataSummary,
  refreshSampleLibraryData,
  summarizeSampleData,
} from "../lib/sample-library-seed.js";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { toast } from "./Toast.js";

export function SampleDataTestingSection() {
  const initialize = useAppStore((s) => s.initialize);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const addFeed = useAppStore((s) => s.addFeed);
  const addItems = useAppStore((s) => s.addItems);
  const addFriends = useAppStore((s) => s.addFriends);
  const clearSampleData = useAppStore((s) => s.clearSampleData);
  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const { seedSocialConnections } = usePlatform();

  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const sampleDataSummary = useMemo(
    () => summarizeSampleData({ items, feeds, persons, accounts }),
    [accounts, feeds, items, persons],
  );
  const hasSampleData = sampleDataSummary.total > 0;

  const handleSeedSampleData = useCallback(async () => {
    setSeeding(true);
    toast.info("Populating sample data...");
    try {
      await refreshSampleLibraryData({
        initialize,
        isInitialized,
        addFeed,
        addItems,
        addFriends,
        seedSocialConnections,
      });
      setSeedDone(true);
      toast.success(
        `Sample data added: ${SAMPLE_SHOWCASE_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SHOWCASE_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SHOWCASE_FRIEND_COUNT.toLocaleString()} friends, and ${SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT.toLocaleString()} social identities.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to populate sample data");
    } finally {
      setSeeding(false);
    }
  }, [
    addFeed,
    addFriends,
    addItems,
    initialize,
    isInitialized,
    seedSocialConnections,
  ]);

  const handleClearSampleData = useCallback(async () => {
    setClearing(true);
    toast.info("Clearing sample data...");
    try {
      const summary = await clearSampleData();
      setSeedDone(false);
      setConfirmClear(false);
      toast.success(`Sample data cleared: ${formatSampleDataSummary(summary)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear sample data");
    } finally {
      setClearing(false);
    }
  }, [clearSampleData]);

  return (
    <div className="mt-10 flex w-full max-w-xl flex-col items-center">
      <div className="mb-7 h-px w-32 bg-[color:color-mix(in_srgb,var(--theme-border-subtle)_88%,transparent)]" />
      <p className="text-center text-sm font-medium text-[var(--theme-text-muted)]">
        Alternatively, for preview &amp; testing:
      </p>
      <button
        type="button"
        onClick={handleSeedSampleData}
        disabled={seeding}
        className="theme-accent-button mt-7 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9L5 15z" />
        </svg>
        <span>
          {seedDone ? "Add more sample data" : seeding ? "Populating..." : "Populate sample data"}
        </span>
      </button>
      {hasSampleData && (
        <div className="mt-4 flex w-full flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={clearing}
            className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--theme-border)] px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>{clearing ? "Clearing..." : "Clear sample data"}</span>
          </button>
          {confirmClear && (
            <div className="theme-feedback-panel-danger w-full rounded-xl px-4 py-3 text-left">
              <p className="theme-feedback-text-danger text-xs leading-5">
                Remove {formatSampleDataSummary(sampleDataSummary)}?
              </p>
              <p className="mt-1 text-xs leading-5 text-[rgb(var(--theme-feedback-danger-rgb)/0.72)]">
                Only internally marked sample records will be removed.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearing}
                  className="flex-1 rounded-lg border border-[color:var(--theme-border)] px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:text-text-primary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleClearSampleData();
                  }}
                  disabled={clearing}
                  className="theme-feedback-button-danger flex-1 px-3 py-2 text-xs disabled:opacity-50"
                >
                  Clear sample data
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
