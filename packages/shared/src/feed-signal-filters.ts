import type { FilterOptions } from "./store-types.js";
import type { ContentSignal, DisplayPreferences, FeedSignalMode } from "./types.js";

export interface FeedSignalFilterPreset {
  mode: FeedSignalMode;
  label: string;
  description: string;
  signals: readonly ContentSignal[];
}

export const FEED_SIGNAL_FILTER_PRESETS: readonly FeedSignalFilterPreset[] = [
  {
    mode: "all",
    label: "Everything",
    description: "Show every visible item.",
    signals: [],
  },
  {
    mode: "inspiring",
    label: "Inspiring",
    description: "Essays, guides, references, recommendations, and memorable moments.",
    signals: ["essay", "how_to", "reference", "recommendation", "moment"],
  },
  {
    mode: "events",
    label: "Events",
    description: "Events, deadlines, opportunities, and time-bound offers.",
    signals: ["event", "deadline", "opportunity", "deal", "promotion"],
  },
  {
    mode: "personal",
    label: "Personal",
    description: "Life updates and social moments.",
    signals: ["life_update", "moment"],
  },
  {
    mode: "conversation",
    label: "Conversation",
    description: "Requests, questions, and discussion threads.",
    signals: ["request", "discussion"],
  },
  {
    mode: "news",
    label: "News",
    description: "Reported stories, alerts, product updates, and news analysis.",
    signals: ["news", "alert", "product_update"],
  },
] as const;

const ALL_FEED_SIGNAL_MODES = new Set<FeedSignalMode>(
  FEED_SIGNAL_FILTER_PRESETS.map((preset) => preset.mode),
);
const SELECTABLE_FEED_SIGNAL_MODES = new Set<FeedSignalMode>(
  FEED_SIGNAL_FILTER_PRESETS
    .filter((preset) => preset.mode !== "all")
    .map((preset) => preset.mode),
);

function signalKey(signals: readonly ContentSignal[] | undefined): string {
  return [...(signals ?? [])].sort().join(",");
}

export function normalizeFeedSignalMode(mode: FeedSignalMode | undefined): FeedSignalMode {
  return mode && ALL_FEED_SIGNAL_MODES.has(mode) ? mode : "all";
}

export function normalizeFeedSignalModes(
  modes: readonly FeedSignalMode[] | undefined,
): FeedSignalMode[] {
  if (!modes?.length) return [];
  const unique = new Set<FeedSignalMode>();
  for (const mode of modes) {
    if (SELECTABLE_FEED_SIGNAL_MODES.has(mode)) {
      unique.add(mode);
    }
  }
  return [...unique];
}

export function getFeedSignalFilterPreset(
  mode: FeedSignalMode | undefined,
): FeedSignalFilterPreset {
  const normalized = normalizeFeedSignalMode(mode);
  return FEED_SIGNAL_FILTER_PRESETS.find((preset) => preset.mode === normalized)
    ?? FEED_SIGNAL_FILTER_PRESETS[0]!;
}

export function getFeedSignalModeForFilter(filter: FilterOptions): FeedSignalMode | "custom" {
  const signals = filter.signals ?? [];
  if (signals.length === 0) return "all";

  const activeKey = signalKey(signals);
  const preset = FEED_SIGNAL_FILTER_PRESETS.find(
    (candidate) => signalKey(candidate.signals) === activeKey,
  );
  return preset?.mode ?? "custom";
}

export function resolveFeedSignalModesFromDisplay(
  display: Pick<DisplayPreferences, "feedSignalMode" | "feedSignalModes">,
): FeedSignalMode[] {
  const modes = normalizeFeedSignalModes(display.feedSignalModes);
  if (modes.length > 0) return modes;
  const legacyMode = normalizeFeedSignalMode(display.feedSignalMode);
  return legacyMode === "all" ? [] : [legacyMode];
}

export function getSignalsForFeedSignalModes(
  modes: readonly FeedSignalMode[] | undefined,
): ContentSignal[] {
  const selectedModes = normalizeFeedSignalModes(modes);
  const signals = new Set<ContentSignal>();
  for (const mode of selectedModes) {
    const preset = getFeedSignalFilterPreset(mode);
    for (const signal of preset.signals) {
      signals.add(signal);
    }
  }
  return [...signals];
}

export function applyFeedSignalModeToFilter(
  filter: FilterOptions,
  mode: FeedSignalMode | undefined,
): FilterOptions {
  const preset = getFeedSignalFilterPreset(mode);
  const next: FilterOptions = { ...filter };
  if (preset.signals.length === 0) {
    delete next.signals;
  } else {
    next.signals = [...preset.signals];
  }
  return next;
}

export function applyFeedSignalModesToFilter(
  filter: FilterOptions,
  modes: readonly FeedSignalMode[] | undefined,
): FilterOptions {
  const next: FilterOptions = { ...filter };
  const signals = getSignalsForFeedSignalModes(modes);
  if (signals.length === 0) {
    delete next.signals;
  } else {
    next.signals = signals;
  }
  return next;
}
