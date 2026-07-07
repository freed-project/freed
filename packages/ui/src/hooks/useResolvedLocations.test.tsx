/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Account, FeedItem, Person } from "@freed/shared";
import { useResolvedLocations } from "./useResolvedLocations";

const geocodeMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/geocoding.js", () => ({
  geocode: geocodeMock,
}));

type ResolvedLocationsSnapshot = ReturnType<typeof useResolvedLocations>;

function makeItem(
  globalId: string,
  name: string,
  publishedAt: number,
  authorId: string = globalId,
): FeedItem {
  return {
    globalId,
    platform: "instagram",
    contentType: "post",
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: authorId,
      handle: authorId,
      displayName: `Author ${authorId}`,
    },
    content: {
      text: `Post from ${name}`,
      mediaUrls: [],
      mediaTypes: [],
    },
    location: {
      name,
      source: "geo_tag",
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function ResolvedLocationsHarness({
  accounts,
  items,
  onSnapshot,
  persons,
}: {
  accounts: Record<string, Account>;
  items: FeedItem[];
  onSnapshot: (snapshot: ResolvedLocationsSnapshot) => void;
  persons: Record<string, Person>;
}) {
  const snapshot = useResolvedLocations(items, persons, accounts);

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

describe("useResolvedLocations", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    geocodeMock.mockReset();
  });

  it("streams resolved named locations without waiting for the slowest geocode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    let resolveLondon: ((value: { latitude: number; longitude: number; name: string }) => void) | null = null;
    geocodeMock.mockImplementation((query: string) => {
      if (query === "Paris") {
        return Promise.resolve({
          latitude: 48.8566,
          longitude: 2.3522,
          name: "Paris, France",
        });
      }

      if (query === "London") {
        return new Promise((resolve) => {
          resolveLondon = resolve;
        });
      }

      return Promise.resolve(null);
    });

    const snapshots: ResolvedLocationsSnapshot[] = [];
    const items = [
      makeItem("paris-1", "Paris", 300, "ada"),
      makeItem("paris-2", "Paris", 200, "ada"),
      makeItem("london-1", "London", 100, "maya"),
    ];

    await act(async () => {
      root!.render(
        <ResolvedLocationsHarness
          accounts={{}}
          items={items}
          persons={{}}
          onSnapshot={(snapshot) => snapshots.push(snapshot)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const partialSnapshot = snapshots.at(-1)!;
    expect(geocodeMock).toHaveBeenCalledTimes(2);
    expect(geocodeMock).toHaveBeenNthCalledWith(1, "Paris");
    expect(geocodeMock).toHaveBeenNthCalledWith(2, "London");
    expect(partialSnapshot.resolvedItems.map((resolved) => resolved.item.globalId)).toEqual([
      "paris-1",
      "paris-2",
    ]);
    expect(partialSnapshot.resolvingCount).toBe(1);

    await act(async () => {
      resolveLondon?.({
        latitude: 51.5072,
        longitude: -0.1276,
        name: "London, United Kingdom",
      });
      await Promise.resolve();
    });

    const completeSnapshot = snapshots.at(-1)!;
    expect(completeSnapshot.resolvedItems.map((resolved) => resolved.item.globalId).sort()).toEqual([
      "london-1",
      "paris-1",
      "paris-2",
    ]);
    expect(completeSnapshot.resolvingCount).toBe(0);
    expect(completeSnapshot.lastResolvedAt).toEqual(expect.any(Number));
  });
});
