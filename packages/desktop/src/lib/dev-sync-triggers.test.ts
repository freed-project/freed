import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readNativeJsonFile = vi.fn();
const writeNativeJsonFile = vi.fn();
const refreshSocialProvider = vi.fn();
const loadDesktopReleaseChannelState = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("./native-json-store", () => ({
  readNativeJsonFile,
  writeNativeJsonFile,
}));

vi.mock("./capture", () => ({
  refreshSocialProvider,
}));

vi.mock("./release-channel", () => ({
  loadDesktopReleaseChannelState,
}));

vi.mock("./logger", () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

async function flushImmediatePoll() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("dev sync triggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readNativeJsonFile.mockReset();
    writeNativeJsonFile.mockReset();
    refreshSocialProvider.mockReset();
    loadDesktopReleaseChannelState.mockReset();
    loadDesktopReleaseChannelState.mockResolvedValue({
      selectedChannel: "production",
      installedChannel: "production",
    });
  });

  afterEach(() => {
    delete window.__FREED_RUN_SOCIAL_SYNC__;
    vi.useRealTimers();
  });

  it("exposes a renderer bridge for native trigger dispatch", async () => {
    const { installDevSyncTriggerBridge } = await import("./dev-sync-triggers");
    refreshSocialProvider.mockResolvedValue(undefined);

    const stop = installDevSyncTriggerBridge();
    const runSocialSync = window.__FREED_RUN_SOCIAL_SYNC__;
    expect(runSocialSync).toBeTypeOf("function");
    if (!runSocialSync) throw new Error("bridge was not installed");
    await runSocialSync({
      id: "request-native-1",
      provider: "facebook",
    });
    stop();

    expect(refreshSocialProvider).toHaveBeenCalledWith("facebook");
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-native-1",
        provider: "facebook",
        status: "started",
      }),
      "dev-sync-trigger",
    );
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-native-1",
        provider: "facebook",
        status: "completed",
      }),
      "dev-sync-trigger",
    );
  });

  it("runs an approved provider through the normal social refresh path", async () => {
    const { startDevSyncTriggerPoller } = await import("./dev-sync-triggers");
    readNativeJsonFile.mockResolvedValue({
      enabled: true,
      id: "request-1",
      provider: "facebook",
    });
    refreshSocialProvider.mockResolvedValue(undefined);

    const stop = startDevSyncTriggerPoller({ enabled: true, pollMs: 10 });
    await flushImmediatePoll();
    stop();

    expect(refreshSocialProvider).toHaveBeenCalledWith("facebook");
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-1",
        provider: "facebook",
        status: "started",
      }),
      "dev-sync-trigger",
    );
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-1",
        provider: "facebook",
        status: "completed",
      }),
      "dev-sync-trigger",
    );
  });

  it("ignores unsupported providers without calling a scraper", async () => {
    const { startDevSyncTriggerPoller } = await import("./dev-sync-triggers");
    readNativeJsonFile.mockResolvedValue({
      enabled: true,
      id: "request-2",
      provider: "medium",
    });

    const stop = startDevSyncTriggerPoller({ enabled: true, pollMs: 10 });
    await flushImmediatePoll();
    stop();

    expect(refreshSocialProvider).not.toHaveBeenCalled();
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-2",
        provider: null,
        status: "ignored",
      }),
      "dev-sync-trigger",
    );
  });

  it("stays off unless the trigger is explicitly enabled", async () => {
    const { startDevSyncTriggerPoller } = await import("./dev-sync-triggers");

    const stop = startDevSyncTriggerPoller({ enabled: false, pollMs: 10 });
    await vi.advanceTimersByTimeAsync(50);
    stop();

    expect(readNativeJsonFile).not.toHaveBeenCalled();
    expect(refreshSocialProvider).not.toHaveBeenCalled();
  });

  it("runs for installed apps on the dev release channel", async () => {
    vi.resetModules();
    loadDesktopReleaseChannelState.mockResolvedValue({
      selectedChannel: "dev",
      installedChannel: "production",
    });
    readNativeJsonFile.mockResolvedValue({
      enabled: true,
      id: "request-3",
      provider: "facebook",
    });
    refreshSocialProvider.mockResolvedValue(undefined);

    const { startDevSyncTriggerPoller } = await import("./dev-sync-triggers");

    const stop = startDevSyncTriggerPoller({ pollMs: 10 });
    await flushImmediatePoll();
    stop();

    expect(loadDesktopReleaseChannelState).toHaveBeenCalled();
    expect(refreshSocialProvider).toHaveBeenCalledWith("facebook");
  });
});
