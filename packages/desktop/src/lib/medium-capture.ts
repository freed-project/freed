import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Account, FeedItem } from "@freed/shared";
import type { RawMediumEntry, RawMediumProfile } from "@freed/capture-medium/browser";
import {
  deduplicateAccounts,
  deduplicateFeedItems,
  mediumEntriesToFeedItems,
  mediumProfilesToAccounts,
} from "@freed/capture-medium/browser";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { formatBytesForMemoryLog, prepareSocialScrapeMemory } from "./memory-monitor";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { getMediumScraperWindowMode } from "./scraper-prefs";
import { socialProviderCopy } from "./social-provider-copy";
import { storeMediumAuthState } from "./medium-auth";
import { useAppStore } from "./store";

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const INTERVAL_JITTER_MS = 6 * 60 * 1000;
let lastScrapeAt = 0;

export interface MediumSyncDiag {
  entriesExtracted: number;
  profilesExtracted: number;
  itemsNormalized: number;
  accountsNormalized: number;
  itemsDeduplicated: number;
  accountsDeduplicated: number;
  itemsAdded: number;
  accountsAdded: number;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface MediumSyncResult {
  items: FeedItem[];
  accounts: Account[];
  diag: MediumSyncDiag;
}

function emptyResult(): MediumSyncResult {
  return {
    items: [],
    accounts: [],
    diag: {
      entriesExtracted: 0,
      profilesExtracted: 0,
      itemsNormalized: 0,
      accountsNormalized: 0,
      itemsDeduplicated: 0,
      accountsDeduplicated: 0,
      itemsAdded: 0,
      accountsAdded: 0,
      errorStage: null,
      errorMessage: null,
    },
  };
}

function isRateLimited(): boolean {
  if (lastScrapeAt === 0) return false;
  return Date.now() - lastScrapeAt < MIN_INTERVAL_MS + Math.random() * INTERVAL_JITTER_MS;
}

async function fetchMediumData(): Promise<MediumSyncResult> {
  const result = emptyResult();
  const diag = result.diag;

  const memoryPrep = await prepareSocialScrapeMemory("medium", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("medium").memoryPressure} ` +
      `App RSS is ${formatBytesForMemoryLog(memoryPrep.after.appResidentBytes)} after cleanup.`;
    return result;
  }

  let unlisten: UnlistenFn | null = null;
  const rawEntries: RawMediumEntry[] = [];
  const rawProfiles: RawMediumProfile[] = [];

  try {
    unlisten = await listen<{
      entries?: RawMediumEntry[];
      profiles?: RawMediumProfile[];
      error?: string;
      candidateCount?: number;
      done?: boolean;
    }>("medium-feed-data", (event) => {
      const { entries = [], profiles = [], error, candidateCount, done } = event.payload;
      addDebugEvent(
        "change",
        `[Medium] extraction pass: candidates=${candidateCount ?? "?"}, entries=${entries.length.toLocaleString()}, profiles=${profiles.length.toLocaleString()}${done ? " final" : ""}`,
      );
      if (error) {
        diag.errorStage = "extract";
        diag.errorMessage = error;
        return;
      }
      rawEntries.push(...entries);
      rawProfiles.push(...profiles);
    });

    const windowMode = getMediumScraperWindowMode();
    await invoke("medium_scrape_graph", { windowMode });
    await invoke("medium_scrape_activity", { windowMode });
    await invoke("medium_scrape_essays", { windowMode });
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  } catch (error) {
    diag.errorStage = "invoke";
    diag.errorMessage = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    unlisten?.();
  }

  if (diag.errorStage) return result;

  diag.entriesExtracted = rawEntries.length;
  diag.profilesExtracted = rawProfiles.length;

  try {
    const normalizedItems = mediumEntriesToFeedItems(rawEntries);
    const normalizedAccounts = mediumProfilesToAccounts(rawProfiles);
    diag.itemsNormalized = normalizedItems.length;
    diag.accountsNormalized = normalizedAccounts.length;
    result.items = deduplicateFeedItems(normalizedItems);
    result.accounts = deduplicateAccounts(normalizedAccounts);
    diag.itemsDeduplicated = result.items.length;
    diag.accountsDeduplicated = result.accounts.length;
    return result;
  } catch (error) {
    diag.errorStage = "normalize";
    diag.errorMessage = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export async function captureMediumFeed(): Promise<MediumSyncResult> {
  const startedAt = Date.now();
  const pause = getProviderPause("medium");
  if (pause) {
    addDebugEvent("change", `[Medium] paused until ${formatClockTime(pause.pausedUntil)}`);
    return {
      ...emptyResult(),
      diag: { ...emptyResult().diag, errorStage: "provider_rate_limit", errorMessage: pause.pauseReason },
    };
  }

  if (isRateLimited()) {
    const minutesRemaining = Math.ceil((MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000);
    const message = `Cooling down. Try again in ~${minutesRemaining.toLocaleString()} minutes.`;
    await recordProviderHealthEvent({
      provider: "medium",
      outcome: "cooldown",
      stage: "cooldown",
      reason: message,
      startedAt,
      finishedAt: Date.now(),
    });
    return { ...emptyResult(), diag: { ...emptyResult().diag, errorStage: "cooldown", errorMessage: message } };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    addDebugEvent("change", "[Medium] sync started");
    const result = await fetchMediumData();
    if (result.diag.errorStage) {
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      const authState = { ...useAppStore.getState().mediumAuth, lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage };
      store.setMediumAuth(authState);
      storeMediumAuthState(authState);
      await recordProviderHealthEvent({
        provider: "medium",
        outcome: "error",
        stage: result.diag.errorStage,
        reason: result.diag.errorMessage ?? result.diag.errorStage,
        startedAt,
        finishedAt: Date.now(),
        itemsSeen: result.diag.entriesExtracted,
        itemsAdded: result.diag.itemsAdded,
      });
      return result;
    }

    lastScrapeAt = Date.now();
    const beforeItems = store.items.filter((item) => item.platform === "medium").length;
    const beforeAccounts = Object.keys(store.accounts).length;
    if (result.items.length > 0) await store.addItems(result.items);
    if (result.accounts.length > 0) await store.addAccounts(result.accounts);
    result.diag.itemsAdded = Math.max(0, useAppStore.getState().items.filter((item) => item.platform === "medium").length - beforeItems);
    result.diag.accountsAdded = Math.max(0, Object.keys(useAppStore.getState().accounts).length - beforeAccounts);

    const authState = { ...useAppStore.getState().mediumAuth, lastCapturedAt: Date.now(), lastCaptureError: undefined };
    store.setMediumAuth(authState);
    storeMediumAuthState(authState);
    await recordProviderHealthEvent({
      provider: "medium",
      outcome: result.diag.entriesExtracted + result.diag.profilesExtracted > 0 ? "success" : "empty",
      stage: result.diag.entriesExtracted + result.diag.profilesExtracted > 0 ? undefined : "empty",
      reason: result.diag.entriesExtracted + result.diag.profilesExtracted > 0 ? undefined : "No visible Medium records pulled",
      startedAt,
      finishedAt: Date.now(),
      itemsSeen: result.diag.entriesExtracted + result.diag.profilesExtracted,
      itemsAdded: result.diag.itemsAdded + result.diag.accountsAdded,
    });
    return result;
  } finally {
    store.setLoading(false);
  }
}
