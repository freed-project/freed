import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readNativeJsonFile = vi.fn();
const writeNativeJsonFile = vi.fn();
const refreshSocialProvider = vi.fn();

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
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
