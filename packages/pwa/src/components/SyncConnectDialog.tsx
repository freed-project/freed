import { useState, useRef, useEffect, useCallback } from "react";
import jsQR from "jsqr";
import { connect, storeRelayUrl, onStatusChange } from "../lib/sync";
import { BottomSheet } from "./BottomSheet";

const CONNECT_TIMEOUT_MS = 5000;

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

/**
 * Returns a promise that resolves when the sync WebSocket connects,
 * or rejects after a timeout.
 */
function waitForConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Connection timed out. Check that the desktop app is running and on the same network."));
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

interface SyncConnectDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "manual" | "scanning";

/**
 * Decode a QR code from a video frame via an offscreen canvas + jsQR.
 * Works on all browsers with camera access (including iOS Safari).
 */
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

/** Validate a base64url token — exactly 43 chars, URL-safe alphabet only. */
function isValidToken(t: string): boolean {
  return t.length === 43 && /^[A-Za-z0-9_-]+$/.test(t);
}

export function SyncConnectDialog({ open, onClose }: SyncConnectDialogProps) {
  const [mode, setMode] = useState<Mode>("manual");
  const [ip, setIp] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [scanStatus, setScanStatus] = useState<"waiting" | "found">("waiting");

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
    setMode("manual");
    setIp("");
    setToken("");
    setError(null);
    setScanStatus("waiting");
    onClose();
  }, [stopCamera, onClose]);

  const startCamera = useCallback(async () => {
    setError(null);
    setScanStatus("waiting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // back camera on mobile
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      scanIntervalRef.current = setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;

        const detected = detectQrCode(videoRef.current);
        if (detected && (detected.startsWith("ws://") || detected.startsWith("wss://"))) {
          // Reject QR codes from older desktop versions that lack a pairing token.
          if (!hasTokenParam(detected)) {
            stopCamera();
            setError(
              "This QR code has no pairing token. Please update your desktop app and rescan.",
            );
            setMode("manual");
            return;
          }

          stopCamera();
          storeRelayUrl(detected);
          connect(detected);

          waitForConnection()
            .then(() => {
              setScanStatus("found");
              setTimeout(() => handleClose(), 800);
            })
            .catch((err) => {
              setError(err instanceof Error ? err.message : "Connection failed");
              setMode("manual");
            });
        }
      }, 250);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.includes("NotAllowed")
            ? "Camera permission denied. Please allow camera access and try again."
            : e.message
          : "Could not access camera.",
      );
      setMode("manual");
    }
  }, [stopCamera, handleClose]);

  // Start camera when switching to scan mode
  useEffect(() => {
    if (mode === "scanning" && open) {
      startCamera();
    }
    return () => {
      if (mode !== "scanning") stopCamera();
    };
  }, [mode, open, startCamera, stopCamera]);

  // Cleanup on unmount or close
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

    try {
      storeRelayUrl(relayUrl);
      connect(relayUrl);
      await waitForConnection();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={handleClose} title="Connect to Desktop">
      <p className="text-sm text-[#71717a] mb-5">
        {mode === "scanning"
          ? "Point your camera at the QR code shown in the Freed desktop app."
          : "Enter your desktop's IP address and pairing token, or scan the QR code."}
      </p>

      {/* Mode tabs */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => { setMode("manual"); stopCamera(); setError(null); }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "manual"
              ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30"
              : "bg-white/5 text-[#71717a] hover:text-white"
          }`}
        >
          Manual
        </button>
        <button
          onClick={() => {
            setMode("scanning");
            setError(null);
          }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "scanning"
              ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30"
              : "bg-white/5 text-[#71717a] hover:text-white"
          }`}
        >
          Scan QR
        </button>
      </div>

      {mode === "scanning" ? (
        /* QR Scanner view */
        <div className="mb-4">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              aria-label="Camera viewfinder for QR code scanning"
            />

            {/* Scan overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`w-48 h-48 border-2 rounded-2xl transition-colors ${
                  scanStatus === "found"
                    ? "border-green-400"
                    : "border-white/40"
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
                    <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-green-400 text-sm font-medium">Connecting...</p>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-[#71717a] text-center mt-3">
            Open the desktop app &rarr; Settings &rarr; Mobile Sync to see the QR code
          </p>
        </div>
      ) : (
        /* Manual entry — structured IP + token fields */
        <div className="mb-4 space-y-4">
          {/* IP address */}
          <div>
            <label
              htmlFor="sync-ip"
              className="block text-sm text-[#a1a1aa] mb-2"
            >
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
            <label
              htmlFor="sync-token"
              className="block text-sm text-[#a1a1aa] mb-2"
            >
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
            Find these in your desktop app: Settings &rarr; Mobile Sync &rarr;
            Manual Entry
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {mode === "manual" && (
        <div className="flex justify-end">
          <button
            onClick={handleConnect}
            className="btn-primary px-6 py-2.5 disabled:opacity-50"
            disabled={connecting || !ip.trim() || token.length === 0}
          >
            {connecting ? "Connecting..." : "Connect"}
          </button>
        </div>
      )}

      {/* Download CTA */}
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
