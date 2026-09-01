/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import {
  useFeedSignalCounts,
  type FeedSignalCounts,
} from "./useFeedSignalCounts.js";

const EMPTY_COUNTS: FeedSignalCounts = {
  all: 0,
  inspiring: 0,
  events: 0,
  personal: 0,
  conversation: 0,
  news: 0,
};

function Harness({
  enabled = true,
  onReady,
}: {
  enabled?: boolean;
  onReady: (counts: FeedSignalCounts) => void;
}) {
  onReady(useFeedSignalCounts({}, 1, enabled));
  return null;
}

describe("useFeedSignalCounts", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }

  async function render(
    config: Partial<PlatformConfig>,
    enabled = true,
  ) {
    mount();
    let current: FeedSignalCounts | null = null;
    await act(async () => {
      root!.render(
        <PlatformProvider value={config as PlatformConfig}>
          <Harness
            enabled={enabled}
            onReady={(counts) => {
              current = counts;
            }}
          />
        </PlatformProvider>,
      );
    });
    return () => current;
  }

  it("reads platform aggregates without streaming the corpus", async () => {
    const nativeCounts: FeedSignalCounts = {
      all: 20_085,
      inspiring: 2_004,
      events: 312,
      personal: 141,
      conversation: 845,
      news: 4_220,
    };
    const readFeedSignalCounts = vi.fn(async () => nativeCounts);
    const read = await render({ readFeedSignalCounts });

    await vi.waitFor(() => {
      expect(read()?.all).toBe(20_085);
    });
    expect(read()).toEqual(nativeCounts);
    expect(readFeedSignalCounts).toHaveBeenCalledOnce();
  });

  it("reads nothing before the library reports initialized", async () => {
    // The bounded scanner pins the projection source. Asking for it during
    // startup made the persistence worker log a fatal-looking console error.
    const readFeedSignalCounts = vi.fn(async () => EMPTY_COUNTS);
    const read = await render({ readFeedSignalCounts }, false);

    expect(read()!.all).toBe(0);
    expect(readFeedSignalCounts).not.toHaveBeenCalled();
  });

  it("fails closed when the aggregate query rejects", async () => {
    const readFeedSignalCounts = vi.fn(async () => {
      throw new Error("stale source");
    });
    const read = await render({ readFeedSignalCounts });

    await vi.waitFor(() => {
      expect(read()?.all).toBe(0);
    });
    expect(readFeedSignalCounts).toHaveBeenCalledOnce();
  });
});
