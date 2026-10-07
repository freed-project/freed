import type {
  LibraryCoreFacetSummaryV1, LibraryCoreFeedPageSourceV1,
  LibraryCoreRssItemSummaryResponseV1,
} from "@freed/shared/library-core";

/** Native-verified selected Library/actor context, not a renderer grant. */
export interface LibraryCountSelectionIdentity {
  readonly libraryId: string;
  readonly authorityEpochId: string;
  readonly actorId: string;
}
export interface LibraryCountSnapshot {
  readonly selection: LibraryCountSelectionIdentity;
  readonly activation: number;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly facets: LibraryCoreFacetSummaryV1;
  readonly rss: LibraryCoreRssItemSummaryResponseV1;
}
export interface LibraryCountResourceState {
  readonly status: "unavailable" | "loading" | "refreshing" | "ready" | "error";
  readonly committed: LibraryCountSnapshot | null;
  readonly activation: number;
  readonly attempts: number;
  readonly error: "query" | "source-race" | null;
}
export interface LibraryCountResource {
  readonly getSnapshot: () => LibraryCountResourceState;
  readonly subscribe: (listener: () => void) => () => void;
}
