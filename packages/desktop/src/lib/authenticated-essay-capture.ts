import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Account, FeedItem } from "@freed/shared";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { docReconcileFollowRosterCapture } from "./automerge";
import { runBackgroundJob } from "./background-runtime-coordinator";
import {
  formatScrapeMemoryPressureDetails,
  prepareSocialScrapeMemory,
} from "./memory-monitor";
import { hasAcceptedProviderRisk } from "./legal-consent";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { recordScrapeOutcome, type SocialScrapeTrigger } from "./runtime-health-events";
import { safeUnlisten } from "./safe-unlisten";
import type { ScraperWindowMode } from "./scraper-prefs";
import {
  applyLockedSessionDeferredDiag,
  applyNativeMemoryPressureDiag,
  applyRuntimeDeferredDiag,
  isRuntimeDeferredStage,
  SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
  SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
  waitForSocialScrapeEvents,
} from "./social-capture-runtime";
import { socialProviderCopy } from "./social-provider-copy";
import { useAppStore } from "./store";
import type { AuthenticatedEssayAuthState } from "./authenticated-essay-auth";
import { getPlatformUA } from "./user-agent";

export type { AuthenticatedEssayAuthState } from "./authenticated-essay-auth";

export type AuthenticatedEssayProvider = "substack" | "medium";

export interface AuthenticatedEssaySyncDiag {
  entriesExtracted: number;
  profilesExtracted: number;
  itemsNormalized: number;
  accountsNormalized: number;
  itemsDeduplicated: number;
  accountsDeduplicated: number;
  itemsAdded: number;
  accountsAdded: number;
  extractionPasses: number;
  completedScopes: number;
  lastCandidateCount: number | null;
  lastUrl: string | null;
  capturedAt: number;
  errorStage: string | null;
  errorMessage: string | null;
  retryAfterMs?: number;
}

export interface AuthenticatedEssaySyncResult {
  items: FeedItem[];
  accounts: Account[];
  diag: AuthenticatedEssaySyncDiag;
}

interface ExtractionPayload<Entry, Profile> {
  entries?: Entry[];
  profiles?: Profile[];
  error?: string;
  extractedAt?: number;
  url?: string;
  candidateCount?: number;
  done?: boolean;
}

export interface AuthenticatedEssayCaptureConfig<Entry, Profile> {
  provider: AuthenticatedEssayProvider;
  eventName: "substack-feed-data" | "medium-feed-data";
  commands: readonly [string, string, string];
  getWindowMode: () => ScraperWindowMode;
  normalizeEntries: (entries: Entry[]) => FeedItem[];
  normalizeProfiles: (profiles: Profile[]) => Account[];
  deduplicateItems: (items: FeedItem[]) => FeedItem[];
  deduplicateAccounts: (accounts: Account[]) => Account[];
  getAuth: () => AuthenticatedEssayAuthState;
  setAuth: (auth: AuthenticatedEssayAuthState) => void;
  storeAuth: (auth: AuthenticatedEssayAuthState) => void;
}

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const INTERVAL_JITTER_MS = 6 * 60 * 1000;
const MAX_RAW_RECORDS = 2_000;
const COOLDOWN_STORAGE_PREFIX = "freed.capture-cooldown";
const cooldownUntil: Partial<Record<AuthenticatedEssayProvider, number>> = {};

function createEmptyResult(capturedAt = Date.now()): AuthenticatedEssaySyncResult {
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
      extractionPasses: 0,
      completedScopes: 0,
      lastCandidateCount: null,
      lastUrl: null,
      capturedAt,
      errorStage: null,
      errorMessage: null,
    },
  };
}

function resultWithError(
  stage: string,
  message: string,
): AuthenticatedEssaySyncResult {
  const result = createEmptyResult();
  result.diag.errorStage = stage;
  result.diag.errorMessage = message;
  return result;
}

function providerPrefix(provider: AuthenticatedEssayProvider): string {
  return provider === "substack" ? "Substack" : "Medium";
}

function cooldownStorageKey(provider: AuthenticatedEssayProvider): string {
  return `${COOLDOWN_STORAGE_PREFIX}.${provider}`;
}

function readStoredCooldown(provider: AuthenticatedEssayProvider): number {
  try {
    const deadline = Number(localStorage.getItem(cooldownStorageKey(provider)));
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      localStorage.removeItem(cooldownStorageKey(provider));
      return 0;
    }
    return deadline;
  } catch {
    return 0;
  }
}

function storeCooldown(provider: AuthenticatedEssayProvider, deadline: number): void {
  try {
    localStorage.setItem(cooldownStorageKey(provider), deadline.toString());
  } catch {
    // The in-memory and auth-state deadlines still protect this app session.
  }
}

function markCooldown(provider: AuthenticatedEssayProvider): number {
  const deadline = Date.now() + MIN_INTERVAL_MS + Math.floor(Math.random() * INTERVAL_JITTER_MS);
  cooldownUntil[provider] = deadline;
  storeCooldown(provider, deadline);
  return deadline;
}

function currentCooldown(
  provider: AuthenticatedEssayProvider,
  persistedDeadline: number | undefined,
): { deadline: number; message: string } | null {
  const storedDeadline =
    typeof persistedDeadline === "number" && Number.isFinite(persistedDeadline)
      ? persistedDeadline
      : 0;
  const deadline = Math.max(
    cooldownUntil[provider] ?? 0,
    storedDeadline,
    readStoredCooldown(provider),
  );
  if (deadline <= Date.now()) return null;
  const minutesRemaining = Math.max(1, Math.ceil((deadline - Date.now()) / 60_000));
  return {
    deadline,
    message: `Cooling down. Try again in about ${minutesRemaining.toLocaleString()} minute${minutesRemaining === 1 ? "" : "s"}.`,
  };
}

function authWithoutCaptureError(
  auth: AuthenticatedEssayAuthState,
  lastCapturedAt: number,
  captureCooldownUntil: number,
): AuthenticatedEssayAuthState {
  const { lastCaptureError: _ignored, ...rest } = auth;
  return { ...rest, isAuthenticated: true, lastCapturedAt, captureCooldownUntil };
}

async function fetchAuthenticatedEssayData<Entry, Profile>(
  config: AuthenticatedEssayCaptureConfig<Entry, Profile>,
  onProviderContact: () => void,
): Promise<AuthenticatedEssaySyncResult> {
  const result = createEmptyResult();
  const { diag } = result;
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return result;

  if (await applyLockedSessionDeferredDiag(diag)) return result;

  const memoryPrep = await prepareSocialScrapeMemory(config.provider, "authenticated essay capture");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy(config.provider).memoryPressure} ` +
      formatScrapeMemoryPressureDetails(memoryPrep);
    return result;
  }

  const rawEntries: Entry[] = [];
  const rawProfiles: Profile[] = [];
  let unlisten: UnlistenFn | null = null;

  try {
    unlisten = await listen<ExtractionPayload<Entry, Profile>>(config.eventName, (event) => {
      const payload = event.payload;
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      const isCompletion = payload.done === true;
      if (isCompletion) {
        diag.completedScopes += 1;
      } else {
        diag.extractionPasses += 1;
      }
      if (!isCompletion && typeof payload.candidateCount === "number") {
        diag.lastCandidateCount = payload.candidateCount;
      }
      if (!isCompletion && typeof payload.url === "string" && payload.url) {
        diag.lastUrl = payload.url;
      }
      if (typeof payload.extractedAt === "number" && Number.isFinite(payload.extractedAt)) {
        diag.capturedAt = Math.max(diag.capturedAt, payload.extractedAt);
      }

      addDebugEvent(
        "change",
        `[${providerPrefix(config.provider)}] extraction pass: candidates=${(payload.candidateCount ?? 0).toLocaleString()}, entries=${entries.length.toLocaleString()}, profiles=${profiles.length.toLocaleString()}${payload.done ? " final" : ""}`,
      );

      if (payload.error && !diag.errorStage) {
        diag.errorStage = /auth|sign.?in|log.?in/i.test(payload.error) ? "auth" : "extract";
        diag.errorMessage = payload.error;
        return;
      }

      if (isCompletion) return;

      const remainingEntries = Math.max(0, MAX_RAW_RECORDS - rawEntries.length);
      const remainingProfiles = Math.max(0, MAX_RAW_RECORDS - rawProfiles.length);
      rawEntries.push(...entries.slice(0, remainingEntries));
      rawProfiles.push(...profiles.slice(0, remainingProfiles));
    });

    await runBackgroundJob({
      kind: "social-scrape",
      source: `${config.provider}:authenticated-capture`,
      timeoutMs: 600_000,
      waitForActiveJobMs: SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
      waitForActiveJobKinds: SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
      run: async () => {
        onProviderContact();
        const userAgent = getPlatformUA(config.provider);
        for (const command of config.commands) {
          await invoke(command, {
            windowMode: config.getWindowMode(),
            userAgent,
          });
        }
      },
    });
    await waitForSocialScrapeEvents();
  } catch (error) {
    if (!diag.errorStage) {
      if (applyRuntimeDeferredDiag(diag, error)) return result;
      if (applyNativeMemoryPressureDiag(diag, error, config.provider)) return result;
      const message = error instanceof Error ? error.message : String(error);
      diag.errorStage = /authentication_required|auth(?:entication)? required|sign.?in|log.?in/i.test(
        message,
      )
        ? "auth"
        : "invoke";
      diag.errorMessage = message;
    }
    return result;
  } finally {
    safeUnlisten(unlisten, config.eventName);
  }

  if (diag.errorStage) return result;
  if (
    diag.extractionPasses === 0 ||
    diag.extractionPasses !== diag.completedScopes
  ) {
    diag.errorStage = "event_timeout";
    diag.errorMessage =
      `${providerPrefix(config.provider)} returned ${diag.extractionPasses.toLocaleString()} extraction pass${diag.extractionPasses === 1 ? "" : "es"} ` +
      `and ${diag.completedScopes.toLocaleString()} completion marker${diag.completedScopes === 1 ? "" : "s"}.`;
    return result;
  }

  diag.entriesExtracted = rawEntries.length;
  diag.profilesExtracted = rawProfiles.length;
  try {
    const normalizedItems = config.normalizeEntries(rawEntries);
    const normalizedAccounts = config.normalizeProfiles(rawProfiles);
    diag.itemsNormalized = normalizedItems.length;
    diag.accountsNormalized = normalizedAccounts.length;
    result.items = config.deduplicateItems(normalizedItems);
    result.accounts = config.deduplicateAccounts(normalizedAccounts);
    diag.itemsDeduplicated = result.items.length;
    diag.accountsDeduplicated = result.accounts.length;
    return result;
  } catch (error) {
    diag.errorStage = "normalize";
    diag.errorMessage = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export async function captureAuthenticatedEssayProvider<Entry, Profile>(
  config: AuthenticatedEssayCaptureConfig<Entry, Profile>,
  trigger: SocialScrapeTrigger = "unknown",
): Promise<AuthenticatedEssaySyncResult> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") {
    addDebugEvent("change", `[${providerPrefix(config.provider)}] browser preview skips native capture`);
    return createEmptyResult();
  }

  const scrapeStartedAt = Date.now();
  let persistedRecords = 0;
  let attemptCooldownUntil = 0;
  let result = createEmptyResult(scrapeStartedAt);
  try {
    if (!(await hasAcceptedProviderRisk(config.provider))) {
      const message = `${providerPrefix(config.provider)} capture requires provider risk consent.`;
      await recordProviderHealthEvent({
        provider: config.provider,
        outcome: "error",
        stage: "consent_required",
        reason: message,
        startedAt: scrapeStartedAt,
        finishedAt: Date.now(),
      });
      result = resultWithError("consent_required", message);
      return result;
    }

    const pause = getProviderPause(config.provider);
    if (pause) {
      addDebugEvent(
        "change",
        `[${providerPrefix(config.provider)}] paused until ${formatClockTime(pause.pausedUntil)}`,
      );
      result = resultWithError("provider_rate_limit", pause.pauseReason);
      return result;
    }

    const coolingDown = currentCooldown(
      config.provider,
      config.getAuth().captureCooldownUntil,
    );
    if (coolingDown) {
      await recordProviderHealthEvent({
        provider: config.provider,
        outcome: "cooldown",
        stage: "cooldown",
        reason: coolingDown.message,
        startedAt: scrapeStartedAt,
        finishedAt: Date.now(),
      });
      result = resultWithError("cooldown", coolingDown.message);
      result.diag.retryAfterMs = Math.max(1_000, coolingDown.deadline - Date.now());
      return result;
    }

    const store = useAppStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
      addDebugEvent("change", `[${providerPrefix(config.provider)}] sync started`);
      result = await fetchAuthenticatedEssayData(config, () => {
        if (attemptCooldownUntil === 0) {
          attemptCooldownUntil = markCooldown(config.provider);
        }
      });
      if (result.diag.errorStage) {
        const transient =
          isRuntimeDeferredStage(result.diag.errorStage) || result.diag.errorStage === "memory_pressure";
        const message = result.diag.errorMessage ?? result.diag.errorStage;
        if (!transient) {
          store.setError(message);
          const nextAuth = {
            ...config.getAuth(),
            ...(result.diag.errorStage === "auth" ? { isAuthenticated: false } : {}),
            ...(attemptCooldownUntil > 0
              ? { captureCooldownUntil: attemptCooldownUntil }
              : {}),
            lastCaptureError: message,
          };
          config.setAuth(nextAuth);
          config.storeAuth(nextAuth);
        }
        await recordProviderHealthEvent({
          provider: config.provider,
          outcome: "error",
          stage: result.diag.errorStage,
          reason: message,
          startedAt: scrapeStartedAt,
          finishedAt: Date.now(),
          itemsSeen: result.diag.entriesExtracted + result.diag.profilesExtracted,
          itemsAdded: 0,
        });
        return result;
      }

      const beforeItemCount = store.items.length;
      const beforeAccountCount = Object.keys(store.accounts).length;
      await docReconcileFollowRosterCapture(result.accounts, result.items, {
        provider: config.provider,
        capturedAt: result.diag.capturedAt,
      });
      const reconciledState = useAppStore.getState();
      result.diag.itemsAdded = Math.max(0, reconciledState.items.length - beforeItemCount);
      result.diag.accountsAdded = Math.max(
        0,
        Object.keys(reconciledState.accounts).length - beforeAccountCount,
      );
      persistedRecords = result.diag.itemsAdded + result.diag.accountsAdded;
      const captureCooldownUntil =
        attemptCooldownUntil > 0
          ? attemptCooldownUntil
          : markCooldown(config.provider);

      const successAuth = authWithoutCaptureError(
        config.getAuth(),
        result.diag.capturedAt,
        captureCooldownUntil,
      );
      config.setAuth(successAuth);
      config.storeAuth(successAuth);
      const recordsSeen = result.diag.entriesExtracted + result.diag.profilesExtracted;
      await recordProviderHealthEvent({
        provider: config.provider,
        outcome: recordsSeen > 0 ? "success" : "empty",
        stage: recordsSeen > 0 ? undefined : "empty",
        reason: recordsSeen > 0 ? undefined : `No visible ${providerPrefix(config.provider)} records pulled`,
        startedAt: scrapeStartedAt,
        finishedAt: Date.now(),
        itemsSeen: recordsSeen,
        itemsAdded: result.diag.itemsAdded + result.diag.accountsAdded,
      });
      addDebugEvent(
        "change",
        `[${providerPrefix(config.provider)}] synced: ${recordsSeen.toLocaleString()} visible records, ${(result.diag.itemsAdded + result.diag.accountsAdded).toLocaleString()} new records`,
      );
      return result;
    } finally {
      store.setLoading(false);
    }
  } finally {
    recordScrapeOutcome({
      provider: config.provider,
      trigger,
      itemsExtracted: result.diag.entriesExtracted + result.diag.profilesExtracted,
      itemsPersisted: persistedRecords,
      stage: result.diag.errorStage ?? "ok",
      durationMs: Date.now() - scrapeStartedAt,
    });
  }
}
