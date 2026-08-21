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
  type LibraryPersonTimelineRequest,
  type LibraryPersonTimelinePage,
} from "../context/PlatformContext.js";
import { friendActivitySourceKey } from "../lib/friends-workspace.js";

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

interface LocationReadPlan {
  readonly attemptKey: string;
  readonly complete: boolean;
  readonly requests: readonly LibraryFriendsLocationItemRequest[];
}

export interface LibraryFriendsRowsState {
  readonly graph: LibraryFriendsGraph | null;
  readonly graphLoading: boolean;
  readonly locationItems: readonly FeedItem[];
  readonly timelineItems: readonly FeedItem[];
  readonly timelineTotalCount: number;
  readonly timelineLoading: boolean;
  readonly timelineLoadingMore: boolean;
  readonly timelineHasMore: boolean;
  readonly timelineAwayFromNewest: boolean;
  loadMoreTimeline(): void;
  showNewestTimeline(): void;
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
      // Equal effective timestamps cannot be resolved to one deterministic
      // map position without an explicit ordering contract.
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

/** Read compact Friends activity and one selected bounded SQLite timeline. */
export function useLibraryFriendsRows({
  graphRequest,
  locationSources,
  timelineIdentity,
  timelineSources,
  sourceVersion,
}: {
  graphRequest: LibraryFriendsGraphRequest;
  locationSources: readonly LibraryFriendsSource[];
  timelineIdentity: LibraryPersonTimelineRequest | null;
  timelineSources: readonly LibraryFriendsSource[];
  sourceVersion: number;
}): LibraryFriendsRowsState {
  const {
    readLibraryFriendsGraph,
    readLibraryFriendsLocationItem,
    readLibraryPersonTimeline,
  } = usePlatform();
  const timelineActive = timelineIdentity !== null;
  const locationActive = locationSources.length > 0;
  const [versionedGraph, setVersionedGraph] =
    useState<VersionedFriendsGraph | null>(null);
  const [failedGraphAttempt, setFailedGraphAttempt] =
    useState<GraphAttempt | null>(null);
  const [versionedTimeline, setVersionedTimeline] =
    useState<VersionedTimeline | null>(null);
  const [failedTimelineAttempt, setFailedTimelineAttempt] =
    useState<TimelineAttempt | null>(null);
  const inFlightTimelineCursorRef = useRef<TimelineCursorAttempt | null>(null);
  const [versionedLocationItems, setVersionedLocationItems] =
    useState<VersionedLocationItems | null>(null);

  useEffect(() => {
    let cancelled = false;
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
    readLibraryFriendsGraph,
    sourceVersion,
  ]);

  useEffect(() => {
    inFlightTimelineCursorRef.current = null;
    if (!timelineActive) {
      setVersionedTimeline(null);
      setFailedTimelineAttempt(null);
      return;
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
      ...timelineIdentity,
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
    timelineIdentity,
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
      })
      .catch(() => {
        if (!cancelled) setVersionedLocationItems(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    locationReadPlan,
    locationActive,
    locationSources,
    readLibraryFriendsLocationItem,
    sourceVersion,
  ]);

  const locationAttemptKey = locationReadPlan?.attemptKey ?? "";
  const locationItems =
    versionedLocationItems?.sourceVersion === sourceVersion &&
    versionedLocationItems.sources === locationSources &&
    versionedLocationItems.attemptKey === locationAttemptKey
      ? versionedLocationItems.items
      : [];

  const requestNativeTimelinePage = useCallback(
    (cursor: string | null) => {
      if (
        !readLibraryPersonTimeline ||
        timelineIdentity === null ||
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
        ...timelineIdentity,
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
      timelineIdentity,
      timelineSources,
    ],
  );

  const loadMoreTimeline = useCallback(() => {
    if (currentTimeline?.nextCursor) {
      requestNativeTimelinePage(currentTimeline.nextCursor);
    }
  }, [currentTimeline?.nextCursor, requestNativeTimelinePage]);

  const showNewestTimeline = useCallback(() => {
    if (currentTimeline && currentTimeline.pageCursor !== null) {
      requestNativeTimelinePage(null);
    }
  }, [currentTimeline, requestNativeTimelinePage]);

  return {
    graph: currentGraph,
    graphLoading:
      Boolean(readLibraryFriendsGraph) &&
      currentGraph === null &&
      !graphAttemptMatches(failedGraphAttempt, sourceVersion, graphRequest),
    locationItems,
    timelineItems: currentTimeline?.items ?? [],
    timelineTotalCount: currentTimeline?.totalCount ?? 0,
    timelineLoading:
      timelineActive &&
      Boolean(readLibraryPersonTimeline) &&
      currentTimeline === null &&
      !timelineAttemptMatches(
        failedTimelineAttempt,
        sourceVersion,
        timelineSources,
      ),
    timelineLoadingMore: currentTimeline?.loadingMore ?? false,
    timelineHasMore: Boolean(currentTimeline?.nextCursor),
    timelineAwayFromNewest: Boolean(
      currentTimeline && currentTimeline.pageCursor !== null,
    ),
    loadMoreTimeline,
    showNewestTimeline,
  };
}
