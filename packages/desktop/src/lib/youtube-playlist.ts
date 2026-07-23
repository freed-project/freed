import { parseYouTubeVideoUrl } from "@freed/shared";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getSavedYouTubeVideoUrls } from "./automerge";
import { safeUnlisten } from "./safe-unlisten";
import { recordRuntimeHealthEvent } from "./runtime-health-events";
import {
  assertFactoryResetEpoch,
  runFactoryResetSensitiveDesktopOperation,
} from "./factory-reset-guard";

const PLAYLIST_STATE_KEY = "youtube_offline_playlist_state";
const PLAYLIST_STATE_EVENT = "freed:youtube-offline-playlist";
const PLAYLIST_ACTION_TIMEOUT_MS = 60_000;
const MAX_PLAYLIST_ACTIONS_PER_SYNC = 25;
const PLAYLIST_ID_PATTERN = /^PL[A-Za-z0-9_-]{8,80}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeOfflinePlaylistResult {
  playlistId: string;
  playlistUrl: string;
  added: boolean;
}

export interface YouTubePlaylistState {
  playlistId?: string;
  playlistUrl?: string;
  lastSyncedAt?: number;
  syncedVideoIds?: string[];
}

export interface YouTubePlaylistSyncResult extends YouTubeOfflinePlaylistResult {
  requestedCount: number;
  addedCount: number;
  existingCount: number;
  remainingCount: number;
}

interface YouTubePlaylistEventPayload {
  result?: "added" | "existing" | "error";
  success?: boolean;
  ok?: boolean;
  videoId?: string;
  playlistId?: string;
  playlistUrl?: string;
  added?: boolean;
  alreadyPresent?: boolean;
  stage?: string;
  clickCount?: number;
  navigationCount?: number;
  durationMs?: number;
  error?: string;
}

let playlistOperationChain: Promise<void> = Promise.resolve();
let playlistStorageUnavailable = false;

type YouTubePlaylistStateRead =
  | { status: "missing"; state: YouTubePlaylistState }
  | { status: "supported"; state: YouTubePlaylistState }
  | { status: "corrupt" }
  | { status: "unavailable" };

function enqueuePlaylistOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = playlistOperationChain.then(operation, operation);
  playlistOperationChain = next.then(() => undefined, () => undefined);
  return next;
}

function validPlaylistId(value: unknown): string | undefined {
  return typeof value === "string" && PLAYLIST_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function parseYouTubePlaylistId(playlistUrl: unknown): string | undefined {
  if (typeof playlistUrl !== "string") return undefined;
  try {
    const parsed = new URL(playlistUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname) ||
      parsed.pathname !== "/playlist"
    ) return undefined;
    return validPlaylistId(parsed.searchParams.get("list"));
  } catch {
    return undefined;
  }
}

function canonicalPlaylistUrl(playlistId: string): string {
  const url = new URL("https://www.youtube.com/playlist");
  url.searchParams.set("list", playlistId);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readYouTubePlaylistState(): YouTubePlaylistStateRead {
  if (playlistStorageUnavailable) return { status: "unavailable" };
  let stored: string | null;
  try {
    stored = localStorage.getItem(PLAYLIST_STATE_KEY);
  } catch {
    playlistStorageUnavailable = true;
    return { status: "unavailable" };
  }
  if (stored === null) return { status: "missing", state: {} };

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!isRecord(parsed)) return { status: "corrupt" };
    const idFromField = parsed.playlistId === undefined
      ? undefined
      : validPlaylistId(parsed.playlistId);
    const idFromUrl = parsed.playlistUrl === undefined
      ? undefined
      : parseYouTubePlaylistId(parsed.playlistUrl);
    if (
      (parsed.playlistId !== undefined && !idFromField)
      || (parsed.playlistUrl !== undefined && !idFromUrl)
      || (idFromField && idFromUrl && idFromField !== idFromUrl)
    ) {
      return { status: "corrupt" };
    }
    const playlistId = idFromField ?? idFromUrl;
    if (
      parsed.lastSyncedAt !== undefined
      && (
        typeof parsed.lastSyncedAt !== "number"
        || !Number.isFinite(parsed.lastSyncedAt)
        || parsed.lastSyncedAt < 0
      )
    ) {
      return { status: "corrupt" };
    }
    if (
      parsed.syncedVideoIds !== undefined
      && (
        !playlistId
        || !Array.isArray(parsed.syncedVideoIds)
        || parsed.syncedVideoIds.some(
          (id) => typeof id !== "string" || !VIDEO_ID_PATTERN.test(id),
        )
      )
    ) {
      return { status: "corrupt" };
    }
    return {
      status: "supported",
      state: {
        ...(playlistId
          ? { playlistId, playlistUrl: canonicalPlaylistUrl(playlistId) }
          : {}),
        ...(typeof parsed.lastSyncedAt === "number"
          ? { lastSyncedAt: parsed.lastSyncedAt }
          : {}),
        ...(playlistId && Array.isArray(parsed.syncedVideoIds)
          ? { syncedVideoIds: Array.from(new Set(parsed.syncedVideoIds as string[])) }
          : {}),
      },
    };
  } catch {
    return { status: "corrupt" };
  }
}

function requireReadablePlaylistState(): YouTubePlaylistState {
  const stored = readYouTubePlaylistState();
  if (stored.status === "missing" || stored.status === "supported") {
    return stored.state;
  }
  throw new Error(
    "Freed could not verify the YouTube playlist progress on this device. Disconnect and reconnect YouTube before trying again.",
  );
}

function writePlaylistState(state: YouTubePlaylistState): boolean {
  const stored = readYouTubePlaylistState();
  if (stored.status === "corrupt" || stored.status === "unavailable") return false;
  try {
    localStorage.setItem(PLAYLIST_STATE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(PLAYLIST_STATE_EVENT));
    return true;
  } catch {
    playlistStorageUnavailable = true;
    return false;
  }
}

export function getYouTubePlaylistState(): YouTubePlaylistState {
  const stored = readYouTubePlaylistState();
  return stored.status === "missing" || stored.status === "supported"
    ? stored.state
    : {};
}

export function subscribeYouTubePlaylistState(
  listener: (state: YouTubePlaylistState) => void,
): () => void {
  const handle = () => listener(getYouTubePlaylistState());
  window.addEventListener(PLAYLIST_STATE_EVENT, handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener(PLAYLIST_STATE_EVENT, handle);
    window.removeEventListener("storage", handle);
  };
}

/** Clear account-specific playlist metadata when the YouTube session is removed. */
export function clearYouTubePlaylistState(): void {
  localStorage.removeItem(PLAYLIST_STATE_KEY);
  playlistStorageUnavailable = false;
  window.dispatchEvent(new Event(PLAYLIST_STATE_EVENT));
}

/** Keep the playlist handoff but force the next sync to verify every saved video again. */
export function resetYouTubePlaylistProgress(): void {
  const current = getYouTubePlaylistState();
  if (!current.playlistId || !current.playlistUrl) return;
  writePlaylistState({
    playlistId: current.playlistId,
    playlistUrl: current.playlistUrl,
    lastSyncedAt: current.lastSyncedAt,
    syncedVideoIds: [],
  });
}

async function addOneVideo(
  videoUrl: string,
  resetEpoch: number,
): Promise<YouTubeOfflinePlaylistResult> {
  const startedAt = Date.now();
  const reference = parseYouTubeVideoUrl(videoUrl);
  if (!reference) throw new Error("This is not a supported YouTube video URL.");
  const previous = requireReadablePlaylistState();

  let unlisten: UnlistenFn | null = null;
  let timeout: number | null = null;
  try {
    let resolveResult: ((payload: YouTubePlaylistEventPayload) => void) | null = null;
    let rejectResult: ((error: unknown) => void) | null = null;
    const result = new Promise<YouTubePlaylistEventPayload>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    unlisten = await listen<YouTubePlaylistEventPayload>("yt-playlist-result", (event) => {
      const payload = event.payload;
      if (payload.videoId !== reference.videoId) return;
      resolveResult?.(payload);
    });
    timeout = window.setTimeout(
      () => rejectResult?.(new Error("YouTube playlist update timed out.")),
      PLAYLIST_ACTION_TIMEOUT_MS,
    );
    assertFactoryResetEpoch(resetEpoch);
    void invoke("yt_add_to_offline_playlist", {
      videoUrl: reference.canonicalWatchUrl,
    }).catch((error) => rejectResult?.(error));

    const payload = await result;
    assertFactoryResetEpoch(resetEpoch);
    if (payload.error || payload.result === "error") {
      throw new Error(payload.error ?? "YouTube could not update Freed Offline.");
    }
    if (payload.success === false || payload.ok === false) {
      throw new Error("YouTube did not confirm the playlist update.");
    }

    const playlistId = validPlaylistId(payload.playlistId);
    if (!playlistId) {
      throw new Error("YouTube saved the video but did not expose the playlist link.");
    }
    const playlistUrl = canonicalPlaylistUrl(playlistId);

    const added = payload.added ?? payload.alreadyPresent !== true;
    const syncedVideoIds = new Set(
      previous.playlistId === playlistId ? previous.syncedVideoIds ?? [] : [],
    );
    syncedVideoIds.add(reference.videoId);
    assertFactoryResetEpoch(resetEpoch);
    if (!writePlaylistState({
      playlistId,
      playlistUrl,
      lastSyncedAt: Date.now(),
      syncedVideoIds: Array.from(syncedVideoIds),
    })) {
      throw new Error(
        "YouTube confirmed the playlist update, but Freed could not store its receipt. Disconnect and reconnect YouTube before trying again.",
      );
    }
    recordRuntimeHealthEvent({
      event: "youtube_playlist_outcome",
      result: added ? "added" : "existing",
      stage: payload.stage ?? "confirmed",
      clickCount: payload.clickCount ?? 0,
      navigationCount: payload.navigationCount ?? 1,
      durationMs: payload.durationMs ?? Date.now() - startedAt,
    });
    return {
      playlistId,
      playlistUrl,
      added,
    };
  } catch (error) {
    recordRuntimeHealthEvent({
      event: "youtube_playlist_outcome",
      result: "error",
      stage: error instanceof Error && error.message.toLowerCase().includes("timed out")
        ? "timeout"
        : "action",
      clickCount: 0,
      navigationCount: 1,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    safeUnlisten(unlisten, "yt-playlist-result");
  }
}

/** Save one deliberate reader selection through the authenticated YouTube website UI. */
export function addYouTubeVideoToOfflinePlaylist(
  videoUrl: string,
): Promise<YouTubeOfflinePlaylistResult> {
  return runFactoryResetSensitiveDesktopOperation((resetEpoch) =>
    enqueuePlaylistOperation(() => {
      assertFactoryResetEpoch(resetEpoch);
      return addOneVideo(videoUrl, resetEpoch);
    })
  );
}

/** Reconcile every locally saved YouTube item into the user's Freed Offline playlist. */
export function syncSavedYouTubeVideosToOfflinePlaylist(
  videoUrls?: readonly string[],
  signal?: AbortSignal,
): Promise<YouTubePlaylistSyncResult> {
  return runFactoryResetSensitiveDesktopOperation((resetEpoch) =>
    enqueuePlaylistOperation(async () => {
    assertFactoryResetEpoch(resetEpoch);
    if (signal?.aborted) throw new Error("YouTube playlist sync was stopped.");
    const urls = Array.from(new Set(videoUrls ?? await getSavedYouTubeVideoUrls()));
    if (urls.length === 0) {
      throw new Error("Save a YouTube video in Freed before syncing this playlist.");
    }

    const references = Array.from(
      new Map(
        urls.flatMap((url) => {
          const reference = parseYouTubeVideoUrl(url);
          return reference ? [[reference.videoId, reference] as const] : [];
        }),
      ),
    ).map(([, reference]) => reference);
    if (references.length === 0) {
      throw new Error("None of the saved items has a supported YouTube video URL.");
    }

    const before = getYouTubePlaylistState();
    const completedIds = new Set(before.syncedVideoIds ?? []);
    const pending = references.filter((reference) => !completedIds.has(reference.videoId));
    const batch = pending.slice(0, MAX_PLAYLIST_ACTIONS_PER_SYNC);
    let addedCount = 0;
    let existingCount = references.length - pending.length;
    let latest: YouTubeOfflinePlaylistResult | null = null;
    for (const reference of batch) {
      assertFactoryResetEpoch(resetEpoch);
      if (signal?.aborted) {
        throw new Error("YouTube playlist sync stopped. Run it again to continue from the last confirmed video.");
      }
      try {
        latest = await addOneVideo(reference.canonicalWatchUrl, resetEpoch);
        assertFactoryResetEpoch(resetEpoch);
        if (latest.added) addedCount += 1;
        else existingCount += 1;
      } catch (error) {
        const finished = addedCount + existingCount;
        const remaining = references.length - finished;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${message} ${finished.toLocaleString()} saved video${finished === 1 ? " is" : "s are"} confirmed and ${remaining.toLocaleString()} remain.`,
        );
      }
    }

    if (!latest) {
      if (!before.playlistId || !before.playlistUrl) {
        throw new Error("YouTube playlist sync did not run.");
      }
      return {
        playlistId: before.playlistId,
        playlistUrl: before.playlistUrl,
        added: false,
        requestedCount: references.length,
        addedCount: 0,
        existingCount: references.length,
        remainingCount: 0,
      };
    }

    const after = getYouTubePlaylistState();
    const afterIds = new Set(after.syncedVideoIds ?? []);
    const remainingCount = references.filter(
      (reference) => !afterIds.has(reference.videoId),
    ).length;
    return {
      ...latest,
      requestedCount: references.length,
      addedCount,
      existingCount,
      remainingCount,
    };
    })
  );
}

/** Reset module-only storage failure state between isolated tests. */
export function resetYouTubePlaylistStateForTests(): void {
  playlistStorageUnavailable = false;
  playlistOperationChain = Promise.resolve();
}
