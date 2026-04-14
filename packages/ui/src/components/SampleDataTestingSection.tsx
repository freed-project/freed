import { useCallback, useState } from "react";
import { refreshSampleLibraryData } from "../lib/sample-library-seed.js";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { toast } from "./Toast.js";

const SAMPLE_SEED_FEED_COUNT = 10;
const SAMPLE_SEED_ITEM_COUNT = 155;
const SAMPLE_SEED_FRIEND_COUNT = 25;

export function SampleDataTestingSection() {
  const initialize = useAppStore((s) => s.initialize);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const addFeed = useAppStore((s) => s.addFeed);
  const addItems = useAppStore((s) => s.addItems);
  const addFriends = useAppStore((s) => s.addFriends);
  const { seedSocialConnections } = usePlatform();

  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

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
        `Sample data added: ${SAMPLE_SEED_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SEED_ITEM_COUNT.toLocaleString()} items, and ${SAMPLE_SEED_FRIEND_COUNT.toLocaleString()} friends.`,
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

  return (
    <div className="mt-8 flex w-full max-w-xl flex-col items-center gap-4">
      <div className="h-px w-32 bg-[color:color-mix(in_srgb,var(--theme-border-subtle)_88%,transparent)]" />
      <p className="text-center text-xs text-[var(--theme-text-soft)]">
        Alternatively, if you&apos;re just testing:
      </p>
      <button
        type="button"
        onClick={handleSeedSampleData}
        disabled={seeding}
        className="theme-warning-panel w-full rounded-2xl px-5 py-4 text-left transition-colors hover:bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_100%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-lg font-medium text-[var(--theme-text-primary)]">
              {seedDone ? "Add more sample data" : seeding ? "Populating..." : "Populate sample data"}
            </p>
            <p className="mt-1 text-sm text-[var(--theme-text-muted)]">
              Adds {SAMPLE_SEED_FEED_COUNT.toLocaleString()} RSS feeds, {SAMPLE_SEED_ITEM_COUNT.toLocaleString()} items, {SAMPLE_SEED_FRIEND_COUNT.toLocaleString()} friends, and location-linked social data
            </p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-[var(--theme-text-soft)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
    </div>
  );
}
