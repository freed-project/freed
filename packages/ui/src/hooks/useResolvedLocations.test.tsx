/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem, LibraryMapLocationCandidate } from "@freed/shared";
import { useResolvedLocationCandidates } from "./useResolvedLocations";

const geocodeMock = vi.hoisted(() => vi.fn());
const cachedGeocodeMock = vi.hoisted(() => vi.fn(() => undefined as any));

vi.mock("../lib/geocoding.js", () => ({
  geocode: geocodeMock,
  peekGeocode: cachedGeocodeMock,
}));

type ResolvedLocationsSnapshot = ReturnType<typeof useResolvedLocationCandidates>;

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
  candidates,
  onSnapshot,
  resolveNamedLocations,
}: {
  candidates: readonly LibraryMapLocationCandidate[];
  onSnapshot: (snapshot: ResolvedLocationsSnapshot) => void;
  resolveNamedLocations?: boolean;
}) {
  const snapshot = useResolvedLocationCandidates(candidates, {
    resolveNamedLocations,
  });

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

describe("useResolvedLocationCandidates", () => {
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
    cachedGeocodeMock.mockReset().mockReturnValue(undefined);
  });

  it("rebinds committed cached coordinates to refreshed rows without clearing named markers", async () => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const geo = { latitude: 48.85, longitude: 2.35, name: "Paris" }; geocodeMock.mockResolvedValue(geo);
    const item = makeItem("synthetic", "Paris", 1); let snapshots: ResolvedLocationsSnapshot[] = [];
    function Probe({ candidates }: { candidates: LibraryMapLocationCandidate[] }) { const value = useResolvedLocationCandidates(candidates); snapshots.push(value); return null; }
    await act(async () => root!.render(<Probe candidates={[{ accountId: "a", friend: null, item }]} />));
    expect(snapshots.at(-1)?.resolvedItems).toHaveLength(1);
    cachedGeocodeMock.mockReturnValue(geo); snapshots = [];
    const fresh = { ...item, content: { ...item.content, text: "Fresh synthetic body" } };
    await act(async () => root!.render(<Probe candidates={[{ accountId: "a", friend: null, item: fresh }]} />));
    expect(snapshots.every(value => value.resolvedItems.length === 1)).toBe(true);
    expect(snapshots.at(-1)?.resolvedItems[0].item).toBe(fresh); expect(geocodeMock).toHaveBeenCalledOnce();
    snapshots = []; await act(async () => root!.render(<Probe candidates={[]} />));
    expect(snapshots.every(value => value.resolvedItems.length === 0)).toBe(true);
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
          candidates={items.map((item) => ({
            accountId: null,
            friend: null,
            item,
          }))}
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

  it("removes obsolete resolved pins immediately and ignores late old geocodes", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    let finishOld!: (geo: { latitude: number; longitude: number; name: string }) => void;
    geocodeMock.mockImplementation((name: string) => name === "Slow" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ latitude: 1, longitude: 2, name }));
    const snapshots: ResolvedLocationsSnapshot[] = [];
    const render = (names: string[]) => root!.render(<ResolvedLocationsHarness candidates={names.map(name => ({ accountId: null, friend: null, item: makeItem(name, name, 100) }))} onSnapshot={value => snapshots.push(value)} />);
    await act(async () => render(["Paris", "Slow"]));
    expect(snapshots.at(-1)!.resolvedItems).toHaveLength(1);
    snapshots.length = 0;
    await act(async () => render(["London"]));
    expect(snapshots.every(value => value.resolvedItems.every(pin => pin.item.globalId !== "Paris"))).toBe(true);
    await act(async () => finishOld({ latitude: 3, longitude: 4, name: "Slow" }));
    expect(snapshots.at(-1)!.resolvedItems.map(pin => pin.item.globalId)).toEqual(["London"]);
    expect(snapshots.at(-1)!.resolvingCount).toBe(0);
  });

  it("keeps local showcase mode from sending named locations to a geocoder", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const snapshots: ResolvedLocationsSnapshot[] = [];

    await act(async () => {
      root!.render(
        <ResolvedLocationsHarness
          candidates={[
            {
              accountId: null,
              friend: null,
              item: makeItem("brooklyn-1", "Brooklyn, NY", 100),
            },
          ]}
          onSnapshot={(snapshot) => snapshots.push(snapshot)}
          resolveNamedLocations={false}
        />,
      );
      await Promise.resolve();
    });

    expect(geocodeMock).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.resolvingCount).toBe(0);
    expect(snapshots.at(-1)?.resolvedItems).toEqual([]);
  });
});
