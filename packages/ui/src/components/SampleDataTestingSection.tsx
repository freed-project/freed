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
    </div>
  );
}
