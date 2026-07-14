import type { RssFeed } from "@freed/shared";
import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
  type VersionedLocalStorageRead,
} from "@freed/ui/lib/versioned-local-storage";

const STORAGE_KEY = "freed-device-rss-runtime-v1";

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

function normalizeRuntimeState(value: unknown): RssRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const normalized: RssRuntimeState = {};
  if (
    typeof candidate.lastFetchAttemptedAt === "number" &&
    Number.isFinite(candidate.lastFetchAttemptedAt) &&
    candidate.lastFetchAttemptedAt >= 0
  ) {
    normalized.lastFetchAttemptedAt = candidate.lastFetchAttemptedAt;
  }
  if (
    typeof candidate.nextFetchAfter === "number" &&
    Number.isFinite(candidate.nextFetchAfter) &&
    candidate.nextFetchAfter >= 0
  ) {
    normalized.nextFetchAfter = candidate.nextFetchAfter;
  }
  if (
    typeof candidate.consecutiveFailures === "number" &&
    Number.isSafeInteger(candidate.consecutiveFailures) &&
    candidate.consecutiveFailures >= 0
  ) {
    normalized.consecutiveFailures = candidate.consecutiveFailures;
  }
  if (typeof candidate.lastFetchError === "string") {
    normalized.lastFetchError = candidate.lastFetchError.slice(0, 500);
  }
  return normalized;
}

function normalizeStoredState(value: unknown): StoredRssRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([url]) => url.length > 0 && url.length <= 4_096)
      .slice(0, 10_000)
      .map(([url, state]) => [url, normalizeRuntimeState(state)]),
  );
}

function readAll(): StoredRssRuntimeState {
  if (hydrated) return current;
  hydrated = true;
  const stored = readVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC);
  storageStatus = stored.status;
  current = stored.status === "supported" ? stored.value : {};
  return current;
}

function writeAll(
  state: StoredRssRuntimeState,
  replaceUnsupportedVersion = false,
  purgeRecoveryCopies = false,
): boolean {
  const persisted = writeVersionedLocalStorage(STORAGE_KEY, STORAGE_CODEC, state, {
    replaceUnsupportedVersion,
    purgeRecoveryCopies,
  });
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

function overlayRuntimeState(feed: RssFeed, state: RssRuntimeState): RssFeed {
  return {
    ...withoutLegacySyncedRuntimeState(feed),
    ...state,
    ...(storageRequiresScheduledPullBlock()
      ? { nextFetchAfter: BLOCK_SCHEDULED_PULLS_UNTIL }
      : {}),
  };
}

export function getRssRuntimeState(url: string): RssRuntimeState {
  return readAll()[url] ?? {};
}

export function setRssRuntimeState(url: string, update: RssRuntimeState): void {
  const state = readAll();
  const next = { ...state, [url]: { ...state[url], ...update } };
  if (writeAll(next)) current = next;
}

export function withRssRuntimeState(feed: RssFeed): RssFeed {
  return overlayRuntimeState(feed, getRssRuntimeState(feed.url));
}

export function withRssRuntimeStates(feeds: RssFeed[]): RssFeed[] {
  const state = readAll();
  return feeds.map((feed) => overlayRuntimeState(feed, state[feed.url] ?? {}));
}

export function removeRssRuntimeState(url: string): void {
  const state = { ...readAll() };
  delete state[url];
  if (writeAll(state)) current = state;
}

/** Clear every device-local RSS retry record. */
export function clearAllRssRuntimeState(): boolean {
  if (!writeAll({}, true, true)) return false;
  current = {};
  hydrated = true;
  return true;
}

export function resetRssRuntimeStateForTests(): void {
  current = {};
  hydrated = false;
  storageStatus = "missing";
}
