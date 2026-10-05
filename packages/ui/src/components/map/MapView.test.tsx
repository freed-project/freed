/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaseAppState, FeedItem, Friend, ResolvedLocationItem } from "@freed/shared";

const setMapLocationCounts = vi.hoisted(() => vi.fn());
const resolvedItems = vi.hoisted(() => [] as ResolvedLocationItem[]);
const surface = vi.hoisted(() => ({ props: null as any, mapMode: "friends" }));

const appState = {
  searchCorpusVersion: 1,
  selectedPersonId: null,
  selectedAccountId: null,
  setSelectedPerson: vi.fn(),
  setSelectedAccount: vi.fn(),
  setSelectedItem: vi.fn(),
  setActiveView: vi.fn(),
  setFilter: vi.fn(),
  setSearchQuery: vi.fn(),
  setMapLocationCounts,
} as unknown as BaseAppState;

vi.mock("../../context/PlatformContext.js", () => ({
  useAppStore: <T,>(selector: (state: BaseAppState) => T) => selector(appState),
  usePlatform: () => ({ geographicMapMode: "online" }),
}));

vi.mock("../../hooks/useLibrarySurfaceItems.js", () => ({
  useLibraryMapCandidates: () => [],
}));

vi.mock("../../hooks/useResolvedLocations.js", () => ({
  useResolvedLocationCandidates: () => ({ resolvedItems }),
}));

vi.mock("../../lib/device-display-preferences.js", () => ({
  useDeviceDisplayPreferences: () => [{ mapMode: surface.mapMode }, vi.fn()],
}));

vi.mock("../../lib/theme.js", () => ({
  useAppliedThemeId: () => "system",
}));

vi.mock("./MapSurface.js", () => ({
  MapSurface: (props: any) => { surface.props = props; return null; },
}));

import { MapView } from "./MapView";

function item(globalId: string, authorId: string, publishedAt: number): FeedItem {
  return {
    globalId,
    platform: "instagram",
    contentType: "post",
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: authorId,
      handle: authorId,
      displayName: authorId,
    },
    content: {
      text: "Mapped update",
      mediaUrls: [],
      mediaTypes: [],
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

describe("MapView location counts", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    resolvedItems.splice(0);
    setMapLocationCounts.mockReset();
    surface.mapMode = "friends";
    appState.selectedAccountId = null;
    appState.selectedPersonId = null;
  });

  it("focuses an untracked author Account in the all-content map without a Friend identity", async () => {
    surface.mapMode = "all_content";
    appState.selectedAccountId = "social:instagram:original";
    resolvedItems.push({ accountId: appState.selectedAccountId, friend: null,
      item: item("instagram:original", "original", Date.now()), lat: 1, lng: 2, label: "Synthetic place" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<MapView />));
    expect(surface.props.markers).toHaveLength(1);
    expect(surface.props.markers[0].friend).toBeNull();
    expect(surface.props.focusedMarkerKey).toBe(surface.props.markers[0].key);
    expect(setMapLocationCounts).toHaveBeenLastCalledWith(0, 1);
  });

  it("publishes the rendered Friend and all-content marker counts", async () => {
    const now = Date.now();
    const friend: Friend = {
      id: "friend-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      sources: [],
      careLevel: 4,
      createdAt: now,
      updatedAt: now,
    };
    resolvedItems.push(
      {
        accountId: null,
        friend,
        item: item("instagram:ada", "ada", now),
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
      {
        accountId: null,
        friend: null,
        item: item("instagram:grace", "grace", now - 1_000),
        lat: 51.5072,
        lng: -0.1276,
        label: "London",
      },
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<MapView />);
    });

    expect(setMapLocationCounts).toHaveBeenLastCalledWith(1, 2);
  });
});
