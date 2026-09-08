/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useLibraryFriendCandidateReview } from "./useLibraryFriendCandidateReview.js";

const mocks = vi.hoisted(() => ({ queryLibraryCore: vi.fn() }));
vi.mock("../context/PlatformContext.js", () => ({
  usePlatform: () => mocks,
}));

it("does not query again for new arrays with unchanged contents", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  let sourceVersion = 1;
  let dismissed = "candidate-one";
  mocks.queryLibraryCore.mockResolvedValue({ rows: [] });
  function Harness() {
    useLibraryFriendCandidateReview({
      contactSuggestions: [],
      dismissedSuggestionIds: [dismissed],
      sourceVersion,
    });
    return null;
  }
  try {
    await act(async () => {
      root.render(<Harness />);
    });
    expect(mocks.queryLibraryCore).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(<Harness />);
    });
    expect(mocks.queryLibraryCore).toHaveBeenCalledTimes(1);
    sourceVersion = 2;
    await act(async () => {
      root.render(<Harness />);
    });
    expect(mocks.queryLibraryCore).toHaveBeenCalledTimes(2);
    dismissed = "candidate-two";
    await act(async () => {
      root.render(<Harness />);
    });
    expect(mocks.queryLibraryCore).toHaveBeenCalledTimes(3);
    expect(
      mocks.queryLibraryCore.mock.lastCall?.[0].dismissedSuggestionIds,
    ).toEqual(["candidate-two"]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
