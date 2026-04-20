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

export async function getDesktopUpdateTargets(
  channel: ReleaseChannel,
): Promise<Array<{ channel: ReleaseChannel; target: string }>> {
  const baseTarget = await invoke<string>("get_updater_target");
  const primaryTarget = { channel, target: `${channel}-${baseTarget}` };
  if (channel !== "dev") {
    return [primaryTarget];
  }

  return [
    primaryTarget,
    { channel: "production", target: `production-${baseTarget}` },
  ];
}
