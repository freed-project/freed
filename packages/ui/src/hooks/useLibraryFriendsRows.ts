import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compareUtf8Binary,
  extractLocationFromItem,
  isLocationItemVisibleInTimeMode,
  type FeedItem,
} from "@freed/shared";
import {
  usePlatform,
  type LibraryFriendsGraph,
  type LibraryFriendsLocationItemRequest,
  type LibraryFriendsGraphRequest,
  type LibraryFriendsSource,
  type LibraryPersonTimelinePage,
} from "../context/PlatformContext.js";
import { friendActivitySourceKey } from "../lib/friends-workspace.js";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems.js";

const TIMELINE_PAGE_SIZE = 50;
const MAX_LOCATION_ITEMS = 8;

interface VersionedFriendsGraph {
  request: LibraryFriendsGraphRequest;
  sourceVersion: number;
  graph: LibraryFriendsGraph;
}

interface VersionedTimeline {
  sources: readonly LibraryFriendsSource[];
  sourceVersion: number;
  items: readonly FeedItem[];
  totalCount: number;
  pageCursor: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
}

interface VersionedLocationItems {
  readonly attemptKey: string;
  readonly sourceVersion: number;
  readonly sources: readonly LibraryFriendsSource[];
  readonly items: readonly FeedItem[];
}

interface GraphAttempt {
  readonly sourceVersion: number;
  readonly request: LibraryFriendsGraphRequest;
}

interface TimelineAttempt {
  readonly sourceVersion: number;
  readonly sources: readonly LibraryFriendsSource[];
}

interface TimelineCursorAttempt extends TimelineAttempt {
  readonly cursor: string | null;
}

interface LocationAttempt extends TimelineAttempt {
  readonly attemptKey: string;
}

interface LocationReadPlan {
  readonly attemptKey: string;
  readonly complete: boolean;
  readonly requests: readonly LibraryFriendsLocationItemRequest[];
}

export interface LibraryFriendsRowsState {
  readonly graph: LibraryFriendsGraph | null;
  readonly graphLoading: boolean;
  readonly graphUsingFallback: boolean;
  readonly legacyItemsReady: boolean;
  readonly locationItems: readonly FeedItem[];
  readonly locationUsingFallback: boolean;
  readonly timelineItems: readonly FeedItem[];
  readonly timelineTotalCount: number;
  readonly timelineLoading: boolean;
  readonly timelineLoadingMore: boolean;
  readonly timelineHasMore: boolean;
  readonly timelineAwayFromNewest: boolean;
  readonly timelineUsingFallback: boolean;
  loadMoreTimeline(): void;
  showNewestTimeline(): void;
}

function locationAttemptMatches(
  attempt: LocationAttempt | null,
  sourceVersion: number,
  sources: readonly LibraryFriendsSource[],
  attemptKey: string,
): boolean {
  return (
    timelineAttemptMatches(attempt, sourceVersion, sources) &&
    attempt?.attemptKey === attemptKey
  );
}

function graphAttemptMatches(
  attempt: GraphAttempt | null,
  sourceVersion: number,
  request: LibraryFriendsGraphRequest,
): boolean {
  return (
    attempt?.sourceVersion === sourceVersion && attempt.request === request
  );
}

function timelineAttemptMatches(
  attempt: TimelineAttempt | null,
  sourceVersion: number,
  sources: readonly LibraryFriendsSource[],
): boolean {
  return (
    attempt?.sourceVersion === sourceVersion && attempt.sources === sources
  );
}

function timelineCursorAttemptMatches(
  attempt: TimelineCursorAttempt | null,
  sourceVersion: number,
  sources: readonly LibraryFriendsSource[],
  cursor: string | null,
): boolean {
  return (
    timelineAttemptMatches(attempt, sourceVersion, sources) &&
    attempt?.cursor === cursor
  );
}

function visibleTimelineItems(
  items: readonly FeedItem[],
  sources: readonly LibraryFriendsSource[],
): FeedItem[] {
  const sourceKeys = new Set(
    sources.map((source) =>
      friendActivitySourceKey(source.platform, source.authorId),
    ),
  );
  return items
    .filter(
      (item) =>
        !item.userState.hidden &&
        sourceKeys.has(friendActivitySourceKey(item.platform, item.author.id)),
    )
    .sort(
      (left, right) =>
        right.publishedAt - left.publishedAt ||
        compareUtf8Binary(left.globalId, right.globalId),
    );
}

function visibleLocationSourceItems(
  items: readonly FeedItem[],
  sources: readonly LibraryFriendsSource[],
): FeedItem[] {
  const sourceKeys = new Set(
    sources.map((source) =>
      friendActivitySourceKey(source.platform, source.authorId),
    ),
  );
  return items.filter(
    (item) =>
      !item.userState.hidden &&
      sourceKeys.has(friendActivitySourceKey(item.platform, item.author.id)),
  );
}

function buildLocationReadPlan(
  graph: LibraryFriendsGraph,
  graphRequest: LibraryFriendsGraphRequest,
  sources: readonly LibraryFriendsSource[],
): LocationReadPlan {
  const summaries = new Map<string, (typeof graph.social)[number]>();
  let complete = true;
  for (const activity of graph.social) {
    const key = friendActivitySourceKey(activity.platform, activity.authorId);
    if (summaries.has(key)) complete = false;
    else summaries.set(key, activity);
  }

  const requests: LibraryFriendsLocationItemRequest[] = [];
  let advertisedCount = 0;
  const seenIds = new Set<string>();
  for (const source of sources) {
    const activity = summaries.get(
      friendActivitySourceKey(source.platform, source.authorId),
    );
    if (!activity) {
      complete = false;
      continue;
    }
    if (
      !Number.isSafeInteger(activity.locationCandidateCount) ||
      activity.locationCandidateCount < 0 ||
      activity.locationCandidateCount !== activity.locationCandidates.length ||
      (activity.locationCandidateCount > 0 && !activity.hasLocation)
    ) {
      complete = false;
    }
    advertisedCount += activity.locationCandidateCount;
    for (const candidate of activity.locationCandidates) {
      if (
        !candidate.globalId ||
        !Number.isSafeInteger(candidate.publishedAt) ||
        !Number.isSafeInteger(candidate.effectiveAt) ||
        seenIds.has(candidate.globalId)
      ) {
        complete = false;
        continue;
      }
      seenIds.add(candidate.globalId);
      requests.push({
        ...candidate,
        owner: {
          kind: "social",
          platform: source.platform,
          authorId: source.authorId,
        },
        referenceTimeMs: graphRequest.recentWindow.endMs,
        sourceToken: graph.sourceToken,
      });
    }
  }
  if (
    advertisedCount > MAX_LOCATION_ITEMS ||
    requests.length > MAX_LOCATION_ITEMS
  ) {
    complete = false;
  }
  const candidateTimes = new Set<string>();
  for (const request of requests) {
    const candidateTime = `${request.effectiveAt}:${request.publishedAt}`;
    if (candidateTimes.has(candidateTime)) {
      // The legacy map resolves equal effective timestamps by stable source
      // order. Binary ID ordering would silently choose a different place.
      complete = false;
    }
    candidateTimes.add(candidateTime);
  }
  requests.sort(
    (left, right) =>
      right.publishedAt - left.publishedAt ||
      compareUtf8Binary(left.globalId, right.globalId),
  );
  return {
    attemptKey: JSON.stringify({
      sourceToken: graph.sourceToken,
      referenceTimeMs: graphRequest.recentWindow.endMs,
      complete,
      requests,
    }),
    complete,
    requests,
  };
}

function isValidLocationItem(
  item: FeedItem | null,
  request: LibraryFriendsLocationItemRequest,
): item is FeedItem {
  return Boolean(
    item &&
    request.owner.kind === "social" &&
    item.globalId === request.globalId &&
    item.publishedAt === request.publishedAt &&
    (item.timeRange?.startsAt ?? item.publishedAt) === request.effectiveAt &&
    item.platform === request.owner.platform &&
    item.author.id === request.owner.authorId &&
    !item.userState.hidden &&
    extractLocationFromItem(item) &&
    isLocationItemVisibleInTimeMode(item, "current", request.referenceTimeMs),
  );
}

function assertTimelinePage(page: LibraryPersonTimelinePage): void {
  if (page.items.length > TIMELINE_PAGE_SIZE) {
    throw new Error("Library Friends timeline exceeded its row bound");
  }
  const pageIds = new Set<string>();
  for (const item of page.items) {
    if (pageIds.has(item.globalId)) {
      throw new Error("Library Friends timeline repeated an item");
    }
    pageIds.add(item.globalId);
  }
}

function replaceTimelinePage(
  current: VersionedTimeline,
  page: LibraryPersonTimelinePage,
  pageCursor: string | null,
): VersionedTimeline {
  assertTimelinePage(page);
  if (page.totalCount !== current.totalCount) {
    throw new Error("Library Friends timeline total changed during paging");
  }
  if (
    current.pageCursor !== pageCursor &&
    page.items.some((item) =>
      current.items.some(
        (currentItem) => currentItem.globalId === item.globalId,
      ),
    )
  ) {
    throw new Error("Library Friends timeline repeated an item across pages");
  }
  return {
    ...current,
    items: page.items,
    pageCursor,
    nextCursor: page.nextCursor,
    loadingMore: false,
  };
}

/**
 * Read compact Friends activity and one selected bounded timeline. The single
 * compatibility lease is acquired only when the applicable native read is
 * absent or fails, then released after a later successful retry.
 */
export function useLibraryFriendsRows({
  graphRequest,
  locationSources,
  timelineSources,
  fallbackItems,
  sourceVersion,
}: {
  graphRequest: LibraryFriendsGraphRequest;
  locationSources: readonly LibraryFriendsSource[];
  timelineSources: readonly LibraryFriendsSource[];
  fallbackItems: readonly FeedItem[];
  sourceVersion: number;
}): LibraryFriendsRowsState {
  const {
    readLibraryFriendsGraph,
    readLibraryFriendsLocationItem,
    readLibraryPersonTimeline,
  } = usePlatform();
  const timelineActive = timelineSources.length > 0;
  const locationActive = locationSources.length > 0;
  const [versionedGraph, setVersionedGraph] =
    useState<VersionedFriendsGraph | null>(null);
  const [failedGraphAttempt, setFailedGraphAttempt] =
    useState<GraphAttempt | null>(null);
  const graphRetriedAttemptRef = useRef<GraphAttempt | null>(null);
  const [graphRetrySequence, setGraphRetrySequence] = useState(0);
  const [versionedTimeline, setVersionedTimeline] =
    useState<VersionedTimeline | null>(null);
  const [failedTimelineAttempt, setFailedTimelineAttempt] =
    useState<TimelineAttempt | null>(null);
  const timelineRetriedAttemptRef = useRef<TimelineAttempt | null>(null);
  const [timelineRetrySequence, setTimelineRetrySequence] = useState(0);
  const [fallbackTimelineOffset, setFallbackTimelineOffset] = useState(0);
  const inFlightTimelineCursorRef = useRef<TimelineCursorAttempt | null>(null);
  const [versionedLocationItems, setVersionedLocationItems] =
    useState<VersionedLocationItems | null>(null);
  const [failedLocationAttempt, setFailedLocationAttempt] =
    useState<LocationAttempt | null>(null);
  const locationRetriedAttemptRef = useRef<LocationAttempt | null>(null);
  const [locationRetrySequence, setLocationRetrySequence] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (
      !graphAttemptMatches(
        graphRetriedAttemptRef.current,
        sourceVersion,
        graphRequest,
      )
    ) {
      graphRetriedAttemptRef.current = null;
    }
    setFailedGraphAttempt((failedAttempt) =>
      graphAttemptMatches(failedAttempt, sourceVersion, graphRequest)
        ? failedAttempt
        : null,
    );
    if (!readLibraryFriendsGraph) {
      setVersionedGraph(null);
      return () => {
        cancelled = true;
      };
    }
    void readLibraryFriendsGraph(graphRequest)
      .then((graph) => {
        if (cancelled) return;
        setVersionedGraph({ request: graphRequest, sourceVersion, graph });
        setFailedGraphAttempt((failedAttempt) =>
          graphAttemptMatches(failedAttempt, sourceVersion, graphRequest)
            ? null
            : failedAttempt,
        );
        if (
          graphAttemptMatches(
            graphRetriedAttemptRef.current,
            sourceVersion,
            graphRequest,
          )
        ) {
          graphRetriedAttemptRef.current = null;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailedGraphAttempt({ sourceVersion, request: graphRequest });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    graphRequest,
    graphRetrySequence,
    readLibraryFriendsGraph,
    sourceVersion,
  ]);

  useEffect(() => {
    setFallbackTimelineOffset(0);
    inFlightTimelineCursorRef.current = null;
    if (!timelineActive) {
      setVersionedTimeline(null);
      setFailedTimelineAttempt(null);
      timelineRetriedAttemptRef.current = null;
      return;
    }
    if (
      !timelineAttemptMatches(
        timelineRetriedAttemptRef.current,
        sourceVersion,
        timelineSources,
      )
    ) {
      timelineRetriedAttemptRef.current = null;
    }
    setFailedTimelineAttempt((failedAttempt) =>
      timelineAttemptMatches(failedAttempt, sourceVersion, timelineSources)
        ? failedAttempt
        : null,
    );
    let cancelled = false;
    if (!readLibraryPersonTimeline) {
      setVersionedTimeline(null);
      return () => {
        cancelled = true;
      };
    }
    void readLibraryPersonTimeline({
      sources: timelineSources,
      limit: TIMELINE_PAGE_SIZE,
      cursor: null,
    })
      .then((page) => {
        if (cancelled) return;
        assertTimelinePage(page);
        setVersionedTimeline({
          sources: timelineSources,
          sourceVersion,
          items: page.items,
          totalCount: page.totalCount,
          pageCursor: null,
          nextCursor: page.nextCursor,
          loadingMore: false,
        });
        setFailedTimelineAttempt((failedAttempt) =>
          timelineAttemptMatches(failedAttempt, sourceVersion, timelineSources)
            ? null
            : failedAttempt,
        );
        if (
          timelineAttemptMatches(
            timelineRetriedAttemptRef.current,
            sourceVersion,
            timelineSources,
          )
        ) {
          timelineRetriedAttemptRef.current = null;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailedTimelineAttempt({ sourceVersion, sources: timelineSources });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    readLibraryPersonTimeline,
    sourceVersion,
    timelineActive,
    timelineRetrySequence,
    timelineSources,
  ]);

  const currentGraph =
    versionedGraph?.request === graphRequest &&
    versionedGraph.sourceVersion === sourceVersion
      ? versionedGraph.graph
      : null;
  const currentTimeline =
    versionedTimeline?.sources === timelineSources &&
    versionedTimeline.sourceVersion === sourceVersion
      ? versionedTimeline
      : null;
  const locationReadPlan = useMemo(
    () =>
      currentGraph && locationActive
        ? buildLocationReadPlan(currentGraph, graphRequest, locationSources)
        : null,
    [currentGraph, graphRequest, locationActive, locationSources],
  );

  useEffect(() => {
    let cancelled = false;
    const attemptKey = locationReadPlan?.attemptKey ?? "";
    if (
      !locationAttemptMatches(
        locationRetriedAttemptRef.current,
        sourceVersion,
        locationSources,
        attemptKey,
      )
    ) {
      locationRetriedAttemptRef.current = null;
    }
    setFailedLocationAttempt((failedAttempt) =>
      locationAttemptMatches(
        failedAttempt,
        sourceVersion,
        locationSources,
        attemptKey,
      )
        ? failedAttempt
        : null,
    );
    if (
      !locationActive ||
      !locationReadPlan?.complete ||
      locationReadPlan.requests.length === 0 ||
      !readLibraryFriendsLocationItem
    ) {
      setVersionedLocationItems(null);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all(
      locationReadPlan.requests.map(async (request) => {
        const item = await readLibraryFriendsLocationItem(request);
        if (!isValidLocationItem(item, request)) {
          throw new Error(
            "Library Friends location item did not match its graph candidate",
          );
        }
        return item;
      }),
    )
      .then((resolvedItems) => {
        if (cancelled) return;
        setVersionedLocationItems({
          attemptKey,
          sourceVersion,
          sources: locationSources,
          items: resolvedItems,
        });
        setFailedLocationAttempt((failedAttempt) =>
          locationAttemptMatches(
            failedAttempt,
            sourceVersion,
            locationSources,
            attemptKey,
          )
            ? null
            : failedAttempt,
        );
        if (
          locationAttemptMatches(
            locationRetriedAttemptRef.current,
            sourceVersion,
            locationSources,
            attemptKey,
          )
        ) {
          locationRetriedAttemptRef.current = null;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailedLocationAttempt({
            attemptKey,
            sourceVersion,
            sources: locationSources,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    locationReadPlan,
    locationRetrySequence,
    locationActive,
    locationSources,
    readLibraryFriendsLocationItem,
    sourceVersion,
  ]);

  const graphUsingFallback =
    !readLibraryFriendsGraph ||
    graphAttemptMatches(failedGraphAttempt, sourceVersion, graphRequest);
  const timelineUsingFallback =
    timelineActive &&
    (!readLibraryPersonTimeline ||
      timelineAttemptMatches(
        failedTimelineAttempt,
        sourceVersion,
        timelineSources,
      ));
  const locationAttemptKey = locationReadPlan?.attemptKey ?? "";
  const locationUsingFallback =
    locationActive &&
    (graphUsingFallback ||
      (currentGraph !== null &&
        (!locationReadPlan?.complete ||
          (locationReadPlan.requests.length > 0 &&
            (!readLibraryFriendsLocationItem ||
              locationAttemptMatches(
                failedLocationAttempt,
                sourceVersion,
                locationSources,
                locationAttemptKey,
              ))))));
  const legacyItemsReady = useLegacyLibraryItems(
    graphUsingFallback || timelineUsingFallback || locationUsingFallback,
  );

  useEffect(() => {
    if (
      graphAttemptMatches(failedGraphAttempt, sourceVersion, graphRequest) &&
      legacyItemsReady &&
      readLibraryFriendsGraph &&
      !graphAttemptMatches(
        graphRetriedAttemptRef.current,
        sourceVersion,
        graphRequest,
      )
    ) {
      graphRetriedAttemptRef.current = { sourceVersion, request: graphRequest };
      setGraphRetrySequence((sequence) => sequence + 1);
    }
    if (
      timelineAttemptMatches(
        failedTimelineAttempt,
        sourceVersion,
        timelineSources,
      ) &&
      timelineActive &&
      legacyItemsReady &&
      readLibraryPersonTimeline &&
      !timelineAttemptMatches(
        timelineRetriedAttemptRef.current,
        sourceVersion,
        timelineSources,
      )
    ) {
      timelineRetriedAttemptRef.current = {
        sourceVersion,
        sources: timelineSources,
      };
      setTimelineRetrySequence((sequence) => sequence + 1);
    }
    if (
      locationReadPlan?.complete &&
      locationReadPlan.requests.length > 0 &&
      locationAttemptMatches(
        failedLocationAttempt,
        sourceVersion,
        locationSources,
        locationAttemptKey,
      ) &&
      legacyItemsReady &&
      readLibraryFriendsLocationItem &&
      !locationAttemptMatches(
        locationRetriedAttemptRef.current,
        sourceVersion,
        locationSources,
        locationAttemptKey,
      )
    ) {
      locationRetriedAttemptRef.current = {
        attemptKey: locationAttemptKey,
        sourceVersion,
        sources: locationSources,
      };
      setLocationRetrySequence((sequence) => sequence + 1);
    }
  }, [
    failedLocationAttempt,
    failedGraphAttempt,
    failedTimelineAttempt,
    graphRequest,
    legacyItemsReady,
    locationActive,
    locationAttemptKey,
    locationReadPlan,
    locationSources,
    readLibraryFriendsGraph,
    readLibraryFriendsLocationItem,
    readLibraryPersonTimeline,
    timelineActive,
    timelineSources,
    sourceVersion,
  ]);
  const fallbackVisibleItems = useMemo(
    () =>
      timelineUsingFallback && legacyItemsReady
        ? visibleTimelineItems(fallbackItems, timelineSources)
        : null,
    [fallbackItems, legacyItemsReady, timelineSources, timelineUsingFallback],
  );
  const fallbackLocationSourceItems = useMemo(
    () =>
      locationUsingFallback && legacyItemsReady
        ? visibleLocationSourceItems(fallbackItems, locationSources)
        : null,
    [fallbackItems, legacyItemsReady, locationSources, locationUsingFallback],
  );
  const fallbackLocationItems = useMemo(
    () =>
      fallbackLocationSourceItems?.filter(
        (item) =>
          Boolean(extractLocationFromItem(item)) &&
          isLocationItemVisibleInTimeMode(
            item,
            "current",
            graphRequest.recentWindow.endMs,
          ),
      ) ?? [],
    [fallbackLocationSourceItems, graphRequest.recentWindow.endMs],
  );
  const currentLocationItems =
    versionedLocationItems?.sourceVersion === sourceVersion &&
    versionedLocationItems.sources === locationSources &&
    versionedLocationItems.attemptKey === locationAttemptKey
      ? versionedLocationItems.items
      : [];
  const locationItems = locationUsingFallback
    ? fallbackLocationItems
    : currentLocationItems;

  const requestNativeTimelinePage = useCallback(
    (cursor: string | null) => {
      if (
        !readLibraryPersonTimeline ||
        !currentTimeline ||
        currentTimeline.loadingMore ||
        timelineAttemptMatches(
          inFlightTimelineCursorRef.current,
          sourceVersion,
          timelineSources,
        )
      ) {
        return;
      }
      inFlightTimelineCursorRef.current = {
        sourceVersion,
        sources: timelineSources,
        cursor,
      };
      setVersionedTimeline({ ...currentTimeline, loadingMore: true });
      void readLibraryPersonTimeline({
        sources: timelineSources,
        limit: TIMELINE_PAGE_SIZE,
        cursor,
      })
        .then((page) => {
          const next = replaceTimelinePage(currentTimeline, page, cursor);
          setVersionedTimeline((latest) => {
            if (
              !latest ||
              latest.sources !== timelineSources ||
              latest.sourceVersion !== sourceVersion ||
              latest.pageCursor !== currentTimeline.pageCursor
            ) {
              return latest;
            }
            return next;
          });
          setFailedTimelineAttempt((failedAttempt) =>
            timelineAttemptMatches(
              failedAttempt,
              sourceVersion,
              timelineSources,
            )
              ? null
              : failedAttempt,
          );
        })
        .catch(() => {
          setVersionedTimeline((latest) =>
            latest?.sources === timelineSources &&
            latest.sourceVersion === sourceVersion
              ? { ...latest, loadingMore: false }
              : latest,
          );
          setFailedTimelineAttempt({ sourceVersion, sources: timelineSources });
        })
        .finally(() => {
          if (
            timelineCursorAttemptMatches(
              inFlightTimelineCursorRef.current,
              sourceVersion,
              timelineSources,
              cursor,
            )
          ) {
            inFlightTimelineCursorRef.current = null;
          }
        });
    },
    [
      currentTimeline,
      readLibraryPersonTimeline,
      sourceVersion,
      timelineSources,
    ],
  );

  const loadMoreTimeline = useCallback(() => {
    if (timelineUsingFallback) {
      setFallbackTimelineOffset((offset) => {
        const nextOffset = offset + TIMELINE_PAGE_SIZE;
        return nextOffset < (fallbackVisibleItems?.length ?? 0)
          ? nextOffset
          : offset;
      });
      return;
    }
    if (currentTimeline?.nextCursor) {
      requestNativeTimelinePage(currentTimeline.nextCursor);
    }
  }, [
    currentTimeline?.nextCursor,
    fallbackVisibleItems?.length,
    requestNativeTimelinePage,
    timelineUsingFallback,
  ]);

  const showNewestTimeline = useCallback(() => {
    if (timelineUsingFallback) {
      setFallbackTimelineOffset(0);
      return;
    }
    if (currentTimeline && currentTimeline.pageCursor !== null) {
      requestNativeTimelinePage(null);
    }
  }, [currentTimeline, requestNativeTimelinePage, timelineUsingFallback]);

  if (timelineUsingFallback) {
    const items =
      fallbackVisibleItems?.slice(
        fallbackTimelineOffset,
        fallbackTimelineOffset + TIMELINE_PAGE_SIZE,
      ) ?? [];
    const totalCount = fallbackVisibleItems?.length ?? 0;
    return {
      graph: currentGraph,
      graphLoading: graphUsingFallback
        ? !legacyItemsReady
        : currentGraph === null,
      graphUsingFallback,
      legacyItemsReady,
      locationItems,
      locationUsingFallback,
      timelineItems: items,
      timelineTotalCount: totalCount,
      timelineLoading: !legacyItemsReady,
      timelineLoadingMore: false,
      timelineHasMore: fallbackTimelineOffset + items.length < totalCount,
      timelineAwayFromNewest: fallbackTimelineOffset > 0,
      timelineUsingFallback,
      loadMoreTimeline,
      showNewestTimeline,
    };
  }

  return {
    graph: currentGraph,
    graphLoading: graphUsingFallback
      ? !legacyItemsReady
      : currentGraph === null,
    graphUsingFallback,
    legacyItemsReady,
    locationItems,
    locationUsingFallback,
    timelineItems: currentTimeline?.items ?? [],
    timelineTotalCount: currentTimeline?.totalCount ?? 0,
    timelineLoading: timelineActive && currentTimeline === null,
    timelineLoadingMore: currentTimeline?.loadingMore ?? false,
    timelineHasMore: Boolean(currentTimeline?.nextCursor),
    timelineAwayFromNewest: Boolean(
      currentTimeline && currentTimeline.pageCursor !== null,
    ),
    timelineUsingFallback,
    loadMoreTimeline,
    showNewestTimeline,
  };
}
