import { useState, useRef, useEffect, useCallback } from "react";
import jsQR from "jsqr";
import {
  connect,
  storeRelayUrl,
  onStatusChange,
  startCloudSync,
  storeCloudToken,
  type CloudProvider,
} from "../lib/sync";
import { BottomSheet } from "@freed/ui/components/BottomSheet";
import { addDebugEvent } from "@freed/ui/lib/debug-store";

// ─── OAuth PKCE helpers ───────────────────────────────────────────────────────

/** Generate a cryptographically random code verifier for PKCE. */
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** SHA-256 hash the verifier and base64url-encode it. */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

const GDRIVE_CLIENT_ID = import.meta.env.VITE_GDRIVE_CLIENT_ID ?? "";
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI = `${window.location.origin}/oauth-callback`;

async function initiateGDriveOAuth(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("freed_pkce_verifier", verifier);
  sessionStorage.setItem("freed_pkce_provider", "gdrive");

  const params = new URLSearchParams({
    client_id: GDRIVE_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.appdata",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function initiateDropboxOAuth(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("freed_pkce_verifier", verifier);
  sessionStorage.setItem("freed_pkce_provider", "dropbox");

  const params = new URLSearchParams({
    client_id: DROPBOX_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  });

  window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
}

// ─── Connection timeout ───────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Returns true if the given WebSocket URL includes a `?t=` pairing token.
 * URLs without a token will be rejected by the relay with HTTP 401.
 */
function hasTokenParam(url: string): boolean {
  try {
    return new URL(url).searchParams.has("t");
  } catch {
    return false;
  }
}

function waitForConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          "Desktop not found on this network. Check that the app is running, then re-scan the QR code or connect via cloud sync.",
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    const unsubscribe = onStatusChange((connected) => {
      if (connected) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

// ─── QR detection ────────────────────────────────────────────────────────────

type Mode = "manual" | "scanning" | "cloud";

/** True when the page protocol makes ws:// connections likely to be blocked */
function isMixedContentRisk(wsUrl: string): boolean {
  return window.location.protocol === "https:" && wsUrl.startsWith("ws://");
}

function detectQrCode(video: HTMLVideoElement): string | null {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = videoWidth;
  canvas.height = videoHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
  const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
  const result = jsQR(imageData.data, videoWidth, videoHeight);
  return result?.data ?? null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SyncConnectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selects a tab — used when auto-reconnect fails. */
  initialMode?: Mode;
}

/** Validate a base64url token — exactly 43 chars, URL-safe alphabet only. */
function isValidToken(t: string): boolean {
  return t.length === 43 && /^[A-Za-z0-9_-]+$/.test(t);
}

export function SyncConnectDialog({ open, onClose, initialMode = "manual" }: SyncConnectDialogProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [ip, setIp] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [scanStatus, setScanStatus] = useState<"waiting" | "found">("waiting");
  const [scanFrameCount, setScanFrameCount] = useState(0);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [lastQrContent, setLastQrContent] = useState<string | null>(null);
  const [cloudConnecting, setCloudConnecting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    setMode(initialMode ?? "manual");
    setIp("");
    setToken("");
    setError(null);
    setScanStatus("waiting");
    setScanFrameCount(0);
    setVideoResolution(null);
    setLastQrContent(null);
    onClose();
  }, [stopCamera, onClose, initialMode]);

  const startCamera = useCallback(async () => {
    setError(null);
    setScanStatus("waiting");
    setScanFrameCount(0);
    setVideoResolution(null);
    setLastQrContent(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Capture resolution once video metadata is available
      const vid = videoRef.current;
      if (vid) {
        const onMeta = () => {
          setVideoResolution(`${vid.videoWidth}×${vid.videoHeight}`);
        };
        vid.addEventListener("loadedmetadata", onMeta, { once: true });
      }

      addDebugEvent("camera_started", stream.getVideoTracks()[0]?.label ?? "unknown track");

      scanIntervalRef.current = setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;

        setScanFrameCount((n) => n + 1);

        // Capture resolution on first good frame if not yet set
        if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
          setVideoResolution(
            `${videoRef.current.videoWidth}×${videoRef.current.videoHeight}`,
          );
        }

        const detected = detectQrCode(videoRef.current);

        if (detected) {
          setLastQrContent(detected);

          if (detected.startsWith("ws://") || detected.startsWith("wss://")) {
            if (!hasTokenParam(detected)) {
              stopCamera();
              setError(
                "This QR code has no pairing token. Please update your desktop app and rescan.",
              );
              setMode("manual");
              return;
            }

            addDebugEvent("qr_decoded", detected);
            stopCamera();
            storeRelayUrl(detected);
            connect(detected);

            waitForConnection()
              .then(() => {
                setScanStatus("found");
                setTimeout(() => handleClose(), 800);
              })
              .catch((err) => {
                addDebugEvent("connect_timeout", detected);
                setError(err instanceof Error ? err.message : "Connection failed");
                setMode("cloud");
              });
          }
          // Non-ws QR codes: content shown in the diagnostic line below viewfinder
        }
      }, 250);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message.includes("NotAllowed")
            ? "Camera permission denied. Please allow camera access and try again."
            : e.message
          : "Could not access camera.";
      addDebugEvent("camera_denied", msg);
      setError(msg);
      setMode("manual");
    }
  }, [stopCamera, handleClose]);

  useEffect(() => {
    if (mode === "scanning" && open) {
      startCamera();
    }
    return () => {
      if (mode !== "scanning") stopCamera();
    };
  }, [mode, open, startCamera, stopCamera]);

  useEffect(() => {
    if (!open) stopCamera();
  }, [open, stopCamera]);

  const handleConnect = async () => {
    const trimmedIp = ip.trim();
    const trimmedToken = token.trim();

    if (!trimmedIp) {
      setError("Enter the desktop IP address shown in the Freed desktop app.");
      return;
    }
    if (!isValidToken(trimmedToken)) {
      setError(
        trimmedToken.length === 0
          ? "Enter the 43-character pairing token shown in the Freed desktop app."
          : `Token must be exactly 43 characters (${trimmedToken.length} entered).`,
      );
      return;
    }

    // Construct the full WebSocket URL — user never has to type the protocol,
    // port, or query key themselves.
    const relayUrl = `ws://${trimmedIp}:8765?t=${trimmedToken}`;

    setError(null);
    setConnecting(true);
    addDebugEvent("connect_attempt", relayUrl);

    // Warn about mixed content — the connection will likely be blocked by the browser.
    if (isMixedContentRisk(relayUrl)) {
      addDebugEvent("mixed_content_warn", relayUrl);
    }

    try {
      storeRelayUrl(relayUrl);
      connect(relayUrl);
      await waitForConnection();
      handleClose();
    } catch (e) {
      addDebugEvent("connect_timeout", relayUrl);
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  const handleCloudConnect = async (provider: CloudProvider) => {
    setCloudConnecting(true);
    setError(null);
    try {
      if (provider === "gdrive") {
        await initiateGDriveOAuth();
      } else {
        await initiateDropboxOAuth();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start OAuth flow");
      setCloudConnecting(false);
    }
  };

  const tabs: Array<{ id: Mode; label: string }> = [
    { id: "cloud", label: "Cloud Sync" },
    { id: "scanning", label: "Scan QR" },
    { id: "manual", label: "Manual" },
  ];

  // Derive the constructed URL for display and HTTPS warning
  const constructedUrl = ip.trim()
    ? `ws://${ip.trim()}:8765${token.trim() ? `?t=${token.trim()}` : ""}`
    : "";
  const mixedContentRisk =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    (constructedUrl.startsWith("ws://") ||
      (mode === "scanning" && lastQrContent?.startsWith("ws://")));

  return (
    <BottomSheet open={open} onClose={handleClose} title="Connect to Desktop">
      {/* HTTPS mixed-content warning — the #1 reason sync fails on iPhone */}
      {mixedContentRisk && (
        <div className="mb-4 p-3 bg-orange-500/15 border border-orange-500/40 rounded-xl">
          <p className="text-xs font-semibold text-orange-400 mb-1">
            HTTPS → ws:// Connection Blocked
          </p>
          <p className="text-xs text-orange-300/80">
            Safari and Chrome block plain{" "}
            <code className="font-mono">ws://</code> connections from HTTPS
            pages. This is why sync likely fails on iPhone even when the desktop
            is running. Use the desktop app directly, or open the app over HTTP.
          </p>
        </div>
      )}

      <p className="text-sm text-[#71717a] mb-5">
        {mode === "scanning"
          : mode === "cloud"
            ? "Sync your reading list across any network via Google Drive or Dropbox."
            : "Enter your desktop's IP address and pairing token, or scan the QR code."}
      </p>

      {/* Mode tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => {
              if (id !== "scanning") stopCamera();
              setMode(id);
              setError(null);
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === id
                ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30"
                : "bg-white/5 text-[#71717a] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "scanning" && (
        <div className="mb-4">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              aria-label="Camera viewfinder for QR code scanning"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`w-48 h-48 border-2 rounded-2xl transition-colors ${
                  scanStatus === "found" ? "border-green-400" : "border-white/40"
                }`}
              >
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-[#8b5cf6] rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[#8b5cf6] rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[#8b5cf6] rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-[#8b5cf6] rounded-br-lg" />
              </div>
            </div>
            {scanStatus === "found" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 border-2 border-green-400 flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-green-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <p className="text-green-400 text-sm font-medium">
                    Connecting...
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Live scan diagnostics */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-[#52525b] font-mono">
            <span>
              {videoResolution
                ? `Camera ${videoResolution}`
                : "Camera initialising..."}
              {scanFrameCount > 0 && ` · Frame ${scanFrameCount}`}
            </span>
            {lastQrContent &&
              !lastQrContent.startsWith("ws://") &&
              !lastQrContent.startsWith("wss://") && (
                <span
                  className="text-orange-400 truncate max-w-[140px]"
                  title={lastQrContent}
                >
                  QR: {lastQrContent.slice(0, 20)}
                  {lastQrContent.length > 20 ? "…" : ""}
                </span>
              )}
          </div>
          <p className="text-xs text-[#71717a] text-center mt-2">
            Open the desktop app &rarr; Settings &rarr; Mobile Sync to see the QR code
          </p>
        </div>
      ) : mode === "manual" ? (
        /* Manual entry — structured IP + token fields */
        <div className="mb-4 space-y-4">
          {/* IP address */}
          <div>
            <label htmlFor="sync-ip" className="block text-sm text-[#a1a1aa] mb-2">
              Desktop IP address
            </label>
            <input
              id="sync-ip"
              type="text"
              inputMode="decimal"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.x"
              className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] font-mono text-sm transition-colors"
              disabled={connecting}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
          </div>

          {/* Pairing token */}
          <div>
            <label htmlFor="sync-token" className="block text-sm text-[#a1a1aa] mb-2">
              Pairing token{" "}
              <span className="text-[#52525b] text-xs">(43 characters)</span>
            </label>
            <input
              id="sync-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              placeholder="43-character token from desktop app"
              maxLength={43}
              className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] font-mono text-xs tracking-wide transition-colors"
              disabled={connecting}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            {token.length > 0 && (
              <p
                className={`mt-1 text-xs ${
                  token.length === 43 ? "text-green-500" : "text-[#71717a]"
                }`}
              >
                {token.length}/43 characters
              </p>
            )}
          </div>

          <p className="text-xs text-[#71717a]">
            Find these in your desktop app: Settings &rarr; Mobile Sync &rarr; Manual Entry
          </p>
        </div>
      ) : null}

      {mode === "cloud" && (
        <div className="mb-4 flex flex-col gap-3">
          <button
            onClick={() => handleCloudConnect("gdrive")}
            disabled={cloudConnecting}
            className="flex items-center gap-3 w-full px-4 py-3.5 bg-white/5 hover:bg-white/10 border border-[rgba(255,255,255,0.08)] hover:border-[#8b5cf6]/40 rounded-xl transition-colors disabled:opacity-50"
          >
            {/* Google Drive icon */}
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 87.3 78" fill="none">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
              <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5A9.06 9.06 0 000 53h27.5z" fill="#00AC47"/>
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.2z" fill="#EA4335"/>
              <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
              <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684FC"/>
              <path d="M73.4 26.5l-12.65-21.9c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
            </svg>
            <div className="text-left">
              <div className="text-sm font-medium text-white">Connect Google Drive</div>
              <div className="text-xs text-[#71717a]">~4s sync latency · stored in app data folder</div>
            </div>
          </button>

          <button
            onClick={() => handleCloudConnect("dropbox")}
            disabled={cloudConnecting}
            className="flex items-center gap-3 w-full px-4 py-3.5 bg-white/5 hover:bg-white/10 border border-[rgba(255,255,255,0.08)] hover:border-[#8b5cf6]/40 rounded-xl transition-colors disabled:opacity-50"
          >
            {/* Dropbox icon */}
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="#0061FF">
              <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4L6 2zM18 2l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zM12 14l-6 4 6 4 6-4-6-4z"/>
            </svg>
            <div className="text-left">
              <div className="text-sm font-medium text-white">Connect Dropbox</div>
              <div className="text-xs text-[#71717a]">~2s sync latency · stored in /Apps/Freed/</div>
            </div>
          </button>

          <p className="text-xs text-[#71717a] text-center pt-1">
            Your reading list is stored in your own cloud account.
            <br />
            Freed never sees your data.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
          {error}
          {/* If the error mentions "not found", nudge toward cloud sync. */}
          {error.includes("not found") && mode !== "cloud" && (
            <button
              onClick={() => { setMode("cloud"); setError(null); }}
              className="block mt-2 text-[#8b5cf6] underline text-xs"
            >
              Set up cloud sync instead
            </button>
          )}
        </div>
      )}

      {mode === "manual" && (
        <div className="flex flex-col gap-2">
          {connecting && constructedUrl && (
            <p className="text-xs text-[#52525b] font-mono text-center truncate">
              Attempting: {constructedUrl}
            </p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleConnect}
              className="btn-primary px-6 py-2.5 disabled:opacity-50"
              disabled={connecting || !ip.trim() || token.length === 0}
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 pt-5 border-t border-[rgba(255,255,255,0.08)] flex items-center justify-between">
        <span className="text-xs text-[#71717a]">Don't have the desktop app?</span>
        <a
          href="https://freed.wtf/get"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 bg-white/5 hover:bg-[#8b5cf6]/20 hover:text-[#8b5cf6] rounded-lg text-[#a1a1aa] transition-colors"
        >
          Download
        </a>
      </div>
    </BottomSheet>
  );
}
