import { describe, expect, it } from "vitest";
import {
  canonicalizeFilterOptions,
  navigationStatesEqual,
  parseNavigationState,
  serializeNavigationState,
} from "@freed/shared";

describe("navigation state", () => {
  it("preserves signal filters on saved views", () => {
    const state = {
      activeView: "feed" as const,
      activeFilter: {
        savedOnly: true,
        signals: ["news", "essay"] as const,
      },
      selectedItemId: null,
    };

    const serialized = serializeNavigationState(state);

    expect(serialized).toBe("/?scope=saved&signal=essay&signal=news");
    expect(parseNavigationState(serialized)).toEqual({
      activeView: "feed",
      activeFilter: {
        savedOnly: true,
        signals: ["essay", "news"],
      },
      selectedItemId: null,
    });
  });

  it("preserves signal filters on archived views", () => {
    const state = {
      activeView: "feed" as const,
      activeFilter: {
        archivedOnly: true,
        signals: ["discussion"] as const,
      },
      selectedItemId: null,
    };

    const serialized = serializeNavigationState(state);

    expect(serialized).toBe("/?scope=archived&signal=discussion");
    expect(parseNavigationState(serialized)).toEqual({
      activeView: "feed",
      activeFilter: {
        archivedOnly: true,
        signals: ["discussion"],
      },
      selectedItemId: null,
    });
  });

  it("treats saved signal filters as canonical instead of stripping them", () => {
    const raw = {
      savedOnly: true,
      signals: ["news", "essay", "news"] as const,
    };

    expect(canonicalizeFilterOptions(raw)).toEqual({
      savedOnly: true,
      signals: ["essay", "news"],
    });
    expect(
      navigationStatesEqual(
        {
          activeView: "feed",
          activeFilter: raw,
          selectedItemId: null,
        },
        {
          activeView: "feed",
          activeFilter: {
            savedOnly: true,
            signals: ["essay", "news"],
          },
          selectedItemId: null,
        },
      ),
    ).toBe(true);
  });
});
