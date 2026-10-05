import { describe, expect, it } from "vitest";
import { formatFeedItemCount, resolveFeedCountPresentation } from "./feed-count-presentation.js";

const saved = JSON.stringify({ kind: "saved", filter: { savedOnly: true } });
const unified = JSON.stringify({ kind: "ordinary", filter: {} });

describe("feed count availability", () => {
  it("never turns a failed Saved query into zero items or the Unified count", () => {
    const result = resolveFeedCountPresentation({ selectionIdentity: saved,
      current: true, status: "failed", totalCount: 0,
      lastKnown: { selectionIdentity: unified, count: 22_344 },
    });
    expect(result).toEqual({ status: "failed", lastKnownCount: null });
    expect(formatFeedItemCount(result)).toBe("Item count unavailable");
  });

  it("retains the same Saved selection's last proved count and labels loading/error", () => {
    for (const status of ["loading", "failed"] as const) {
      const result = resolveFeedCountPresentation({ selectionIdentity: saved,
        current: true, status, totalCount: 0,
        lastKnown: { selectionIdentity: saved, count: 50 },
      });
      expect(result).toEqual({ status, lastKnownCount: 50 });
      expect(formatFeedItemCount(result)).toBe(status === "loading"
        ? "50 items • Updating" : "50 items • Could not refresh");
    }
  });

  it("shows loading for a new filter while the old query still has results", () => {
    const result = resolveFeedCountPresentation({ selectionIdentity: saved,
      current: false, status: "ready", totalCount: 22_344,
      lastKnown: { selectionIdentity: unified, count: 22_344 },
    });
    expect(formatFeedItemCount(result)).toBe("Loading items");
  });

  it("shows zero only after the current query succeeds with no rows", () => {
    const result = resolveFeedCountPresentation({ selectionIdentity: saved,
      current: true, status: "ready", totalCount: 0, lastKnown: null,
    });
    expect(result).toBe(0);
    expect(formatFeedItemCount(result)).toBe("0 items");
    expect(formatFeedItemCount(1)).toBe("1 item");
    expect(formatFeedItemCount(22_344)).toBe(`${(22_344).toLocaleString()} items`);
  });
});
