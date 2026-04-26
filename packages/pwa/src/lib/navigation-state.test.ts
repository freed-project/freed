import { describe, expect, it } from "vitest";
import {
  canonicalizeFilterOptions,
  navigationStatesEqual,
  parseNavigationState,
  serializeNavigationState,
} from "@freed/shared";
import type { FilterOptions } from "@freed/shared";
import type { NavigationState } from "../../../shared/src/navigation-state";

describe("navigation state", () => {
  it("preserves signal filters on saved views", () => {
    const state: NavigationState = {
      activeView: "feed" as const,
      activeFilter: {
        savedOnly: true,
        signals: ["news", "essay"],
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
    const state: NavigationState = {
      activeView: "feed" as const,
      activeFilter: {
        archivedOnly: true,
        signals: ["discussion"],
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
    const raw: FilterOptions = {
      savedOnly: true,
      signals: ["news", "essay", "news"],
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
