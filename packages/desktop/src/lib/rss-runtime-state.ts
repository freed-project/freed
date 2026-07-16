import type { RssFeed } from "@freed/shared";
import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
  type VersionedLocalStorageRead,
} from "@freed/ui/lib/versioned-local-storage";

const STORAGE_KEY = "freed-device-rss-runtime-v1";
const MAX_TRACKED_FEEDS = 10_000;

export type RssRuntimeState = Pick<
  RssFeed,
  "lastFetchAttemptedAt" | "nextFetchAfter" | "consecutiveFailures" | "lastFetchError"
>;

type StoredRssRuntimeState = Record<string, RssRuntimeState>;

const STORAGE_CODEC: VersionedLocalStorageCodec<StoredRssRuntimeState> = {
  version: 1,
  decode(value) {
    if (!value.feeds || typeof value.feeds !== "object" || Array.isArray(value.feeds)) {
      return null;
    }
    return normalizeStoredState(value.feeds);
  },
  encode(feeds) {
    return { feeds };
  },
};

let current: StoredRssRuntimeState = {};
let hydrated = false;
let storageStatus: VersionedLocalStorageRead<StoredRssRuntimeState>["status"] = "missing";

const BLOCK_SCHEDULED_PULLS_UNTIL = Number.MAX_SAFE_INTEGER;

function withoutLegacySyncedRuntimeState(feed: RssFeed): RssFeed {
  const clean = { ...feed };
  delete clean.lastFetchAttemptedAt;
  delete clean.nextFetchAfter;
  delete clean.consecutiveFailures;
  delete clean.lastFetchError;
  delete clean.etag;
  delete clean.lastModified;
  return clean;
}

function normalizeRuntimeState(value: unknown): RssRuntimeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const normalized: RssRuntimeState = {};
  if ("lastFetchAttemptedAt" in candidate) {
    if (
      typeof candidate.lastFetchAttemptedAt !== "number"
      || !Number.isFinite(candidate.lastFetchAttemptedAt)
      || candidate.lastFetchAttemptedAt < 0
    ) return null;
    normalized.lastFetchAttemptedAt = candidate.lastFetchAttemptedAt;
  }
  if ("nextFetchAfter" in candidate) {
    if (
      typeof candidate.nextFetchAfter !== "number"
      || !Number.isFinite(candidate.nextFetchAfter)
      || candidate.nextFetchAfter < 0
    ) return null;
    normalized.nextFetchAfter = candidate.nextFetchAfter;
  }
  if ("consecutiveFailures" in candidate) {
    if (
      typeof candidate.consecutiveFailures !== "number"
      || !Number.isSafeInteger(candidate.consecutiveFailures)
      || candidate.consecutiveFailures < 0
    ) return null;
    normalized.consecutiveFailures = candidate.consecutiveFailures;
  }
  if ("lastFetchError" in candidate) {
    if (typeof candidate.lastFetchError !== "string") return null;
    normalized.lastFetchError = candidate.lastFetchError.slice(0, 500);
  }
  return normalized;
}

function normalizeStoredState(value: unknown): StoredRssRuntimeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_TRACKED_FEEDS) return null;
  const normalized: StoredRssRuntimeState = {};
  for (const [url, state] of entries) {
    if (url.length === 0 || url.length > 4_096) return null;
    const runtimeState = normalizeRuntimeState(state);
    if (runtimeState === null) return null;
    normalized[url] = runtimeState;
  }
  return normalized;
}

function readAll(): StoredRssRuntimeState {
  if (hydrated) return current;
  hydrated = true;
  const stored = readVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC);
  storageStatus = stored.status;
  current = stored.status === "supported" ? stored.value : {};
  return current;
}

function writeAll(state: StoredRssRuntimeState): boolean {
  const persisted = writeVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC, state);
  if (persisted) {
    storageStatus = "supported";
  } else if (storageStatus !== "unsupported" && storageStatus !== "corrupt") {
    // A supported or missing store that can no longer be written cannot safely
    // retain scheduler state. Fail closed until persistence is available again
    // so an unwritable retry ledger cannot turn into repeated provider pulls.
    storageStatus = "unavailable";
  }
  return persisted;
}

function storageRequiresScheduledPullBlock(): boolean {
  readAll();
  return storageStatus === "unsupported"
    || storageStatus === "corrupt"
    || storageStatus === "unavailable";
}

function legacyRuntimeState(feed: RssFeed): RssRuntimeState | null {
  const migrated = normalizeRuntimeState(feed);
  return migrated && Object.keys(migrated).length > 0 ? migrated : null;
}

/**
 * Seed the device ledger from the synchronized retry fields written by older
 * Freed versions. Local records always win. Keeping the old retry deadline is
 * the conservative upgrade path because dropping it could contact a feed
 * sooner than the previous client intended.
 */
function migrateLegacyRuntimeStates(feeds: readonly RssFeed[]): StoredRssRuntimeState {
  const state = readAll();
  if (storageRequiresScheduledPullBlock()) return state;

  let next: StoredRssRuntimeState | null = null;
  let trackedCount = Object.keys(state).length;
  for (const feed of feeds) {
    const activeState = next ?? state;
    if (Object.prototype.hasOwnProperty.call(activeState, feed.url)) continue;
    const legacy = legacyRuntimeState(feed);
    if (!legacy || trackedCount >= MAX_TRACKED_FEEDS) continue;
    next ??= { ...state };
    next[feed.url] = legacy;
    trackedCount += 1;
  }

  if (next && writeAll(next)) current = next;
  return current;
}

function overlayRuntimeState(
  feed: RssFeed,
  state: RssRuntimeState,
  untrackedAtCapacity: boolean,
): RssFeed {
  return {
    ...withoutLegacySyncedRuntimeState(feed),
    ...state,
    ...(storageRequiresScheduledPullBlock() || untrackedAtCapacity
      ? { nextFetchAfter: BLOCK_SCHEDULED_PULLS_UNTIL }
      : {}),
  };
}

function getRssRuntimeState(url: string): RssRuntimeState {
  return readAll()[url] ?? {};
}

export function setRssRuntimeState(url: string, update: RssRuntimeState): void {
  const state = readAll();
  if (
    !Object.prototype.hasOwnProperty.call(state, url)
    && Object.keys(state).length >= MAX_TRACKED_FEEDS
  ) {
    return;
  }
  const next = { ...state, [url]: { ...state[url], ...update } };
  if (writeAll(next)) current = next;
}

export function withRssRuntimeState(feed: RssFeed): RssFeed {
  const state = migrateLegacyRuntimeStates([feed]);
  const untrackedAtCapacity = Object.keys(state).length >= MAX_TRACKED_FEEDS
    && !Object.prototype.hasOwnProperty.call(state, feed.url);
  return overlayRuntimeState(
    feed,
    getRssRuntimeState(feed.url),
    untrackedAtCapacity,
  );
}

export function withRssRuntimeStates(feeds: RssFeed[]): RssFeed[] {
  const state = migrateLegacyRuntimeStates(feeds);
  const atCapacity = Object.keys(state).length >= MAX_TRACKED_FEEDS;
  return feeds.map((feed) => overlayRuntimeState(
    feed,
    state[feed.url] ?? {},
    atCapacity && !Object.prototype.hasOwnProperty.call(state, feed.url),
  ));
}

export function removeRssRuntimeState(url: string): void {
  const state = { ...readAll() };
  delete state[url];
  if (writeAll(state)) current = state;
}

export function resetRssRuntimeStateForTests(): void {
  current = {};
  hydrated = false;
  storageStatus = "missing";
}
