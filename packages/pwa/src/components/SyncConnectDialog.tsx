import { useState, useRef, useEffect, useCallback } from "react";
import jsQR from "jsqr";
import { connect, storeRelayUrl, onStatusChange } from "../lib/sync";
import { BottomSheet } from "./BottomSheet";

const CONNECT_TIMEOUT_MS = 5000;

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

export function SyncConnectDialog({ open, onClose }: SyncConnectDialogProps) {
  const [mode, setMode] = useState<Mode>("manual");
  const [url, setUrl] = useState("");
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
    setUrl("");
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
    if (!url.trim()) return;

    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        throw new Error("URL must start with ws:// or wss://");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid URL format");
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      storeRelayUrl(url.trim());
      connect(url.trim());
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
          : "Enter the sync URL from your Freed desktop app, or scan the QR code."}
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
        /* Manual URL entry */
        <div className="mb-4">
          <label htmlFor="sync-url" className="block text-sm text-[#a1a1aa] mb-2">
            Sync URL
          </label>
          <input
            id="sync-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://192.168.1.x:8765"
            className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] font-mono text-sm transition-colors"
            disabled={connecting}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
          <p className="mt-2 text-xs text-[#71717a]">
            Find this in your desktop app: Settings &rarr; Mobile Sync
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
            disabled={connecting || !url.trim()}
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
