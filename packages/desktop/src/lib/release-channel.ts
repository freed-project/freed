import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { ReleaseChannel } from "@freed/shared";
import {
  persistReleaseChannel,
  RELEASE_CHANNEL_STORAGE_KEY,
} from "@freed/ui/lib/release-channel";

const DESKTOP_RELEASE_CHANNEL_STORE_FILE = "release-channel.json";
const DESKTOP_RELEASE_CHANNEL_STORE_KEY = "channel";
const DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY = "installedChannel";

let releaseChannelStore: Store | null = null;

async function getReleaseChannelStore(): Promise<Store> {
  if (!releaseChannelStore) {
    releaseChannelStore = await load(DESKTOP_RELEASE_CHANNEL_STORE_FILE, {
      defaults: {},
      autoSave: true,
    });
  }

  return releaseChannelStore;
}

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
    const store = await getReleaseChannelStore();
    const storedChannel = normalizeStoredDesktopReleaseChannel(
      await store.get(DESKTOP_RELEASE_CHANNEL_STORE_KEY),
    );
    const selectedChannel = storedChannel ?? fallbackChannel;
    const storedInstalledChannel = normalizeStoredDesktopReleaseChannel(
      await store.get(DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY),
    );
    const installedChannel = storedInstalledChannel ?? selectedChannel;
    persistReleaseChannel(selectedChannel);

    if (!storedChannel) {
      await store.set(DESKTOP_RELEASE_CHANNEL_STORE_KEY, selectedChannel);
    }
    if (!storedInstalledChannel) {
      await store.set(DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY, installedChannel);
    }

    return { selectedChannel, installedChannel };
  } catch {
    return { selectedChannel: fallbackChannel, installedChannel: fallbackChannel };
  }
}

export async function persistDesktopReleaseChannel(channel: ReleaseChannel): Promise<void> {
  persistReleaseChannel(channel);

  try {
    const store = await getReleaseChannelStore();
    await store.set(DESKTOP_RELEASE_CHANNEL_STORE_KEY, channel);
  } catch {
    // localStorage is still updated, so the current install keeps working.
  }
}

export async function persistDesktopInstalledReleaseChannel(
  channel: ReleaseChannel,
): Promise<void> {
  try {
    const store = await getReleaseChannelStore();
    await store.set(DESKTOP_INSTALLED_RELEASE_CHANNEL_STORE_KEY, channel);
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
