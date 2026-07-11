import { parseYouTubeVideoUrl } from "@freed/shared";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getSavedYouTubeVideoUrls } from "./automerge";
import { safeUnlisten } from "./safe-unlisten";
import { recordRuntimeHealthEvent } from "./runtime-health-events";

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

function writePlaylistState(state: YouTubePlaylistState): void {
  localStorage.setItem(PLAYLIST_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(PLAYLIST_STATE_EVENT));
}

export function getYouTubePlaylistState(): YouTubePlaylistState {
  const stored = localStorage.getItem(PLAYLIST_STATE_KEY);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as YouTubePlaylistState;
    const playlistId = validPlaylistId(parsed.playlistId) ??
      parseYouTubePlaylistId(parsed.playlistUrl);
    return {
      ...(playlistId
        ? { playlistId, playlistUrl: canonicalPlaylistUrl(playlistId) }
        : {}),
      ...(Number.isFinite(parsed.lastSyncedAt) ? { lastSyncedAt: parsed.lastSyncedAt } : {}),
      ...(playlistId && Array.isArray(parsed.syncedVideoIds)
        ? {
            syncedVideoIds: Array.from(new Set(
              parsed.syncedVideoIds.filter((id) => VIDEO_ID_PATTERN.test(id)),
            )),
          }
        : {}),
    };
  } catch {
    return {};
  }
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

async function addOneVideo(videoUrl: string): Promise<YouTubeOfflinePlaylistResult> {
  const startedAt = Date.now();
  const reference = parseYouTubeVideoUrl(videoUrl);
  if (!reference) throw new Error("This is not a supported YouTube video URL.");

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
    void invoke("yt_add_to_offline_playlist", {
      videoUrl: reference.canonicalWatchUrl,
    }).catch((error) => rejectResult?.(error));

    const payload = await result;
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
    const previous = getYouTubePlaylistState();
    const syncedVideoIds = new Set(
      previous.playlistId === playlistId ? previous.syncedVideoIds ?? [] : [],
    );
    syncedVideoIds.add(reference.videoId);
    writePlaylistState({
      playlistId,
      playlistUrl,
      lastSyncedAt: Date.now(),
      syncedVideoIds: Array.from(syncedVideoIds),
    });
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
  return enqueuePlaylistOperation(() => addOneVideo(videoUrl));
}

/** Reconcile every locally saved YouTube item into the user's Freed Offline playlist. */
export function syncSavedYouTubeVideosToOfflinePlaylist(
  videoUrls?: readonly string[],
  signal?: AbortSignal,
): Promise<YouTubePlaylistSyncResult> {
  return enqueuePlaylistOperation(async () => {
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
      if (signal?.aborted) {
        throw new Error("YouTube playlist sync stopped. Run it again to continue from the last confirmed video.");
      }
      try {
        latest = await addOneVideo(reference.canonicalWatchUrl);
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
  });
}
