import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readNativeJsonFile = vi.fn();
const writeNativeJsonFile = vi.fn();
const refreshSocialProvider = vi.fn();
const loadDesktopReleaseChannelState = vi.fn();
const getStoreState = vi.fn();
const initializeStore = vi.fn();
const hasAcceptedDesktopBundle = vi.fn();

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

vi.mock("./legal-consent", () => ({
  hasAcceptedDesktopBundle,
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: getStoreState,
  },
}));

vi.mock("./logger", () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

async function flushImmediatePoll() {
  for (let index = 0; index < 10; index += 1) {
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
    getStoreState.mockReset();
    initializeStore.mockReset();
    hasAcceptedDesktopBundle.mockReset();
    hasAcceptedDesktopBundle.mockResolvedValue(true);
    getStoreState.mockReturnValue({ isInitialized: true });
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

  it("initializes the store before running a provider trigger", async () => {
    const { installDevSyncTriggerBridge } = await import("./dev-sync-triggers");
    refreshSocialProvider.mockResolvedValue(undefined);
    initializeStore.mockResolvedValue(undefined);
    getStoreState
      .mockReturnValueOnce({ isInitialized: false, initialize: initializeStore })
      .mockReturnValueOnce({ isInitialized: false, initialize: initializeStore })
      .mockReturnValue({ isInitialized: true });

    const stop = installDevSyncTriggerBridge();
    const triggerPromise = window.__FREED_RUN_SOCIAL_SYNC__?.({
      id: "request-native-startup",
      provider: "facebook",
    });
    await triggerPromise;
    stop();

    expect(initializeStore).toHaveBeenCalled();
    expect(refreshSocialProvider).toHaveBeenCalledWith("facebook");
    expect(writeNativeJsonFile).toHaveBeenLastCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-native-startup",
        provider: "facebook",
        status: "completed",
      }),
      "dev-sync-trigger",
    );
  });

  it("fails before provider traffic when Desktop legal consent is missing", async () => {
    const { installDevSyncTriggerBridge } = await import("./dev-sync-triggers");
    hasAcceptedDesktopBundle.mockResolvedValue(false);

    const stop = installDevSyncTriggerBridge();
    await window.__FREED_RUN_SOCIAL_SYNC__?.({
      id: "request-native-legal",
      provider: "facebook",
    });
    stop();

    expect(initializeStore).not.toHaveBeenCalled();
    expect(refreshSocialProvider).not.toHaveBeenCalled();
    expect(writeNativeJsonFile).toHaveBeenCalledWith(
      "dev-sync-trigger-result.json",
      expect.objectContaining({
        id: "request-native-legal",
        provider: "facebook",
        status: "error",
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
