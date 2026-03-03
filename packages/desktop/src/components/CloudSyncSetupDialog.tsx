/**
 * CloudSyncSetupDialog — first-launch cloud sync onboarding overlay.
 *
 * Shown once when the user opens the desktop app for the first time.
 * Presents Google Drive and Dropbox as independent connection options;
 * both can be connected simultaneously so the desktop acts as a cloud
 * bridge between clients using different providers.
 *
 * The dialog is dismissible after connecting at least one provider, or
 * by clicking "Skip for now" (which hides it permanently via localStorage).
 */

import { useState, useCallback } from "react";
import {
  initiateDesktopOAuth,
  storeCloudToken,
  startCloudSync,
  getCloudToken,
  type CloudProvider,
} from "../lib/sync";

const SETUP_DONE_KEY = "freed_cloud_setup_done";

export function markCloudSetupDone(): void {
  localStorage.setItem(SETUP_DONE_KEY, "1");
}

export function isCloudSetupDone(): boolean {
  return !!localStorage.getItem(SETUP_DONE_KEY);
}

interface ProviderState {
  status: "idle" | "connecting" | "connected" | "error";
  error?: string;
}

interface CloudSyncSetupDialogProps {
  onDismiss: () => void;
}

export function CloudSyncSetupDialog({ onDismiss }: CloudSyncSetupDialogProps) {
  const [providers, setProviders] = useState<Record<CloudProvider, ProviderState>>({
    gdrive: { status: getCloudToken("gdrive") ? "connected" : "idle" },
    dropbox: { status: getCloudToken("dropbox") ? "connected" : "idle" },
  });

  const setProvider = useCallback(
    (provider: CloudProvider, state: Partial<ProviderState>) => {
      setProviders((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], ...state },
      }));
    },
    [],
  );

  const handleConnect = useCallback(
    async (provider: CloudProvider) => {
      setProvider(provider, { status: "connecting", error: undefined });
      try {
        const token = await initiateDesktopOAuth(provider);
        storeCloudToken(provider, token);
        startCloudSync(provider, token).catch(console.error);
        setProvider(provider, { status: "connected" });
      } catch (err) {
        setProvider(provider, {
          status: "error",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      }
    },
    [setProvider],
  );

  const handleDismiss = useCallback(() => {
    markCloudSetupDone();
    onDismiss();
  }, [onDismiss]);

  const anyConnected =
    providers.gdrive.status === "connected" || providers.dropbox.status === "connected";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-2xl shadow-2xl p-6">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-[#8b5cf6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white mb-1">Set up Cloud Sync</h2>
          <p className="text-sm text-[#71717a]">
            Keep your reading list in sync across all your devices.
            Connect one or both providers — your data lives in your own cloud storage.
          </p>
        </div>

        {/* Reliability callout */}
        <div className="mb-5 p-3 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">
          <p className="text-xs text-[#c4b5fd] leading-relaxed">
            <span className="font-semibold">Tip:</span> Connecting both Google Drive
            and Dropbox gives you the most reliable sync — mobile clients can use
            either provider and the desktop bridges them together.
          </p>
        </div>

        {/* Provider cards */}
        <div className="space-y-3 mb-6">
          <ProviderCard
            provider="gdrive"
            state={providers.gdrive}
            onConnect={handleConnect}
          />
          <ProviderCard
            provider="dropbox"
            state={providers.dropbox}
            onConnect={handleConnect}
          />
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleDismiss}
            className="text-sm text-[#52525b] hover:text-[#71717a] transition-colors"
          >
            {anyConnected ? "Done" : "Skip for now"}
          </button>
          {anyConnected && (
            <button
              onClick={handleDismiss}
              className="px-4 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-sm font-medium rounded-lg transition-colors"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: CloudProvider;
  state: ProviderState;
  onConnect: (provider: CloudProvider) => void;
}

const PROVIDER_META: Record<
  CloudProvider,
  { name: string; detail: string; icon: React.ReactNode }
> = {
  gdrive: {
    name: "Google Drive",
    detail: "~5 s sync · stored in app data folder",
    icon: (
      <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 87.3 78" fill="none">
        <path
          d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z"
          fill="#0066DA"
        />
        <path
          d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5A9.06 9.06 0 000 53h27.5z"
          fill="#00AC47"
        />
        <path
          d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.2z"
          fill="#EA4335"
        />
        <path
          d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"
          fill="#00832D"
        />
        <path
          d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z"
          fill="#2684FC"
        />
        <path
          d="M73.4 26.5l-12.65-21.9c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"
          fill="#FFBA00"
        />
      </svg>
    ),
  },
  dropbox: {
    name: "Dropbox",
    detail: "~1–4 s sync · stored in /Apps/Freed/",
    icon: (
      <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="#0061FF">
        <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4L6 2zM18 2l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zM12 14l-6 4 6 4 6-4-6-4z" />
      </svg>
    ),
  },
};

function ProviderCard({ provider, state, onConnect }: ProviderCardProps) {
  const meta = PROVIDER_META[provider];
  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
        isConnected
          ? "bg-green-500/5 border-green-500/20"
          : "bg-white/5 border-[rgba(255,255,255,0.08)]"
      }`}
    >
      {meta.icon}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white">{meta.name}</p>
          {isConnected && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Connected
            </span>
          )}
        </div>
        <p className="text-xs text-[#71717a] mt-0.5">{meta.detail}</p>
        {state.error && (
          <p className="text-xs text-red-400 mt-1">{state.error}</p>
        )}
      </div>

      <button
        onClick={() => onConnect(provider)}
        disabled={isConnecting || isConnected}
        className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isConnected
            ? "bg-green-500/10 text-green-400 border border-green-500/20"
            : "bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 border border-[#8b5cf6]/30"
        }`}
      >
        {isConnecting ? "Opening…" : isConnected ? "Connected" : "Connect"}
      </button>
    </div>
  );
}
