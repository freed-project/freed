import { invoke } from "@tauri-apps/api/core";
import type { ReleaseChannel } from "@freed/shared";
import {
  persistReleaseChannel,
  RELEASE_CHANNEL_STORAGE_KEY,
} from "@freed/ui/lib/release-channel";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";

const DESKTOP_RELEASE_CHANNEL_STORE_FILE = "release-channel.json";
const DESKTOP_RELEASE_CHANNEL_STORE_KEY = "channel";
const DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY = "installedChannel";

function normalizeStoredDesktopReleaseChannel(value: unknown): ReleaseChannel | null {
  return value === "dev" || value === "production" ? value : null;
}

export interface DesktopReleaseChannelState {
  selectedChannel: ReleaseChannel;
  installedChannel: ReleaseChannel;
}

export function bootstrapDesktopReleaseChannel(): ReleaseChannel {
  if (typeof window === "undefined") {
    return "production";
  }

  const channel =
    normalizeStoredDesktopReleaseChannel(
      window.localStorage.getItem(RELEASE_CHANNEL_STORAGE_KEY),
    ) ?? "production";
  persistReleaseChannel(channel);
  return channel;
}

export async function loadDesktopReleaseChannel(): Promise<ReleaseChannel> {
  return (await loadDesktopReleaseChannelState()).selectedChannel;
}

export async function loadDesktopReleaseChannelState(): Promise<DesktopReleaseChannelState> {
  const fallbackChannel = bootstrapDesktopReleaseChannel();

  try {
    const storedChannel = normalizeStoredDesktopReleaseChannel(
      await readNativeJsonValue(
        DESKTOP_RELEASE_CHANNEL_STORE_FILE,
        DESKTOP_RELEASE_CHANNEL_STORE_KEY,
      ),
    );
    const selectedChannel = storedChannel ?? fallbackChannel;
    const storedInstalledChannel = normalizeStoredDesktopReleaseChannel(
      await readNativeJsonValue(
        DESKTOP_RELEASE_CHANNEL_STORE_FILE,
        DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY,
      ),
    );
    const installedChannel = storedInstalledChannel ?? selectedChannel;
    persistReleaseChannel(selectedChannel);

    if (!storedChannel) {
      await writeNativeJsonValue(
        DESKTOP_RELEASE_CHANNEL_STORE_FILE,
        DESKTOP_RELEASE_CHANNEL_STORE_KEY,
        selectedChannel,
        "release-channel",
      );
    }
    if (!storedInstalledChannel) {
      await writeNativeJsonValue(
        DESKTOP_RELEASE_CHANNEL_STORE_FILE,
        DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY,
        installedChannel,
        "release-channel",
      );
    }

    return { selectedChannel, installedChannel };
  } catch {
    return { selectedChannel: fallbackChannel, installedChannel: fallbackChannel };
  }
}

export async function persistDesktopReleaseChannel(channel: ReleaseChannel): Promise<void> {
  persistReleaseChannel(channel);

  try {
    await writeNativeJsonValue(
      DESKTOP_RELEASE_CHANNEL_STORE_FILE,
      DESKTOP_RELEASE_CHANNEL_STORE_KEY,
      channel,
      "release-channel",
    );
  } catch {
    // localStorage is still updated, so the current install keeps working.
  }
}

export async function persistDesktopInstalledReleaseChannel(
  channel: ReleaseChannel,
): Promise<void> {
  try {
    await writeNativeJsonValue(
      DESKTOP_RELEASE_CHANNEL_STORE_FILE,
      DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY,
      channel,
      "release-channel",
    );
  } catch {
    // The current process can still render the channel from React state.
  }
}

export async function getNativeUpdaterTarget(): Promise<string> {
  return invoke<string>("get_updater_target");
}

export function buildDesktopUpdateTargets(
  channel: ReleaseChannel,
  nativeUpdaterTarget: string,
): Array<{ channel: ReleaseChannel; target: string }> {
  const primaryTarget = { channel, target: `${channel}-${nativeUpdaterTarget}` };
  if (channel !== "dev") {
    return [primaryTarget];
  }

  return [
    primaryTarget,
    { channel: "production", target: `production-${nativeUpdaterTarget}` },
  ];
}

export async function getDesktopUpdateTargets(
  channel: ReleaseChannel,
): Promise<Array<{ channel: ReleaseChannel; target: string }>> {
  return buildDesktopUpdateTargets(channel, await getNativeUpdaterTarget());
}
