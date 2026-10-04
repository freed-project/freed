import {
  libraryCoreRuntimeStateFromFacetSummaryV1,
  readLibraryCoreNormalizedFacetSummaryResponseV1,
  readLibraryCoreNormalizedPreferencesSnapshotV1,
  type LibraryCoreNormalizedQueryExecutor,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreRuntimeStateV1,
} from "@freed/shared/library-core";
import type {
  LibraryCountResourceState, LibraryCountSelectionIdentity,
} from "@freed/ui/context";

function sameSelection(a: LibraryCountSelectionIdentity | null, b: LibraryCountSelectionIdentity | null) {
  return a === b || !!a && !!b && a.libraryId === b.libraryId
    && a.authorityEpochId === b.authorityEpochId && a.actorId === b.actorId;
}
function sameSource(a: LibraryCoreFeedPageSourceV1, b: LibraryCoreFeedPageSourceV1) {
  return a.generationId === b.generationId && a.projectionRevision === b.projectionRevision
    && a.transitionSequence === b.transitionSequence;
}
export class LibraryCountSourceRaceError extends Error {
  constructor() { super("Library count snapshot changed while loading"); }
}
export class LibraryCountSupersededError extends Error {
  constructor() { super("Library count activation was superseded"); }
}

/** One bounded, immutable navigation resource. This grants no native authority. */
export function createDesktopLibraryCountResource() {
  let selection: LibraryCountSelectionIdentity | null = null;
  let activation = 0;
  let transitions = 0;
  let state: LibraryCountResourceState = Object.freeze({ status: "unavailable", committed: null,
    activation, attempts: 0, error: null });
  const listeners = new Set<() => void>();
  let pending: Promise<LibraryCoreRuntimeStateV1> | null = null;
  let queuedBase: Promise<LibraryCoreRuntimeStateV1> | null = null;
  let queued: Promise<LibraryCoreRuntimeStateV1> | null = null;
  const publish = (next: LibraryCountResourceState) => {
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const invalidate = () => {
    activation += 1;
    selection = null;
    pending = null;
    queuedBase = null;
    queued = null;
    publish({ status: "unavailable", committed: null, activation, attempts: 0, error: null });
  };
  const setSelection = (next: LibraryCountSelectionIdentity | null) => {
    if (transitions > 0 || sameSelection(selection, next)) return;
    invalidate();
    selection = next ? Object.freeze({ ...next }) : null;
  };
  const beginTransition = () => {
    transitions += 1;
    invalidate();
    let ended = false;
    return () => { if (!ended) { ended = true; transitions -= 1; } };
  };
  const transition = async <T>(operation: () => Promise<T>): Promise<T> => {
    const finish = beginTransition();
    try { return await operation(); } finally { finish(); }
  };
  const startRefresh = (query: LibraryCoreNormalizedQueryExecutor,
    readSelection: () => Promise<LibraryCountSelectionIdentity>) => {
    if (!selection) return Promise.reject(new LibraryCountSupersededError());
    const selected = selection;
    const epoch = activation;
    const assertCurrent = () => {
      if (epoch !== activation || !sameSelection(selected, selection)) throw new LibraryCountSupersededError();
    };
    publish({ ...state, status: state.committed ? "refreshing" : "loading", error: null, attempts: 0 });
    let attempts = 0;
    const operation = (async () => {
      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          assertCurrent();
          attempts = attempt;
          // Drain every sibling before retry/error; no abandoned query accumulation.
          const rows = await Promise.allSettled([
            readLibraryCoreNormalizedFacetSummaryResponseV1({ query }),
            query({ queryId: "rss_item_summary_v1", schemaVersion: 1 }),
            readLibraryCoreNormalizedPreferencesSnapshotV1({ query }),
          ] as const);
          assertCurrent();
          const currentSelection = await readSelection();
          assertCurrent();
          if (!sameSelection(selected, currentSelection)) throw new LibraryCountSupersededError();
          if (state.committed && rows.some(row => row.status === "fulfilled"
            && (row.value.source.generationId !== state.committed!.source.generationId
              || row.value.source.projectionRevision < state.committed!.source.projectionRevision))) {
            publish({ status: "loading", committed: null, activation, attempts: attempt, error: null });
          }
          const failure = rows.find(row => row.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          const [facetRow, rssRow, preferenceRow] = rows;
          if (facetRow.status !== "fulfilled" || rssRow.status !== "fulfilled" || preferenceRow.status !== "fulfilled") throw new Error("Library count query failed");
          const facets = facetRow.value, rss = rssRow.value, preferences = preferenceRow.value;
          if (!sameSource(facets.source, rss.source) || !sameSource(facets.source, preferences.source)) {
            // A verified new generation cannot keep the old generation visible.
            if (state.committed && [facets.source, rss.source, preferences.source].some(source => source.generationId !== state.committed!.source.generationId)) {
              publish({ status: "loading", committed: null, activation, attempts: attempt, error: null });
            }
            if (attempt === 3) throw new LibraryCountSourceRaceError();
            continue;
          }
          const source = Object.freeze({ ...facets.source });
          const summary = Object.freeze({ ...facets.summary,
            tags: Object.freeze([...facets.summary.tags]),
            platformCounts: Object.freeze(facets.summary.platformCounts.map(row => Object.freeze({ ...row }))),
          });
          const committed = Object.freeze({ selection: selected, activation: epoch, source,
            facets: summary, rss: Object.freeze({ ...rss, source }) });
          const runtime = libraryCoreRuntimeStateFromFacetSummaryV1(preferences.preferences, summary, source.projectionRevision);
          assertCurrent();
          publish({ status: "ready", committed, activation, attempts: attempt, error: null });
          return runtime;
        }
        throw new LibraryCountSourceRaceError();
      } catch (error) {
        if (epoch === activation && sameSelection(selected, selection)) {
          publish({ status: "error", committed: state.committed, activation, attempts,
            error: error instanceof LibraryCountSourceRaceError ? "source-race" : "query" });
        }
        throw error;
      }
    })().finally(() => { if (pending === operation) pending = null; });
    pending = operation;
    return operation;
  };
  const refresh = (query: LibraryCoreNormalizedQueryExecutor,
    readSelection: () => Promise<LibraryCountSelectionIdentity>) => {
    if (!pending) return startRefresh(query, readSelection);
    if (queuedBase === pending && queued) return queued;
    const base = pending;
    const epoch = activation;
    const selected = selection;
    const followup = base.catch(() => {}).then(() => {
      if (epoch !== activation || !sameSelection(selected, selection)) throw new LibraryCountSupersededError();
      return pending ?? startRefresh(query, readSelection);
    });
    queuedBase = base;
    queued = followup;
    const cleanup = () => { if (queued === followup) { queued = null; queuedBase = null; } };
    void followup.then(cleanup, cleanup);
    return followup;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate, setSelection, beginTransition, transition, refresh,
  };
}
export const desktopLibraryCountResource = createDesktopLibraryCountResource();
