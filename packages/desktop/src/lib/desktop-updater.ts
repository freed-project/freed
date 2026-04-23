import { check, type Update } from "@tauri-apps/plugin-updater";
import { getWebsiteHostForChannel, type ReleaseChannel } from "@freed/shared";
import {
  buildDesktopUpdateTargets,
  getNativeUpdaterTarget,
} from "./release-channel";

export const JUST_UPDATED_KEY = "freed-updated-to";

export type DesktopDownloadTarget =
  | "mac-arm"
  | "mac-intel"
  | "windows"
  | "linux";

export type PendingDesktopUpdate = {
  channel: ReleaseChannel;
  update: Update;
  fallbackDownloadUrl: string;
  nativeUpdaterTarget: string;
};

export type DesktopInstallProgress =
  | { phase: "downloading"; percent: number }
  | { phase: "ready" };

export function mapUpdaterTargetToDownloadTarget(
  updaterTarget: string,
): DesktopDownloadTarget | null {
  switch (updaterTarget) {
    case "darwin-aarch64":
      return "mac-arm";
    case "darwin-x86_64":
      return "mac-intel";
    case "windows-x86_64":
      return "windows";
    case "linux-x86_64":
      return "linux";
    default:
      return null;
  }
}

export function getDesktopDownloadFallbackUrl(
  channel: ReleaseChannel,
  updaterTarget: string,
): string {
  const host = getWebsiteHostForChannel(channel);
  const downloadTarget = mapUpdaterTargetToDownloadTarget(updaterTarget);
  if (!downloadTarget) {
    return `https://${host}/get`;
  }

  return `https://${host}/api/downloads/${downloadTarget}`;
}

export async function resolveDesktopDownloadFallbackUrl(
  channel: ReleaseChannel,
): Promise<string> {
  return getDesktopDownloadFallbackUrl(channel, await getNativeUpdaterTarget());
}

export async function checkDesktopUpdate(
  channel: ReleaseChannel,
): Promise<PendingDesktopUpdate | null> {
  const nativeUpdaterTarget = await getNativeUpdaterTarget();
  const fallbackDownloadUrl = getDesktopDownloadFallbackUrl(
    channel,
    nativeUpdaterTarget,
  );

  for (const candidate of buildDesktopUpdateTargets(channel, nativeUpdaterTarget)) {
    const update = await check({ target: candidate.target });
    if (update) {
      return {
        channel: candidate.channel,
        update,
        fallbackDownloadUrl,
        nativeUpdaterTarget,
      };
    }
  }

  return null;
}

export async function installPendingDesktopUpdate(
  pendingUpdate: PendingDesktopUpdate,
  onProgress?: (progress: DesktopInstallProgress) => void,
): Promise<string> {
  let totalBytes = 0;
  let downloadedBytes = 0;

  await pendingUpdate.update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data.contentLength ?? 0;
        break;
      case "Progress": {
        downloadedBytes += event.data.chunkLength;
        const percent =
          totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
        onProgress?.({ phase: "downloading", percent });
        break;
      }
      case "Finished":
        onProgress?.({ phase: "ready" });
        break;
    }
  });

  return pendingUpdate.update.version;
}
