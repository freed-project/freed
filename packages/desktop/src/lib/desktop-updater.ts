import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  getWebsiteHostForChannel,
  stripReleaseChannelSuffix,
  type ReleaseChannel,
} from "@freed/shared";
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

function parseUpdateVersion(version: string): [number, number, number] {
  const [yy = "0", month = "0", patch = "0"] = stripReleaseChannelSuffix(
    version,
  ).split(".");
  return [Number(yy) || 0, Number(month) || 0, Number(patch) || 0];
}

function compareUpdateVersions(left: string, right: string): number {
  const a = parseUpdateVersion(left);
  const b = parseUpdateVersion(right);

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

function isNewerUpdate(left: Update, right: Update): boolean {
  return compareUpdateVersions(left.version, right.version) > 0;
}

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

  let latestUpdate: PendingDesktopUpdate | null = null;

  for (const candidate of buildDesktopUpdateTargets(channel, nativeUpdaterTarget)) {
    const update = await check({ target: candidate.target });
    if (update) {
      const pendingUpdate = {
        channel: candidate.channel,
        update,
        fallbackDownloadUrl,
        nativeUpdaterTarget,
      };
      if (!latestUpdate || isNewerUpdate(update, latestUpdate.update)) {
        latestUpdate = pendingUpdate;
      }
    }
  }

  return latestUpdate;
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
