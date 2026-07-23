import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseYouTubeVideoUrl } from "@freed/shared";

const YOUTUBE_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const YOUTUBE_IFRAME_API_SCRIPT_ID = "freed-youtube-iframe-api";
const YOUTUBE_IFRAME_API_TIMEOUT_MS = 10_000;
const YOUTUBE_PLAYER_ENDED = 0;

type YouTubePlaybackStatus = "ready" | "playing" | "paused" | "buffering";
type YouTubeSessionPhase = "loaded" | "ended" | "error";

interface YouTubePlayerEvent {
  data: number;
}

interface YouTubePlayerOptions {
  events: {
    onReady: () => void;
    onStateChange: (event: YouTubePlayerEvent) => void;
    onError: () => void;
  };
}

interface YouTubePlayerInstance {
  destroy?: () => void;
}

interface YouTubeIframeApi {
  Player: new (element: HTMLIFrameElement, options: YouTubePlayerOptions) => YouTubePlayerInstance;
}

type YouTubeApiWindow = Window &
  typeof globalThis & {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  };

interface YouTubeSession {
  videoId: string;
  revision: number;
  phase: YouTubeSessionPhase;
}

export interface YouTubeFocusPlayerProps {
  videoUrl: string;
  title?: string;
  onPlayInYouTube: (canonicalWatchUrl: string) => void;
  onEnded?: () => void;
}

let iframeApiPromise: Promise<YouTubeIframeApi> | null = null;

function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  const apiWindow = window as YouTubeApiWindow;
  if (apiWindow.YT?.Player) return Promise.resolve(apiWindow.YT);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise((resolve, reject) => {
    const previousReadyHandler = apiWindow.onYouTubeIframeAPIReady;
    let settled = false;
    const staleScript = document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID);
    staleScript?.remove();

    const script = document.createElement("script");
    script.id = YOUTUBE_IFRAME_API_SCRIPT_ID;
    script.src = YOUTUBE_IFRAME_API_SRC;
    script.async = true;

    const restoreReadyHandler = () => {
      if (apiWindow.onYouTubeIframeAPIReady === handleReady) {
        apiWindow.onYouTubeIframeAPIReady = previousReadyHandler;
      }
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.removeEventListener("error", handleError);
      script.remove();
      restoreReadyHandler();
      iframeApiPromise = null;
      reject(new Error(message));
    };
    const handleReady = () => {
      if (settled) return;
      if (!apiWindow.YT?.Player) {
        fail("YouTube IFrame API did not initialize");
        return;
      }
      settled = true;
      clearTimeout(timeout);
      script.removeEventListener("error", handleError);
      restoreReadyHandler();
      resolve(apiWindow.YT);
      try {
        previousReadyHandler?.();
      } catch {
        // Another page integration cannot invalidate Freed's initialized player API.
      }
    };
    const handleError = () => fail("YouTube IFrame API could not be loaded");
    const timeout = window.setTimeout(
      () => fail("YouTube IFrame API timed out"),
      YOUTUBE_IFRAME_API_TIMEOUT_MS,
    );

    apiWindow.onYouTubeIframeAPIReady = handleReady;
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return iframeApiPromise;
}

function embedUrlWithOrigin(embedUrl: string): string {
  const resolved = new URL(embedUrl);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    resolved.searchParams.set("origin", window.location.origin);
  }
  return resolved.toString();
}

function playbackStatusLabel(status: YouTubePlaybackStatus): string {
  if (status === "playing") return "YouTube video playing.";
  if (status === "paused") return "YouTube video paused.";
  if (status === "buffering") return "YouTube video buffering.";
  return "YouTube focus player ready. Press play in the player to begin.";
}

export function YouTubeFocusPlayer({
  videoUrl,
  title,
  onPlayInYouTube,
  onEnded,
}: YouTubeFocusPlayerProps) {
  const reference = useMemo(() => parseYouTubeVideoUrl(videoUrl), [videoUrl]);
  const reactId = useId();
  const playerId = `youtube-focus-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const endedNotifiedRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  const [session, setSession] = useState<YouTubeSession | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<YouTubePlaybackStatus>("ready");

  const activeSession = reference && session?.videoId === reference.videoId ? session : null;

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    if (!reference || activeSession?.phase !== "loaded" || !iframeRef.current) return;

    let cancelled = false;
    const iframe = iframeRef.current;

    void loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled || !iframe.isConnected) return;

        playerRef.current = new api.Player(iframe, {
          events: {
            onReady: () => {
              if (!cancelled) setPlaybackStatus("ready");
            },
            onStateChange: (event) => {
              if (cancelled) return;
              if (event.data === YOUTUBE_PLAYER_ENDED) {
                setSession((current) =>
                  current?.videoId === reference.videoId
                    ? { ...current, phase: "ended" }
                    : current,
                );
                if (!endedNotifiedRef.current) {
                  endedNotifiedRef.current = true;
                  onEndedRef.current?.();
                }
                return;
              }
              if (event.data === 1) setPlaybackStatus("playing");
              if (event.data === 2) setPlaybackStatus("paused");
              if (event.data === 3) setPlaybackStatus("buffering");
            },
            onError: () => {
              if (cancelled) return;
              setSession((current) =>
                current?.videoId === reference.videoId
                  ? { ...current, phase: "error" }
                  : current,
              );
            },
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSession((current) =>
          current?.videoId === reference.videoId
            ? { ...current, phase: "error" }
            : current,
        );
      });

    return () => {
      cancelled = true;
      const player = playerRef.current;
      playerRef.current = null;
      queueMicrotask(() => {
        if (!iframe.isConnected) {
          try {
            player?.destroy?.();
          } catch {
            // The detached iframe is already gone, so there is nothing left to clean up.
          }
        }
      });
    };
  }, [activeSession?.phase, activeSession?.revision, reference]);

  if (!reference) {
    return (
      <section
        aria-label="YouTube focus player"
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-5"
      >
        <p role="alert" className="text-sm text-[var(--theme-text-secondary)]">
          This YouTube link cannot be played safely.
        </p>
      </section>
    );
  }

  const openInYouTube = () => onPlayInYouTube(reference.canonicalWatchUrl);
  const startFocusSession = () => {
    endedNotifiedRef.current = false;
    setPlaybackStatus("ready");
    setSession((current) => ({
      videoId: reference.videoId,
      revision: (current?.revision ?? 0) + 1,
      phase: "loaded",
    }));
  };

  if (!activeSession) {
    return (
      <section
        aria-label="YouTube focus player"
        data-state="idle"
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-5"
      >
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Watch without the feed</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--theme-text-secondary)]">
          The player loads only after you choose to watch. It will not autoplay or start another video.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={startFocusSession}
            className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Watch here in Focus Mode
          </button>
          <button
            type="button"
            onClick={openInYouTube}
            className="btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Play in YouTube
          </button>
        </div>
      </section>
    );
  }

  if (activeSession.phase === "ended") {
    return (
      <section
        aria-label="YouTube focus player"
        data-state="ended"
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-5 text-center"
      >
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Video finished</h2>
        <p role="status" className="mt-1 text-sm text-[var(--theme-text-secondary)]">
          The player has closed so the next recommendation cannot start.
        </p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={startFocusSession}
            className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Replay in Focus Mode
          </button>
          <button
            type="button"
            onClick={openInYouTube}
            className="btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Play in YouTube
          </button>
        </div>
      </section>
    );
  }

  if (activeSession.phase === "error") {
    return (
      <section
        aria-label="YouTube focus player"
        data-state="error"
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-5 text-center"
      >
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">This video cannot play here</h2>
        <p role="alert" className="mt-1 text-sm text-[var(--theme-text-secondary)]">
          The creator may have disabled embedded playback. You can still open the exact video in YouTube.
        </p>
        <button
          type="button"
          onClick={openInYouTube}
          className="btn-primary mt-4 rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Play in YouTube
        </button>
        <button
          type="button"
          onClick={startFocusSession}
          className="btn-secondary ml-2 mt-4 rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Retry Focus Mode
        </button>
      </section>
    );
  }

  const embedUrl = embedUrlWithOrigin(reference.privacyEnhancedEmbedUrl);

  return (
    <section aria-label="YouTube focus player" data-state="loaded">
      <div
        key={`${reference.videoId}-${activeSession.revision}`}
        className="aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-black ring-1 ring-[var(--theme-border-subtle)]"
      >
        <iframe
          ref={iframeRef}
          id={playerId}
          src={embedUrl}
          title={title ? `${title} on YouTube` : "YouTube video player"}
          className="h-full w-full border-0"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {playbackStatusLabel(playbackStatus)}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={openInYouTube}
          className="btn-secondary rounded-lg px-3 py-2 text-sm font-semibold"
        >
          Play in YouTube
        </button>
      </div>
    </section>
  );
}
