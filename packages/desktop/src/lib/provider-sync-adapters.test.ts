import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSocialProvider = vi.fn();
const runBackgroundJob = vi.fn(async (task: { run: () => Promise<unknown> }) => task.run());

vi.mock("./capture", () => ({ refreshSocialProvider }));
vi.mock("./background-runtime-coordinator", () => ({ runBackgroundJob }));

describe("provider sync adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshSocialProvider.mockResolvedValue({
      provider: "x",
      status: "success",
      postsExtracted: 1,
      itemsAdded: 1,
    });
  });

  it("preserves the X adapter and retains operation ownership through settlement", async () => {
    const { runScheduledProviderAdapter } = await import("./provider-sync-adapters");
    const onProviderContact = vi.fn();
    await runScheduledProviderAdapter("x", onProviderContact);

    expect(runBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "social-scrape",
        source: "provider-scheduler:x",
        retainUntilSettledAfterTimeout: true,
      }),
    );
    expect(refreshSocialProvider).toHaveBeenCalledWith(
      "x",
      "scheduled",
      onProviderContact,
    );
  });

  it("does not nest coordinator ownership for adapters that already own it", async () => {
    const { runScheduledProviderAdapter } = await import("./provider-sync-adapters");
    const onProviderContact = vi.fn();
    await runScheduledProviderAdapter("facebook", onProviderContact);

    expect(runBackgroundJob).not.toHaveBeenCalled();
    expect(refreshSocialProvider).toHaveBeenCalledWith(
      "facebook",
      "scheduled",
      onProviderContact,
    );
  });
});
