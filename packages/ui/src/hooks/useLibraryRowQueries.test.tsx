/**
 * @vitest-environment jsdom
 */
import { act, useMemo, type ReactNode } from "react";
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
import type {
  Account,
  FeedItem,
  FilterOptions,
  LibraryMapLocationCandidate,
  Person,
  StoryWallCandidate,
} from "@freed/shared";
import type {
  LibraryCoreNormalizedQueryExecutor,
  LibraryCoreAccountGraphPageResponseV1,
  LibraryCoreAccountGraphRowV1,
  LibraryCoreFriendsDirectoryPageResponseV1,
  LibraryCoreFriendsDirectoryPageRequestV1,
  LibraryCoreFriendsDirectoryRowV1,
  LibraryCoreRssFeedPageResponseV1,
  LibraryCoreRssFeedPageRowV1,
} from "@freed/shared/library-core";
import {
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  libraryCoreFriendsDirectoryBindingDigestV1,
} from "@freed/shared/library-core";
import {
  PlatformProvider,
  type LibraryFacetSummary,
  type LibraryFriendsGraph,
  type LibraryFriendsGraphRequest,
  type LibraryFriendsSource,
  type LibraryPersonTimelineRequest,
  type LibraryPersonTimelinePage,
  type LibrarySavedAnalytics,
  type LibrarySavedAnalyticsRequest,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLibraryFacetSummary } from "./useLibraryFacetSummary.js";
import {
  useLibrarySavedAnalytics,
  type LibrarySavedAnalyticsState,
} from "./useLibrarySavedAnalytics.js";
import {
  useLibraryMapCandidates,
  useLibraryStoryWallCandidates,
} from "./useLibrarySurfaceItems.js";
import {
  useLibraryAccountDetail,
  useLibraryPersonDetail,
  type LibraryIdentityDetailResult,
} from "./useLibraryIdentityDetail.js";
import {
  useLibraryFriendsRows,
  type LibraryFriendsRowsState,
} from "./useLibraryFriendsRows.js";
import { createLibrarySavedAnalyticsRequest } from "../lib/saved-library-analytics.js";
import {
  useLibraryRssFeedPage,
  type LibraryRssFeedPageState,
} from "./useLibraryRssFeedPage.js";
import {
  useLibrarySocialChannelPage,
  type LibrarySocialChannelPageState,
} from "./useLibrarySocialChannelPage.js";
import {
  useLibraryFilterScopeSummary,
  type LibraryFilterScopeSummaryState,
} from "./useLibraryFilterScopeSummary.js";
import {
  useLibraryFriendsDirectory,
  type LibraryFriendsDirectoryState,
} from "./useLibraryFriendsDirectory.js";
import { useLibraryAccountLinkCandidates } from "./useLibraryAccountLinkCandidates.js";
import type { AccountLinkSuggestion } from "../lib/account-link-suggestion.js";

function item(globalId: string): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

function platformConfig(
  overrides: Partial<
    Pick<
      PlatformConfig,
      | "readLibraryAccountDetail"
      | "readLibraryFacetSummary"
      | "readLibraryFriendsGraph"
      | "readLibraryFriendsLocationItem"
      | "readLibraryMapCandidates"
      | "readLibraryPersonTimeline"
      | "readLibraryPersonDetail"
      | "readLibrarySavedAnalytics"
      | "readLibraryStoryWallCandidates"
      | "queryLibraryCore"
    >
  >,
): PlatformConfig {
  return {
    store: (() => undefined) as unknown as PlatformConfig["store"],
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: null,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
    GoogleContactsSettingsContent: null,
    ...overrides,
  };
}

function IdentityDetailHarness({
  accountId,
  onAccount,
  onPerson,
  personId,
}: {
  accountId: string | null;
  onAccount: (state: LibraryIdentityDetailResult<Account>) => void;
  onPerson: (state: LibraryIdentityDetailResult<Person>) => void;
  personId: string | null;
}) {
  onAccount(useLibraryAccountDetail(accountId, 12));
  onPerson(useLibraryPersonDetail(personId, 12));
  return null;
}

function AccountLinkCandidatesHarness({
  entityId,
  entityKind,
  onRows,
  sourceVersion,
}: {
  entityId: string | null;
  entityKind: "account" | "person";
  onRows: (rows: readonly AccountLinkSuggestion[]) => void;
  sourceVersion: number;
}) {
  onRows(
    useLibraryAccountLinkCandidates({ entityId, entityKind, sourceVersion }),
  );
  return null;
}

function SurfaceHarness({
  onItems,
}: {
  onItems: (items: readonly StoryWallCandidate[]) => void;
}) {
  onItems(useLibraryStoryWallCandidates(7));
  return null;
}

function MapHarness({
  onCandidates,
}: {
  onCandidates: (candidates: readonly LibraryMapLocationCandidate[]) => void;
}) {
  onCandidates(useLibraryMapCandidates(7));
  return null;
}

function FacetHarness({
  onSummaries,
}: {
  onSummaries: (summaries: readonly LibraryFacetSummary[]) => void;
}) {
  const first = useLibraryFacetSummary(8);
  const second = useLibraryFacetSummary(8);
  onSummaries([first, second]);
  return null;
}

function FilterScopeHarness({
  filter,
  onState,
  sourceVersion = 8,
}: {
  filter: FilterOptions;
  onState: (state: LibraryFilterScopeSummaryState) => void;
  sourceVersion?: number;
}) {
  onState(useLibraryFilterScopeSummary(filter, sourceVersion));
  return null;
}

function SavedAnalyticsHarness({
  sourceVersion = 9,
  onState,
}: {
  sourceVersion?: number;
  onState: (state: LibrarySavedAnalyticsState) => void;
}) {
  onState(useLibrarySavedAnalytics(sourceVersion));
  return null;
}

const friendsGraphRequest: LibraryFriendsGraphRequest = {
  sources: [{ platform: "rss", authorId: "author" }],
  rssFeedUrls: [],
  recentWindow: { startMs: 1, endMs: 1_000 },
};

function friendsGraph(
  totalItemCount: number,
  {
    hasLocation,
    locationCandidateCount = 0,
    locationCandidates = [],
    sourceToken = "friends-source-1",
  }: {
    hasLocation?: boolean;
    locationCandidateCount?: number;
    locationCandidates?: LibraryFriendsGraph["social"][number]["locationCandidates"];
    sourceToken?: string;
  } = {},
): LibraryFriendsGraph {
  return {
    sourceToken,
    totalItemCount,
    social: [
      {
        platform: "rss",
        authorId: "author",
        itemCount: totalItemCount,
        latestActivityAt: totalItemCount,
        hasLocation: hasLocation ?? locationCandidateCount > 0,
        locationCandidateCount,
        locationCandidates,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        avatarUrl: null,
        sampleItems: [],
        recentCount: 0,
        signalCounts: [],
      },
    ],
    rss: [],
  };
}

function locationItem(globalId: string, publishedAt: number): FeedItem {
  return {
    ...item(globalId),
    capturedAt: publishedAt,
    publishedAt,
    location: {
      name: "London",
      source: "geo_tag",
    },
  };
}

function coordinateLocationItem(
  globalId: string,
  publishedAt: number,
  lat: number,
  lng: number,
): FeedItem {
  return {
    ...locationItem(globalId, publishedAt),
    location: {
      name: globalId,
      coordinates: { lat, lng },
      source: "geo_tag",
    },
  };
}

function FriendsHarness({
  locationSources,
  sourceVersion,
  timelineIdentity,
  timelineSources = friendsGraphRequest.sources,
  onState,
}: {
  locationSources?: readonly LibraryFriendsSource[];
  sourceVersion: number;
  timelineIdentity?: LibraryPersonTimelineRequest | null;
  timelineSources?: readonly LibraryFriendsSource[];
  onState: (state: LibraryFriendsRowsState) => void;
}) {
  const resolvedTimelineIdentity = useMemo<LibraryPersonTimelineRequest | null>(
    () =>
      timelineIdentity === undefined
        ? timelineSources.length > 0
          ? { personId: "person-1" }
          : null
        : timelineIdentity,
    [timelineIdentity, timelineSources.length],
  );
  onState(
    useLibraryFriendsRows({
      graphRequest: friendsGraphRequest,
      locationSources: locationSources ?? timelineSources,
      timelineIdentity: resolvedTimelineIdentity,
      timelineSources,
      sourceVersion,
    }),
  );
  return null;
}

function RssFeedPageHarness({
  onState,
  search,
}: {
  onState: (state: LibraryRssFeedPageState) => void;
  search: string;
}) {
  onState(
    useLibraryRssFeedPage({
      enabledOnly: true,
      pageSize: 2,
      search,
      sourceVersion: 1,
    }),
  );
  return null;
}

function SocialChannelPageHarness({
  enabled = true,
  onState,
  query,
}: {
  enabled?: boolean;
  onState: (state: LibrarySocialChannelPageState) => void;
  query: string;
}) {
  onState(useLibrarySocialChannelPage({ enabled, query, sourceVersion: 1 }));
  return null;
}

function FriendsDirectoryHarness({
  onState,
  search = "",
}: {
  onState: (state: LibraryFriendsDirectoryState) => void;
  search?: string;
}) {
  onState(
    useLibraryFriendsDirectory({
      filters: [],
      search,
      sort: "name",
      sourceVersion: 1,
    }),
  );
  return null;
}

function rssFeedRow(
  url: string,
  title: string,
  enabled = true,
): LibraryCoreRssFeedPageRowV1 {
  return {
    activityCount: 3,
    enabled,
    folder: null,
    imageUrl: null,
    lastFetched: null,
    latestActivityAt: null,
    pollInterval: null,
    sampleBatchId: null,
    sampleGeneratedAt: null,
    sampleGeneratorVersion: null,
    siteUrl: null,
    title,
    trackUnread: true,
    unreadCount: 2,
    updatedAt: 1,
    url,
  };
}

function rssFeedResponse(
  rows: readonly LibraryCoreRssFeedPageRowV1[],
  nextCursor: string | null,
): LibraryCoreRssFeedPageResponseV1 {
  return {
    layoutRevision: 1,
    nextCursor,
    queryId: "rss_feed_page_v1",
    rows,
    schemaVersion: 1,
    source: {
      generationId: "a".repeat(64) as never,
      projectionRevision: 1,
      transitionSequence: 1,
    },
  };
}

function accountGraphRow(
  id: string,
  personName: string | null,
): LibraryCoreAccountGraphRowV1 {
  return {
    activityCount: 3,
    avatarUrl: null,
    discoveredFrom: "captured_item",
    displayName: id,
    externalId: id,
    firstSeenAt: 1,
    followRosterActive: true,
    graphPinned: false,
    graphUpdatedAt: null,
    graphX: null,
    graphY: null,
    handle: id,
    id,
    kind: "social",
    lastSeenAt: 2,
    latestActivityAt: 2,
    personId: personName ? `person-${id}` : null,
    personName,
    provider: "x",
    updatedAt: 2,
  };
}

function accountGraphResponse(
  rows: readonly LibraryCoreAccountGraphRowV1[],
  nextCursor: string | null,
): LibraryCoreAccountGraphPageResponseV1 {
  return {
    layoutRevision: 1,
    nextCursor,
    queryId: "account_graph_page_v1",
    rows,
    schemaVersion: 1,
    source: {
      generationId: "a".repeat(64) as never,
      projectionRevision: 1,
      transitionSequence: 1,
    },
  };
}

function friendsDirectoryRow(id: string): LibraryCoreFriendsDirectoryRowV1 {
  return {
    avatarUrl: null,
    bio: null,
    careLevel: 3,
    hasLocation: false,
    id,
    isRecentlyActive: false,
    lastContactAt: null,
    latestActivityAt: null,
    latestAvatarUrl: null,
    name: id,
    needsOutreach: false,
    reachOutIntervalDays: null,
    relationshipStatus: "friend",
  };
}

function friendsDirectoryResponse(
  rows: readonly LibraryCoreFriendsDirectoryRowV1[],
  nextCursor: string | null,
): LibraryCoreFriendsDirectoryPageResponseV1 {
  return {
    nextCursor,
    queryId: "friends_directory_page_v1",
    rows,
    schemaVersion: 1,
    source: {
      generationId: "a".repeat(64) as never,
      projectionRevision: 1,
      transitionSequence: 1,
    },
    totalCount: 130,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Library row query hooks", () => {
  it("retains only the exact selected Person and Account SQLite rows", async () => {
    const person: Person = {
      careLevel: 5,
      createdAt: 1,
      id: "person-ada",
      name: "Ada",
      relationshipStatus: "friend",
      updatedAt: 2,
    };
    const account: Account = {
      createdAt: 1,
      discoveredFrom: "captured_item",
      externalId: "ada",
      firstSeenAt: 1,
      id: "account-ada",
      kind: "social",
      lastSeenAt: 2,
      personId: person.id,
      provider: "x",
      updatedAt: 2,
    };
    const readLibraryPersonDetail = vi.fn(async () => person);
    const readLibraryAccountDetail = vi.fn(async () => account);
    const config = platformConfig({
      readLibraryAccountDetail,
      readLibraryPersonDetail,
    });
    let personState: LibraryIdentityDetailResult<Person> | null = null;
    let accountState: LibraryIdentityDetailResult<Account> | null = null;

    renderHarness(
      <PlatformProvider value={config}>
        <IdentityDetailHarness
          accountId={account.id}
          onAccount={(state) => {
            accountState = state;
          }}
          onPerson={(state) => {
            personState = state;
          }}
          personId={person.id}
        />
      </PlatformProvider>,
    );
    await flush();
    await flush();

    expect(personState).toEqual({ status: "ready", value: person });
    expect(accountState).toEqual({ status: "ready", value: account });
    expect(readLibraryPersonDetail).toHaveBeenCalledOnce();
    expect(readLibraryAccountDetail).toHaveBeenCalledOnce();
  });

  it("retains only selected Account link candidates from SQLite", async () => {
    const queryLibraryCore = vi.fn(async () => ({
      queryId: "account_link_candidates_v1",
      rows: [
        {
          accountId: "account-ada",
          confidence: "high",
          personId: "person-ada",
          reason: "Same handle as an account already linked to this friend.",
          score: 95,
        },
      ],
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 12,
        transitionSequence: 12,
      },
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    let rows: readonly AccountLinkSuggestion[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ queryLibraryCore })}>
        <AccountLinkCandidatesHarness
          entityId="account-ada"
          entityKind="account"
          onRows={(next) => {
            rows = next;
          }}
          sourceVersion={12}
        />
      </PlatformProvider>,
    );
    await flush();
    await flush();

    expect(queryLibraryCore).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "account-ada",
        entityKind: "account",
        limit: 5,
        queryId: "account_link_candidates_v1",
        schemaVersion: 1,
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        accountId: "account-ada",
        personId: "person-ada",
        score: 95,
      }),
    ]);
  });

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
    vi.useRealTimers();
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  function renderHarness(node: ReactNode): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(node));
  }

  it("preserves the legacy duplicate hour across spring-forward DST", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const request = createLibrarySavedAnalyticsRequest(
        new Date("2026-03-08T12:00:00-07:00"),
      );
      const repeatedWindow = {
        startMs: 1_772_964_000_000,
        endMs: 1_772_967_600_000,
      };

      expect(
        request.hourlyWindows.filter(
          (window) =>
            window.startMs === repeatedWindow.startMs &&
            window.endMs === repeatedWindow.endMs,
        ),
      ).toHaveLength(2);
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it("loads bounded native Story Wall rows", async () => {
    const candidate = {
      accountId: "account-1",
      item: item("native-story"),
      personId: "person-1",
    };
    const readLibraryStoryWallCandidates = vi.fn(async () => [candidate]);
    let current: readonly StoryWallCandidate[] = [];
    renderHarness(
      <PlatformProvider
        value={platformConfig({ readLibraryStoryWallCandidates })}
      >
        <SurfaceHarness
          onItems={(items) => {
            current = items;
          }}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current.map((candidate) => candidate.item.globalId)).toEqual([
      "native-story",
    ]);
    expect(readLibraryStoryWallCandidates).toHaveBeenCalledOnce();
  });

  it("loads bounded Map rows with their SQLite-joined Friend identity", async () => {
    const candidate: LibraryMapLocationCandidate = {
      accountId: "account-1",
      item: item("native-map"),
      friend: {
        id: "person-1",
        name: "Ada",
        relationshipStatus: "friend",
      },
    };
    const readLibraryMapCandidates = vi.fn(async () => [candidate]);
    let current: readonly LibraryMapLocationCandidate[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibraryMapCandidates })}>
        <MapHarness
          onCandidates={(rows) => {
            current = rows;
          }}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current).toEqual([candidate]);
    expect(readLibraryMapCandidates).toHaveBeenCalledOnce();
  });

  it("fails closed when the surface query boundary is unavailable", async () => {
    let current: readonly StoryWallCandidate[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({})}>
        <SurfaceHarness
          onItems={(items) => {
            current = items;
          }}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current).toEqual([]);
  });

  it("shares one exact facet query across multiple consumers", async () => {
    const summary: LibraryFacetSummary = {
      archivedCount: 2,
      archivableCount: 1,
      contactAccountCount: 1,
      contactLinkedPersonCount: 1,
      enabledRssFeedCount: 1,
      friendPersonCount: 2,
      latestContactImportedAt: 3,
      latestRssFeedFetchedAt: 2,
      platformCounts: [
        {
          archivableCount: 1,
          latestCapturedAt: 2,
          latestPublishedAt: 1,
          platform: "rss",
          totalCount: 10,
          unreadCount: 4,
        },
      ],
      rssFeedCount: 1,
      sampleAccountCount: 1,
      sampleFeedCount: 1,
      sampleItemCount: 5,
      samplePersonCount: 1,
      savedArchivedCount: 1,
      savedCount: 3,
      savedPlatformCount: 4,
      socialAccountCount: 3,
      tags: ["alpha", "beta"],
      totalCount: 10,
      unreadCount: 4,
    };
    const readLibraryFacetSummary = vi.fn(async () => summary);
    let current: readonly LibraryFacetSummary[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibraryFacetSummary })}>
        <FacetHarness
          onSummaries={(summaries) => {
            current = summaries;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    expect(readLibraryFacetSummary).toHaveBeenCalledOnce();
    expect(current).toEqual([summary, summary]);
  });

  it("loads Saved analytics through the typed query boundary", async () => {
    const analytics: LibrarySavedAnalytics = {
      totalCount: 9,
      latestSavedAt: 900,
      dailyCounts: [0, 0, 0, 0, 1, 2, 3],
      hourlyCounts: Array.from({ length: 24 }, (_, index) => index),
      sourceCounts: [
        { label: "zeta.example", count: 2 },
        { label: "beta.example", count: 4 },
        { label: "alpha.example", count: 4 },
        { label: "gamma.example", count: 3 },
        { label: "epsilon.example", count: 2 },
        { label: "delta.example", count: 2 },
      ],
      contentMix: [
        { label: "video", count: 2 },
        { label: "article", count: 5 },
      ],
    };
    const readLibrarySavedAnalytics = vi.fn(
      async (_request: LibrarySavedAnalyticsRequest) => analytics,
    );
    let current: LibrarySavedAnalyticsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibrarySavedAnalytics,
        })}
      >
        <SavedAnalyticsHarness
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledOnce();
    const request = readLibrarySavedAnalytics.mock.calls[0][0];
    expect(request.dailyWindows).toHaveLength(7);
    expect(request.hourlyWindows).toHaveLength(24);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.sourceCounts,
    ).toEqual([
      { label: "alpha.example", count: 4 },
      { label: "beta.example", count: 4 },
      { label: "gamma.example", count: 3 },
      { label: "delta.example", count: 2 },
      { label: "epsilon.example", count: 2 },
    ]);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.contentMix,
    ).toEqual([
      { label: "article", count: 5 },
      { label: "video", count: 2 },
    ]);
  });

  it("refreshes Saved analytics when the SQLite source version changes", async () => {
    const first: LibrarySavedAnalytics = {
      totalCount: 1,
      latestSavedAt: 100,
      dailyCounts: [0, 0, 0, 0, 0, 0, 1],
      hourlyCounts: [...Array<number>(23).fill(0), 1],
      sourceCounts: [{ label: "one.example", count: 1 }],
      contentMix: [{ label: "article", count: 1 }],
    };
    const second: LibrarySavedAnalytics = {
      ...first,
      totalCount: 2,
      latestSavedAt: 200,
      dailyCounts: [0, 0, 0, 0, 0, 0, 2],
      hourlyCounts: [...Array<number>(23).fill(0), 2],
      sourceCounts: [{ label: "one.example", count: 2 }],
      contentMix: [{ label: "article", count: 2 }],
    };
    const readLibrarySavedAnalytics = vi
      .fn<
        (
          request: LibrarySavedAnalyticsRequest,
        ) => Promise<LibrarySavedAnalytics>
      >()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const config = platformConfig({ readLibrarySavedAnalytics });
    let current: LibrarySavedAnalyticsState | null = null;
    const renderSaved = (sourceVersion: number) => (
      <PlatformProvider value={config}>
        <SavedAnalyticsHarness
          sourceVersion={sourceVersion}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderSaved(9));
    await flush();
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(1);

    act(() => root?.render(renderSaved(10)));
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledTimes(2);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(2);
  });

  it("fails closed when a Saved analytics query rejects", async () => {
    const readLibrarySavedAnalytics = vi.fn(async () => {
      throw new Error("stale source");
    });
    let current: LibrarySavedAnalyticsState | null = null;
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibrarySavedAnalytics })}>
        <SavedAnalyticsHarness
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(false);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    expect(readLibrarySavedAnalytics).toHaveBeenCalledOnce();
  });

  it("walks a native Friends timeline past the third page, replaces each row window, and returns to newest", async () => {
    const graph = friendsGraph(130);
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      item(`native-${index.toLocaleString()}`),
    );
    const secondPage = Array.from({ length: 50 }, (_, index) =>
      item(`native-${(index + 50).toLocaleString()}`),
    );
    const thirdPage = Array.from({ length: 30 }, (_, index) =>
      item(`native-${(index + 100).toLocaleString()}`),
    );
    const readLibraryFriendsGraph = vi.fn(async () => graph);
    const readLibraryPersonTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: secondPage,
        totalCount: 130,
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: thirdPage,
        totalCount: 130,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      });
    let current: LibraryFriendsRowsState | null = null;
    const config = platformConfig({
      readLibraryFriendsGraph,
      readLibraryPersonTimeline,
    });
    const renderFriends = (
      fallbackItems: readonly FeedItem[],
      timelineIdentity?: LibraryPersonTimelineRequest,
    ) => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={1}
          timelineIdentity={timelineIdentity}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends([]));

    await flush();
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineItems,
    ).toHaveLength(50);
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(false);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(1, {
      personId: "person-1",
      limit: 50,
      cursor: null,
    });

    act(() => root?.render(renderFriends([item("unrelated-fallback")])));
    await flush();
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(1);

    act(() => {
      current?.loadMoreTimeline();
      current?.loadMoreTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      secondPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      true,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(true);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(2, {
      personId: "person-1",
      limit: 50,
      cursor: "page-2",
    });
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(2);

    act(() => {
      current?.loadMoreTimeline();
      current?.loadMoreTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      thirdPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      false,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(true);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(3, {
      personId: "person-1",
      limit: 50,
      cursor: "page-3",
    });

    act(() => {
      current?.showNewestTimeline();
      current?.showNewestTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      firstPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      true,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(false);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(4, {
      personId: "person-1",
      limit: 50,
      cursor: null,
    });
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(4);

    act(() =>
      root?.render(renderFriends([], { accountId: "account-unlinked" })),
    );
    await flush();
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(5, {
      accountId: "account-unlinked",
      limit: 50,
      cursor: null,
    });
  });

  it("keeps an exact location older than the current 50-row timeline window", async () => {
    const olderLocation = locationItem("rss:older-location", 10);
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...item(`rss:newer-${index.toLocaleString()}`),
      publishedAt: 100 - index,
    }));
    const graph = friendsGraph(51, {
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: olderLocation.globalId,
          publishedAt: olderLocation.publishedAt,
          effectiveAt: olderLocation.publishedAt,
        },
      ],
    });
    const readLibraryFriendsLocationItem = vi.fn(async () => olderLocation);
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: firstPage,
            totalCount: 51,
            nextCursor: "older-page",
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect(
      (current as LibraryFriendsRowsState | null)?.timelineItems,
    ).not.toContainEqual(olderLocation);
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual([
      olderLocation,
    ]);
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledOnce();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledWith({
      globalId: olderLocation.globalId,
      publishedAt: olderLocation.publishedAt,
      effectiveAt: olderLocation.publishedAt,
      owner: { kind: "social", platform: "rss", authorId: "author" },
      referenceTimeMs: friendsGraphRequest.recentWindow.endMs,
      sourceToken: graph.sourceToken,
    });
  });

  it("ignores a stale location batch after the graph source changes", async () => {
    const firstLocation = locationItem("rss:location-a", 10);
    const secondLocation = locationItem("rss:location-b", 20);
    const firstGraph = friendsGraph(1, {
      sourceToken: "friends-source-a",
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: firstLocation.globalId,
          publishedAt: firstLocation.publishedAt,
          effectiveAt: firstLocation.publishedAt,
        },
      ],
    });
    const secondGraph = friendsGraph(1, {
      sourceToken: "friends-source-b",
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: secondLocation.globalId,
          publishedAt: secondLocation.publishedAt,
          effectiveAt: secondLocation.publishedAt,
        },
      ],
    });
    let resolveFirst: ((value: FeedItem | null) => void) | null = null;
    let resolveSecond: ((value: FeedItem | null) => void) | null = null;
    const readLibraryFriendsLocationItem = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FeedItem | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<FeedItem | null>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const readLibraryFriendsGraph = vi
      .fn()
      .mockResolvedValueOnce(firstGraph)
      .mockResolvedValueOnce(secondGraph);
    const config = platformConfig({
      readLibraryFriendsGraph,
      readLibraryFriendsLocationItem,
      readLibraryPersonTimeline: vi.fn(async () => ({
        items: [],
        totalCount: 0,
        nextCursor: null,
      })),
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = (sourceVersion: number) => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={sourceVersion}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends(1));
    await flush();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledTimes(1);

    act(() => root?.render(renderFriends(2)));
    await flush();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst?.(firstLocation);
      await Promise.resolve();
    });
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );

    await act(async () => {
      resolveSecond?.(secondLocation);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual([
      secondLocation,
    ]);
  });

  it("fails closed when selected sources exceed the bounded location candidates", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      globalId: `rss:location-${index.toLocaleString()}`,
      publishedAt: 100 - index,
      effectiveAt: 100 - index,
    }));
    const graph = friendsGraph(9, {
      locationCandidateCount: 9,
      locationCandidates: candidates,
    });
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 0,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("fails closed when equal-time location candidates are ambiguous", async () => {
    const firstLocation = coordinateLocationItem("rss:z-location", 50, 1, 2);
    const secondLocation = coordinateLocationItem("rss:a-location", 50, 3, 4);
    const graph = friendsGraph(2, {
      locationCandidateCount: 2,
      locationCandidates: [firstLocation, secondLocation].map((entry) => ({
        globalId: entry.globalId,
        publishedAt: entry.publishedAt,
        effectiveAt: entry.publishedAt,
      })),
    });
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 2,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("rejects an exact location whose effective timestamp differs from the graph", async () => {
    const fallbackLocation = coordinateLocationItem(
      "rss:effective-fallback",
      50,
      1,
      2,
    );
    const mismatchedLocation: FeedItem = {
      ...fallbackLocation,
      timeRange: {
        startsAt: 75,
        kind: "event",
      },
    };
    const graph = friendsGraph(1, {
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: mismatchedLocation.globalId,
          publishedAt: mismatchedLocation.publishedAt,
          effectiveAt: 50,
        },
      ],
    });
    const readLibraryFriendsLocationItem = vi.fn(
      async () => mismatchedLocation,
    );
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 1,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
  });

  it("accepts all-time location history with no current-visible candidates", async () => {
    const graph = friendsGraph(1, {
      hasLocation: true,
      locationCandidateCount: 0,
      locationCandidates: [],
    });
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 0,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("does not read location candidates for standalone account detail", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      globalId: `rss:account-location-${index.toLocaleString()}`,
      publishedAt: 100 - index,
      effectiveAt: 100 - index,
    }));
    const graph = friendsGraph(9, {
      locationCandidateCount: 9,
      locationCandidates: candidates,
    });
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 9,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          locationSources={[]}
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("does not read a timeline or lease the corpus on the overview", async () => {
    const graph = friendsGraph(0);
    const readLibraryFriendsGraph = vi.fn(async () => graph);
    const readLibraryPersonTimeline = vi.fn(async () => ({
      items: [],
      totalCount: 0,
      nextCursor: null,
    }));
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph,
          readLibraryPersonTimeline,
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          timelineSources={[]}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    expect((current as LibraryFriendsRowsState | null)?.graph).toEqual(graph);
    expect((current as LibraryFriendsRowsState | null)?.timelineLoading).toBe(
      false,
    );
    expect(readLibraryPersonTimeline).not.toHaveBeenCalled();
  });

  it("fails closed when Friends SQLite reads reject", async () => {
    const readLibraryFriendsGraph = vi.fn(async () => {
      throw new Error("graph read failed");
    });
    const readLibraryPersonTimeline = vi.fn(async () => {
      throw new Error("timeline read failed");
    });
    const config = platformConfig({
      readLibraryFriendsGraph,
      readLibraryPersonTimeline,
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = () => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends());
    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.graph).toBeNull();
    expect((current as LibraryFriendsRowsState | null)?.graphLoading).toBe(
      false,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      [],
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineLoading).toBe(
      false,
    );
    expect(readLibraryFriendsGraph).toHaveBeenCalledOnce();
    expect(readLibraryPersonTimeline).toHaveBeenCalledOnce();
  });

  it("retries failed Friends reads when the native reader changes", async () => {
    const firstGraphReader = vi.fn(async () => {
      throw new Error("first graph failure");
    });
    const firstTimelineReader = vi.fn(async () => {
      throw new Error("first timeline failure");
    });
    const secondGraphReader = vi.fn(async () => {
      throw new Error("second graph failure");
    });
    const secondTimelineReader = vi.fn(async () => {
      throw new Error("second timeline failure");
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = (
      readLibraryFriendsGraph: typeof firstGraphReader,
      readLibraryPersonTimeline: typeof firstTimelineReader,
    ) => (
      <PlatformProvider
        value={platformConfig({
          readLibraryFriendsGraph,
          readLibraryPersonTimeline,
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderFriends(firstGraphReader, firstTimelineReader));
    await flush();
    await flush();
    await flush();

    expect(firstGraphReader).toHaveBeenCalledOnce();
    expect(firstTimelineReader).toHaveBeenCalledOnce();

    act(() => {
      root?.render(renderFriends(secondGraphReader, secondTimelineReader));
    });
    await flush();
    await flush();
    await flush();

    expect(secondGraphReader).toHaveBeenCalledOnce();
    expect(secondTimelineReader).toHaveBeenCalledOnce();
    expect((current as LibraryFriendsRowsState | null)?.graph).toBeNull();
    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      [],
    );
  });

  it("retains only the visible SQLite page for the Friends directory", async () => {
    vi.useFakeTimers();
    const firstRows = Array.from({ length: 64 }, (_, index) =>
      friendsDirectoryRow(
        `friend-a-${index.toLocaleString("en-US", { useGrouping: false })}`,
      ),
    );
    const secondRows = Array.from({ length: 64 }, (_, index) =>
      friendsDirectoryRow(
        `friend-b-${index.toLocaleString("en-US", { useGrouping: false })}`,
      ),
    );
    const queryLibraryCoreMock = vi.fn(
      async (request: LibraryCoreFriendsDirectoryPageRequestV1) => {
        const source = {
          generationId: "a".repeat(64) as never,
          projectionRevision: 1,
          transitionSequence: 1,
        };
        const cursor = request.cursor
          ? decodeLibraryCoreFriendsDirectoryCursorV1(request.cursor)
          : null;
        const offset = cursor?.ok ? cursor.value.offset : 0;
        return friendsDirectoryResponse(
          offset === 0 ? firstRows : secondRows,
          offset === 0
            ? encodeLibraryCoreFriendsDirectoryCursorV1({
                bindingDigest:
                  libraryCoreFriendsDirectoryBindingDigestV1(request),
                generationId: source.generationId,
                offset: 64,
                projectionRevision: 1,
                transitionSequence: 1,
              })
            : null,
        );
      },
    );
    const queryLibraryCore =
      queryLibraryCoreMock as unknown as LibraryCoreNormalizedQueryExecutor;
    let current: LibraryFriendsDirectoryState | null = null;

    renderHarness(
      <PlatformProvider value={platformConfig({ queryLibraryCore })}>
        <FriendsDirectoryHarness
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    await flush();

    expect(queryLibraryCore).toHaveBeenCalledOnce();
    await expect(
      queryLibraryCoreMock.mock.results[0]?.value,
    ).resolves.toMatchObject({
      rows: firstRows,
    });
    expect((current as LibraryFriendsDirectoryState | null)?.rows).toHaveLength(
      64,
    );
    expect((current as LibraryFriendsDirectoryState | null)?.totalCount).toBe(
      130,
    );

    act(() => (current as LibraryFriendsDirectoryState | null)?.nextPage());
    await flush();
    expect(queryLibraryCore).toHaveBeenCalledTimes(2);
    expect(queryLibraryCore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: expect.any(String),
        limit: 64,
        queryId: "friends_directory_page_v1",
      }),
    );
    expect((current as LibraryFriendsDirectoryState | null)?.rows).toHaveLength(
      64,
    );
    expect((current as LibraryFriendsDirectoryState | null)?.rows[0]?.id).toBe(
      "friend-b-0",
    );
    expect((current as LibraryFriendsDirectoryState | null)?.pageNumber).toBe(
      2,
    );

    act(() => (current as LibraryFriendsDirectoryState | null)?.previousPage());
    await flush();
    expect(queryLibraryCore).toHaveBeenCalledTimes(3);
    expect(queryLibraryCore).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null }),
    );
    expect((current as LibraryFriendsDirectoryState | null)?.rows[0]?.id).toBe(
      "friend-a-0",
    );
  });

  it("keeps RSS catalog search bounded to visible rows and opaque cursors", async () => {
    const firstRawPage = Array.from({ length: 128 }, (_, index) =>
      rssFeedRow(
        `https://feed-${index.toLocaleString("en-US", { useGrouping: false })}.example/rss`,
        `Unrelated ${index.toLocaleString("en-US", { useGrouping: false })}`,
      ),
    );
    const matchingRows = [
      rssFeedRow("https://alpha.example/rss", "Target Alpha"),
      rssFeedRow("https://beta.example/rss", "Target Beta"),
      rssFeedRow("https://gamma.example/rss", "Target Gamma"),
    ];
    const queryLibraryCore = vi.fn(
      async (request: { cursor: string | null }) => {
      if (request.cursor === null) {
        return rssFeedResponse(firstRawPage, "second-raw-page");
      }
      return rssFeedResponse(matchingRows, null);
      },
    ) as unknown as LibraryCoreNormalizedQueryExecutor;
    let current: LibraryRssFeedPageState | null = null;

    renderHarness(
      <PlatformProvider value={platformConfig({ queryLibraryCore })}>
        <RssFeedPageHarness
          search="target"
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );
    await flush();
    await flush();

    expect(queryLibraryCore).toHaveBeenCalledTimes(2);
    expect(
      (current as LibraryRssFeedPageState | null)?.rows.map((row) => row.title),
    ).toEqual(["Target Alpha", "Target Beta"]);
    expect((current as LibraryRssFeedPageState | null)?.hasNext).toBe(true);
    expect((current as LibraryRssFeedPageState | null)?.pageNumber).toBe(1);
    expect((current as LibraryRssFeedPageState | null)?.rows).toHaveLength(2);

    act(() => {
      (current as LibraryRssFeedPageState | null)?.nextPage();
    });
    await flush();

    expect(queryLibraryCore).toHaveBeenCalledTimes(3);
    expect(queryLibraryCore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: expect.any(String),
        limit: 128,
        queryId: "rss_feed_page_v1",
      }),
    );
    expect((current as LibraryRssFeedPageState | null)?.pageNumber).toBe(2);
  });

  it("queries social channels only while the palette is open and matches linked Person names", async () => {
    const queryLibraryCore = vi.fn(async () =>
      accountGraphResponse(
        [
      accountGraphRow("unrelated", null),
      accountGraphRow("target-account", "Ada Lovelace"),
        ],
        null,
      ),
    ) as unknown as LibraryCoreNormalizedQueryExecutor;
    const config = platformConfig({ queryLibraryCore });
    let current: LibrarySocialChannelPageState | null = null;
    const renderChannels = (enabled: boolean) => (
      <PlatformProvider value={config}>
        <SocialChannelPageHarness
          enabled={enabled}
          query="lovelace"
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderChannels(false));
    await flush();
    expect(queryLibraryCore).not.toHaveBeenCalled();

    act(() => root?.render(renderChannels(true)));
    await flush();
    await flush();

    expect(queryLibraryCore).toHaveBeenCalledOnce();
    expect(queryLibraryCore).toHaveBeenCalledWith(
      expect.objectContaining({
      cursor: null,
      limit: 128,
      queryId: "account_graph_page_v1",
      }),
    );
    expect((current as LibrarySocialChannelPageState | null)?.channels).toEqual(
      [
      expect.objectContaining({
        account: expect.objectContaining({ id: "target-account" }),
        personName: "Ada Lovelace",
      }),
      ],
    );
  });

  it("queries only exact Feed and provider-author filter identities", async () => {
    const queryLibraryCore = vi.fn(
      async (request: { feedUrl: string | null }) => ({
      accountId: request.feedUrl ? null : "account-ada",
      itemCount: request.feedUrl ? 4 : 7,
      label: request.feedUrl ? "Example Feed" : "Ada",
      queryId: "filter_scope_summary_v1",
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 8,
        transitionSequence: 0,
      },
      }),
    ) as unknown as LibraryCoreNormalizedQueryExecutor;
    const config = platformConfig({ queryLibraryCore });
    let current: LibraryFilterScopeSummaryState | null = null;
    const renderScope = (filter: FilterOptions) => (
      <PlatformProvider value={config}>
        <FilterScopeHarness
          filter={filter}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderScope({ savedOnly: true }));
    await flush();
    expect(queryLibraryCore).not.toHaveBeenCalled();

    act(() =>
      root?.render(renderScope({ feedUrl: "https://example.com/feed" })),
    );
    await flush();
    await flush();
    expect(queryLibraryCore).toHaveBeenCalledWith({
      authorId: null,
      feedUrl: "https://example.com/feed",
      platform: null,
      queryId: "filter_scope_summary_v1",
      schemaVersion: 1,
    });
    expect(
      (current as LibraryFilterScopeSummaryState | null)?.summary,
    ).toMatchObject({
      itemCount: 4,
      label: "Example Feed",
    });

    act(() => root?.render(renderScope({ authorId: "ada", platform: "x" })));
    await flush();
    await flush();
    expect(queryLibraryCore).toHaveBeenLastCalledWith({
      authorId: "ada",
      feedUrl: null,
      platform: "x",
      queryId: "filter_scope_summary_v1",
      schemaVersion: 1,
    });
    expect(
      (current as LibraryFilterScopeSummaryState | null)?.summary,
    ).toMatchObject({
      itemCount: 7,
      label: "Ada",
    });
  });
});
