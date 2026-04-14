import { invoke } from "@tauri-apps/api/core";
import type { ReleaseChannel } from "@freed/shared";
import {
  bootstrapReleaseChannel,
  persistReleaseChannel,
} from "@freed/ui/lib/release-channel";

export function bootstrapDesktopReleaseChannel(): ReleaseChannel {
  return bootstrapReleaseChannel();
}

export function persistDesktopReleaseChannel(channel: ReleaseChannel): void {
  persistReleaseChannel(channel);
}

export async function getDesktopUpdateTarget(channel: ReleaseChannel): Promise<string> {
  const baseTarget = await invoke<string>("get_updater_target");
  return `${channel}-${baseTarget}`;
}
