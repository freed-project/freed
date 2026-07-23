import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshSocialProvider = vi.fn();

vi.mock("./capture", () => ({ refreshSocialProvider }));

describe("authenticated essay poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    refreshSocialProvider.mockReset().mockResolvedValue({ status: "ignored" });
  });

  afterEach(async () => {
    const { stopAuthenticatedEssayPoller } = await import(
      "./authenticated-essay-poller"
    );
    stopAuthenticatedEssayPoller();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs both beta providers outside the RSS poll job", async () => {
    const { startAuthenticatedEssayPoller } = await import(
      "./authenticated-essay-poller"
    );
    startAuthenticatedEssayPoller({
      startupMinMs: 1_000,
      startupJitterMs: 0,
      intervalMinMs: 5_000,
      intervalJitterMs: 0,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(refreshSocialProvider).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(refreshSocialProvider.mock.calls).toEqual([
      ["substack", "scheduled"],
      ["medium", "scheduled"],
    ]);
  });

  it("stops future scheduled capture", async () => {
    const {
      startAuthenticatedEssayPoller,
      stopAuthenticatedEssayPoller,
    } = await import("./authenticated-essay-poller");
    startAuthenticatedEssayPoller({
      startupMinMs: 1_000,
      startupJitterMs: 0,
      intervalMinMs: 5_000,
      intervalJitterMs: 0,
    });
    stopAuthenticatedEssayPoller();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshSocialProvider).not.toHaveBeenCalled();
  });
});
