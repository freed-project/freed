import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();

vi.mock("./logger", () => ({
  log: {
    warn,
  },
}));

describe("safeUnlisten", () => {
  beforeEach(() => {
    warn.mockReset();
  });

  it("calls an active unlisten callback", async () => {
    const { safeUnlisten } = await import("./safe-unlisten");
    const unlisten = vi.fn();

    safeUnlisten(unlisten, "active");

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs and suppresses stale listener cleanup errors", async () => {
    const { safeUnlisten } = await import("./safe-unlisten");

    expect(() => {
      safeUnlisten(() => {
        throw new Error("missing listener");
      }, "stale");
    }).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      "[event-listener] ignored stale listener cleanup label=stale error=missing listener",
    );
  });
});
