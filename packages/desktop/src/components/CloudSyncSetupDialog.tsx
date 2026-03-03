/**
 * CloudSyncSetupDialog — cloud sync onboarding overlay.
 *
 * Opened from the CloudSyncNudge toast whenever no provider is connected.
 * Uses CloudProviderCard + useCloudProviders — do not duplicate cloud-provider
 * UI or connect logic inline anywhere.
 */

import { useCallback } from "react";
import { getCloudToken } from "../lib/sync";
import { useCloudProviders } from "../hooks/useCloudProviders";
import { CloudProviderCard } from "./CloudProviderCard";

/** Cloud setup is done when at least one provider token is stored. */
export function isCloudSetupDone(): boolean {
  return !!(getCloudToken("gdrive") || getCloudToken("dropbox"));
}

interface CloudSyncSetupDialogProps {
  onDismiss: () => void;
}

export function CloudSyncSetupDialog({ onDismiss }: CloudSyncSetupDialogProps) {
  const { providers, connect, anyConnected } = useCloudProviders();

  const handleDismiss = useCallback(() => onDismiss(), [onDismiss]);

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
            <span className="font-semibold">Tip:</span> Connecting both Dropbox and
            Google Drive gives you the most reliable sync — mobile clients can use
            either provider and the desktop bridges them together.
          </p>
        </div>

        {/* Provider cards */}
        <div className="space-y-3 mb-6">
          {(["dropbox", "gdrive"] as const).map((provider) => (
            <CloudProviderCard
              key={provider}
              provider={provider}
              state={providers[provider]}
              onConnect={connect}
            />
          ))}
        </div>

        {/* Footer */}
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
